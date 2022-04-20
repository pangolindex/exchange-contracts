// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

import "../mini-chef/IMiniChef.sol";
import "../pangolin-core/interfaces/IPangolinPair.sol";
import "../pangolin-periphery/interfaces/IPangolinRouter.sol";
import "../staking-rewards/IStakingRewards.sol";

contract FeeCollector is AccessControl, Pausable {

    using SafeERC20 for IERC20;
    using Address for address;

    address public immutable FACTORY;
    address public immutable ROUTER;
    address public immutable WRAPPED_TOKEN;

    bytes32 public constant HARVEST_ROLE = keccak256("HARVEST_ROLE");
    bytes32 public constant PAUSE_ROLE = keccak256("PAUSE_ROLE");
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");
    bytes32 public constant REFLEXIVE_ROLE = keccak256("REFLEXIVE_ROLE");

    uint256 public constant FEE_DENOMINATOR = 10_000;
    uint256 public constant MAX_HARVEST_INCENTIVE = 200; // 2%

    address public stakingRewards;
    address public stakingRewardsRewardToken;

    address public treasury;
    uint256 public treasuryFee = 1500; // 15%
    uint256 public harvestIncentive = 10; // 0.1%

    address public miniChef;
    uint256 public miniChefPoolId;

    /// @dev Cached record of tokens with max approval to PangolinRouter
    mapping(address => bool) private routerApprovals;
    mapping(address => bool) private isReflexive;

    constructor(
        address _wrappedToken,
        address _factory,
        address _router,
        address _stakingRewards,
        address _miniChef,
        uint256 _pid,
        address _treasury,
        address _governor,
        address _admin
    ) {
        WRAPPED_TOKEN = _wrappedToken;
        FACTORY = _factory;
        ROUTER = _router;

        require(_stakingRewards != address(0), "Invalid address");
        address _stakingRewardsRewardToken = IStakingRewards(_stakingRewards).rewardsToken();
        require(_stakingRewardsRewardToken != address(0), "Invalid staking reward");
        stakingRewards = _stakingRewards;
        stakingRewardsRewardToken = _stakingRewardsRewardToken;

        miniChef = _miniChef;
        miniChefPoolId = _pid;
        treasury = _treasury;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
        _grantRole(HARVEST_ROLE, _admin);
        _grantRole(PAUSE_ROLE, _admin);
        _grantRole(REFLEXIVE_ROLE, _admin);
        _grantRole(GOVERNOR_ROLE, _governor);
        _setRoleAdmin(GOVERNOR_ROLE, GOVERNOR_ROLE); // GOVERNOR_ROLE is self-managed
    }

    /// @notice Change staking rewards contract address
    /// @param _stakingRewards - New contract address
    function setRewardsContract(address _stakingRewards) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_stakingRewards != address(0), "Invalid address");
        address _stakingRewardsRewardToken = IStakingRewards(_stakingRewards).rewardsToken();
        require(_stakingRewardsRewardToken != address(0), "Invalid staking reward");
        stakingRewards = _stakingRewards;
        stakingRewardsRewardToken = _stakingRewardsRewardToken;
    }

    /// @notice Change the percentage of each harvest that goes to the caller
    /// @param _harvestIncentive - New incentive ratio in bips
    function setHarvestIncentive(uint256 _harvestIncentive) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_harvestIncentive <= MAX_HARVEST_INCENTIVE, "Incentive too large");
        require(_harvestIncentive + treasuryFee <= FEE_DENOMINATOR, "Total fees must <= 100");
        harvestIncentive = _harvestIncentive;
    }

    /// @notice Disable the harvest function. Still allows HARVEST_ROLE members access
    function pauseHarvesting() external onlyRole(PAUSE_ROLE) {
        _pause();
    }

    /// @notice Re-enable the harvest function
    function unpauseHarvesting() external onlyRole(PAUSE_ROLE) {
        _unpause();
    }

    /// @notice Marks a token as reflexive or not for use in calculating burned balances
    function setReflexiveToken(address token, bool _isReflexive) external onlyRole(REFLEXIVE_ROLE) {
        isReflexive[token] = _isReflexive;
    }

    /// @notice Change the percentage of each harvest that goes to the treasury
    /// @param _treasuryFee - New ratio in bips
    function setTreasuryFee(uint256 _treasuryFee) external onlyRole(GOVERNOR_ROLE) {
        require(harvestIncentive + _treasuryFee <= FEE_DENOMINATOR, "Total fees must <= 100");
        treasuryFee = _treasuryFee;
    }

    /// @notice Updates the recipient of treasury fees
    /// @param _treasury - New treasury wallet
    function setTreasury(address _treasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_treasury != address(0));
        treasury = _treasury;
    }

    /// @notice Sets the MiniChef address to collect rewards from
    /// @param _miniChef - New MiniChef address
    function setMiniChef(address _miniChef) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_miniChef != address(0));
        miniChef = _miniChef;
    }

    /// @notice Sets the MiniChef pool used to accumulate rewards from emissions
    /// @param _pid - ID of the pool on MiniChef
    function setMiniChefPool(uint256 _pid) external onlyRole(DEFAULT_ADMIN_ROLE) {
        miniChefPoolId = _pid;
    }

    /// @notice Proxy function to set reward duration on the staking contract
    /// @param _rewardsDuration - the duration of the new period
    function setRewardsDuration(uint256 _rewardsDuration) external onlyRole(DEFAULT_ADMIN_ROLE) {
        IStakingRewards(stakingRewards).setRewardsDuration(_rewardsDuration);
    }

    /// @notice Proxy function to change ownership of the staking contract
    /// @param _newOwner - address to transfer ownership to
    function transferStakingOwnership(address _newOwner) external onlyRole(DEFAULT_ADMIN_ROLE) {
        IStakingRewards(stakingRewards).transferOwnership(_newOwner);
    }

    /// @notice Remove liquidity associated with a pair
    /// @param pair - The pair from which to retrieve liquidity
    /// @param balance - The amount to pull
    /// @return token0 - token0 address of the pair
    /// @return amount0 - Amount of token0 received via burn
    /// @return token1 - token1 address of the pair
    /// @return amount1 - Amount of token1 received via burn
    function _pullLiquidity(
        address pair,
        uint256 balance
    ) private returns (
        address token0,
        uint256 amount0,
        address token1,
        uint256 amount1
    ) {
        token0 = IPangolinPair(pair).token0();
        token1 = IPangolinPair(pair).token1();

        require(pairFor(FACTORY, token0, token1) == pair, "Invalid pair");

        IERC20(pair).safeTransfer(pair, balance);
        (amount0, amount1) = IPangolinPair(pair).burn(address(this));

        if (isReflexive[token0]) {
            // Clamp max value to amount sent from burn()
            amount0 = Math.min(amount0, IERC20(token0).balanceOf(address(this)));
        }
        if (isReflexive[token1]) {
            // Clamp max value to amount sent from burn()
            amount1 = Math.min(amount1, IERC20(token1).balanceOf(address(this)));
        }
    }

    /// @notice Swap a token for the specified output token
    /// @param token - address of the token to swap
    /// @param amount - amount of the token to swap
    /// @dev Swaps are executed via router with infinite slippage tolerance
    function _swap(address token, address outputToken, uint256 amount) private {
        address[] memory path;

        if (token == WRAPPED_TOKEN || outputToken == WRAPPED_TOKEN) {
            path = new address[](2);
            path[0] = token;
            path[1] = outputToken;
        } else {
            path = new address[](3);
            path[0] = token;
            path[1] = WRAPPED_TOKEN;
            path[2] = outputToken;
        }

        // "Cache" router approval to avoid external calls
        if (!routerApprovals[token]) {
            IERC20(token).safeApprove(ROUTER, type(uint256).max);
            routerApprovals[token] = true;
        }

        IPangolinRouter(ROUTER).swapExactTokensForTokens(
            amount,
            0,
            path,
            address(this),
            block.timestamp
        );
    }

    /// @notice For a list of liquidity pairs, withdraws all liquidity and swaps it to a specified token
    /// @param liquidityPairs - list of all the pairs to pull
    /// @param outputToken - the token into which all liquidity will be swapped
    function _convertLiquidity(IPangolinPair[] memory liquidityPairs, address outputToken) private {
        for (uint256 i; i < liquidityPairs.length; ++i) {
            IPangolinPair liquidityPair = liquidityPairs[i];
            uint256 pglBalance = liquidityPair.balanceOf(address(this));
            if (pglBalance > 0) {
                (
                    address token0,
                    uint256 token0Pulled,
                    address token1,
                    uint256 token1Pulled
                ) = _pullLiquidity(address(liquidityPair), pglBalance);
                if (token0 != outputToken) {
                    _swap(token0, outputToken, token0Pulled);
                }
                if (token1 != outputToken) {
                    _swap(token1, outputToken, token1Pulled);
                }
            }
        }
    }

    /// @notice - Converts all the LP tokens specified to the rewards token and
    /// transfers it to the staking contract, treasury, and caller
    /// @param liquidityPairs - list of all the pairs to harvest
    /// @param claimMiniChef - whether to also harvest additional rewards accrued via MiniChef
    /// @param minFinalBalance - required min png balance after the buybacks (slippage control)
    function harvest(
        IPangolinPair[] memory liquidityPairs,
        bool claimMiniChef,
        uint256 minFinalBalance
    ) external onlyRole(HARVEST_ROLE) {
        require(!paused() || hasRole(DEFAULT_ADMIN_ROLE, msg.sender), "Harvest disabled");

        address _stakingRewardsRewardToken = stakingRewardsRewardToken; // Gas savings

        if (liquidityPairs.length > 0) {
            _convertLiquidity(liquidityPairs, _stakingRewardsRewardToken);
        }

        if (claimMiniChef) {
            IMiniChef(miniChef).harvest(miniChefPoolId, address(this));
        }

        uint256 finalBalance = IERC20(_stakingRewardsRewardToken).balanceOf(address(this));
        require(finalBalance >= minFinalBalance, "High Slippage");

        uint256 _callIncentive = finalBalance * harvestIncentive / FEE_DENOMINATOR;
        uint256 _treasuryFee = finalBalance * treasuryFee / FEE_DENOMINATOR;
        uint256 _totalRewards = finalBalance - _callIncentive - _treasuryFee;

        if (_totalRewards > 0) {
            address _stakingRewards = stakingRewards;
            IERC20(_stakingRewardsRewardToken).safeTransfer(_stakingRewards, _totalRewards);
            IStakingRewards(_stakingRewards).notifyRewardAmount(_totalRewards);
        }
        if (_treasuryFee > 0) {
            IERC20(_stakingRewardsRewardToken).safeTransfer(treasury, _treasuryFee);
        }
        if (_callIncentive > 0) {
            IERC20(_stakingRewardsRewardToken).safeTransfer(msg.sender, _callIncentive);
        }
    }

    // Migrated from PangolinLibrary
    // calculates the CREATE2 address for a Pangolin pair without making any external calls
    function pairFor(address factory, address tokenA, address tokenB) private pure returns (address pair) {
(address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
pair = address(uint160(uint256(keccak256(abi.encodePacked(
    hex'ff',
    factory,
    keccak256(abi.encodePacked(token0, token1)),
    hex'40231f6b438bce0797c9ada29b718a87ea0a5cea3fe9a771abdd76bd41a3e545' // Pangolin init code hash
)))));
    }
}
