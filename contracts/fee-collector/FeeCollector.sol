// SPDX-License-Identifier: MIT

pragma solidity 0.8.9;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/Address.sol";

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
    address public immutable GOVERNOR;
    
    bytes32 public constant ADMIN = 0x00;
    bytes32 public constant HARVESTER = keccak256("HARVESTER");

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

    constructor(
        address _stakingRewards,
        address _router,
        address _factory,
        address _miniChef,
        uint256 _pid,
        address _governor,
        address _wrappedToken,
        address _treasury,
        address _admin
    ) {
        require(_stakingRewards != address(0), "Invalid address");
        address _stakingRewardsRewardToken = IStakingRewards(_stakingRewards).rewardsToken();
        require(_stakingRewardsRewardToken != address(0), "Invalid staking reward");
        stakingRewards = _stakingRewards;
        stakingRewardsRewardToken = _stakingRewardsRewardToken;
        ROUTER = _router;
        FACTORY = _factory;
        miniChef = _miniChef;
        miniChefPoolId = _pid;
        GOVERNOR = _governor;
        WRAPPED_TOKEN = _wrappedToken;
        treasury = _treasury;
        _grantRole(ADMIN, _admin);
        _grantRole(HARVESTER, _admin);
    }

    /// @notice Change staking rewards contract address
    /// @param _stakingRewards - New contract address
    function setRewardsContract(address _stakingRewards) external onlyRole(ADMIN) {
        require(_stakingRewards != address(0), "Invalid address");
        address _stakingRewardsRewardToken = IStakingRewards(_stakingRewards).rewardsToken();
        require(_stakingRewardsRewardToken != address(0), "Invalid staking reward");
        stakingRewards = _stakingRewards;
        stakingRewardsRewardToken = _stakingRewardsRewardToken;
    }

    /// @notice Change the percentage of each harvest that goes to the caller
    /// @param _harvestIncentive - New incentive ratio in bips
    function setHarvestIncentive(uint256 _harvestIncentive) external onlyRole(ADMIN) {
        require(_harvestIncentive <= MAX_HARVEST_INCENTIVE, "Incentive too large");
        require(_harvestIncentive + treasuryFee <= FEE_DENOMINATOR, "Total fees must <= 100");
        harvestIncentive = _harvestIncentive;
    }

    /// @notice Disable the harvest function for non-admins
    function pauseHarvesting() external onlyRole(ADMIN) {
        _pause();
    }

    /// @notice Re-enable the harvest function for non-admins
    function unpauseHarvesting() external onlyRole(ADMIN) {
        _unpause();
    }

    /// @notice Change the percentage of each harvest that goes to the treasury
    /// @param _treasuryFee - New ratio in bips
    /// @dev Can only be called through a governance vote
    function setTreasuryFee(uint256 _treasuryFee) external {
        require(msg.sender == GOVERNOR, "Governor only");
        require(harvestIncentive + _treasuryFee <= FEE_DENOMINATOR, "Total fees must <= 100");
        treasuryFee = _treasuryFee;
    }

    /// @notice Updates the recipient of treasury fees
    /// @param _treasury - New treasury wallet
    function setTreasury(address _treasury) external onlyRole(ADMIN) {
        require(_treasury != address(0));
        treasury = _treasury;
    }

    /// @notice Sets the MiniChef address to collect rewards from
    /// @param _miniChef - New MiniChef address
    function setMiniChef(address _miniChef) external onlyRole(ADMIN) {
        require(_miniChef != address(0));
        miniChef = _miniChef;
    }

    /// @notice Sets the MiniChef pool used to accumulate rewards from emissions
    /// @param _pid - ID of the pool on MiniChef
    function setMiniChefPool(uint256 _pid) external onlyRole(ADMIN) {
        miniChefPoolId = _pid;
    }

    /// @notice Proxy function to set reward duration on the staking contract
    /// @param _rewardsDuration - the duration of the new period
    function setRewardsDuration(uint256 _rewardsDuration) external onlyRole(ADMIN) {
        IStakingRewards(stakingRewards).setRewardsDuration(_rewardsDuration);
    }

    /// @notice Proxy function to change ownership of the staking contract
    /// @param _newOwner - address to transfer ownership to
    function transferStakingOwnership(address _newOwner) external onlyRole(ADMIN) {
        IStakingRewards(stakingRewards).transferOwnership(_newOwner);
    }

    /// @notice Remove liquidity associated with a pair
    /// @param pair - The pair from which to retrieve liquidity
    /// @param balance - The amount to pull
    /// @return amount0 - Amount of token0 received via burn
    /// @return amount1 - Amount of token1 received via burn
    function _pullLiquidity(address pair, uint256 balance) private returns (uint256 amount0, uint256 amount1) {
        IERC20(pair).safeTransfer(pair, balance);
        (amount0, amount1) = IPangolinPair(pair).burn(address(this));
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

    /// @notice For a list of liquidity pairs, pulls all liquidity and swaps it
    /// to the same previously specified output token
    /// @param liquidityPairs - list of all the pairs to pull
    /// @param outputToken - the token into which all liquidity will be swapped
    function _collectFees(IPangolinPair[] memory liquidityPairs, address outputToken) private {
        for (uint256 i; i < liquidityPairs.length; ++i) {
            IPangolinPair liquidityPair = liquidityPairs[i];
            uint256 pglBalance = liquidityPair.balanceOf(address(this));
            if (pglBalance > 0) {
                address token0 = liquidityPair.token0();
                address token1 = liquidityPair.token1();
                require(pairFor(FACTORY, token0, token1) == address(liquidityPair), "Invalid pair");
                (uint256 token0Pulled, uint256 token1Pulled) = _pullLiquidity(address(liquidityPair), pglBalance);
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
    /// transfers it to the staking contract
    /// @param liquidityPairs - list of all the pairs to harvest
    /// @param claimMiniChef - whether to also harvest additional rewards accrued via MiniChef
    function harvest(IPangolinPair[] memory liquidityPairs, bool claimMiniChef) external {
        if (!hasRole(HARVESTER, msg.sender)) {
            // Enforce these conditions for callers without the HARVESTER role:
            require(!paused(), "Harvest disabled");
            require(!address(msg.sender).isContract() && msg.sender == tx.origin, "No contracts");
        }

        address _stakingRewardsRewardToken = stakingRewardsRewardToken; // Gas savings

        if (liquidityPairs.length > 0) {
            _collectFees(liquidityPairs, _stakingRewardsRewardToken);
        }

        if (claimMiniChef) {
            IMiniChef(miniChef).harvest(miniChefPoolId, address(this));
        }

        uint256 finalBalance = IERC20(_stakingRewardsRewardToken).balanceOf(address(this));

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
