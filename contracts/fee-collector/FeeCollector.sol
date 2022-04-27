// SPDX-License-Identifier: MIT

pragma solidity 0.8.13;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/security/Pausable.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";

interface IPangolinPair {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function burn(address to) external returns (uint amount0, uint amount1);
    function swap(uint amount0Out, uint amount1Out, address to, bytes calldata data) external;
    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast);
    function balanceOf(address owner) external view returns (uint);
}

interface IMiniChef {
    function harvest(uint256 pid, address to) external;
}

interface IStakingRewards {
    function rewardsToken() external view returns (address);
    function notifyRewardAmount(uint256 reward) external;
    function setRewardsDuration(uint256 _rewardsDuration) external;
    function transferOwnership(address newOwner) external;
}

contract FeeCollector is AccessControl, Pausable {

    using SafeERC20 for IERC20;

    address public immutable FACTORY;
    bytes32 public immutable PAIR_INIT_HASH; // Specified as hex
    address public immutable WRAPPED_TOKEN;

    bytes32 public constant HARVEST_ROLE = keccak256("HARVEST_ROLE");
    bytes32 public constant PAUSE_ROLE = keccak256("PAUSE_ROLE");
    bytes32 public constant RECOVERY_ROLE = keccak256("RECOVERY_ROLE");
    bytes32 public constant GOVERNOR_ROLE = keccak256("GOVERNOR_ROLE");

    uint256 public constant FEE_DENOMINATOR = 10_000;
    uint256 public constant MAX_HARVEST_INCENTIVE = 200; // 2%

    address public stakingRewards;
    address public stakingRewardsRewardToken;

    address public treasury;
    uint256 public treasuryFee = 1500; // 15%
    uint256 public harvestIncentive = 10; // 0.1%

    address public miniChef;
    uint256 public miniChefPoolId;

    mapping(address => bool) public isRecoverable;

    constructor(
        address _wrappedToken,
        address _factory,
        bytes32 _initHash,
        address _stakingRewards,
        address _miniChef,
        uint256 _pid,
        address _treasury,
        address _governor,
        address _admin
    ) {
        WRAPPED_TOKEN = _wrappedToken;
        FACTORY = _factory;
        PAIR_INIT_HASH = _initHash;

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
        _grantRole(RECOVERY_ROLE, _admin);
        _setRoleAdmin(RECOVERY_ROLE, RECOVERY_ROLE); // RECOVERY_ROLE is self-managed
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

    /// @notice Disable the harvest and recover functions
    function pauseHarvesting() external onlyRole(PAUSE_ROLE) {
        _pause();
    }

    /// @notice Re-enable the harvest and recover functions
    function unpauseHarvesting() external onlyRole(PAUSE_ROLE) {
        _unpause();
    }

    /// @notice Allows a liquidity token to be withdrawn fully without a buyback
    /// @dev Intended for recovering LP involving a token with fees on transfer
    function setRecoverable(address token, bool allowed) external onlyRole(RECOVERY_ROLE) {
        isRecoverable[token] = allowed;
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

        require(pairFor(token0, token1) == pair, "Invalid pair");

        IERC20(pair).safeTransfer(pair, balance);
        (amount0, amount1) = IPangolinPair(pair).burn(address(this));
    }

    /// @notice Swap a token for the specified output token
    /// @param token - address of the token to swap
    /// @param amount - amount of the token to swap
    /// @dev Swaps are executed directly against pairs with infinite slippage tolerance
    function _swap(address token, address outputToken, uint256 amount) private {
        if (token == WRAPPED_TOKEN || outputToken == WRAPPED_TOKEN) {
            direct2Swap(amount, token, outputToken);
        } else {
            direct3Swap(amount, token, WRAPPED_TOKEN, outputToken);
        }
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
        IPangolinPair[] calldata liquidityPairs,
        bool claimMiniChef,
        uint256 minFinalBalance
    ) external whenNotPaused onlyRole(HARVEST_ROLE) {
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

    /// @notice Recovers LP tokens to the treasury. Requires LP is whitelisted by the RECOVERY_ROLE
    /// @param liquidityPairs - list of all the pairs to recover
    /// @dev Intended to recover LP involving a token with fees on transfer
    function recoverLP(address[] calldata liquidityPairs) external whenNotPaused onlyRole(DEFAULT_ADMIN_ROLE) {
        address _treasury = treasury;
        uint256 len = liquidityPairs.length;
        for (uint256 i; i < len; ++i) {
            require(isRecoverable[liquidityPairs[i]], "Cannot recover");
            IERC20 liquidityPair = address(liquidityPairs[i]);
            liquidityPair.safeTransfer(_treasury, liquidityPair.balanceOf(address(this)));
        }
    }

    function direct2Swap(uint256 amountIn, address tokenA, address tokenB) internal {
        address pairAB = pairFor(tokenA, tokenB);

        uint256 amountOutAB = getAmountOut(amountIn, pairAB, tokenA, tokenB);

        IERC20(tokenA).safeTransfer(pairAB, amountIn);

        if (tokenA < tokenB) {
            IPangolinPair(pairAB).swap(0, amountOutAB, address(this), new bytes(0));
        } else {
            IPangolinPair(pairAB).swap(amountOutAB, 0, address(this), new bytes(0));
        }
    }

    function direct3Swap(uint256 amountIn, address tokenA, address tokenB, address tokenC) internal {
        address pairAB = pairFor(tokenA, tokenB);
        address pairBC = pairFor(tokenB, tokenC);

        uint256 amountOutAB = getAmountOut(amountIn, pairAB, tokenA, tokenB);
        uint256 amountOutBC = getAmountOut(amountOutAB, pairBC, tokenB, tokenC);

        IERC20(tokenA).safeTransfer(pairAB, amountIn);

        if (tokenA < tokenB) {
            IPangolinPair(pairAB).swap(0, amountOutAB, pairBC, new bytes(0));
        } else {
            IPangolinPair(pairAB).swap(amountOutAB, 0, pairBC, new bytes(0));
        }

        if (tokenB < tokenC) {
            IPangolinPair(pairBC).swap(0, amountOutBC, address(this), new bytes(0));
        } else {
            IPangolinPair(pairBC).swap(amountOutBC, 0, address(this), new bytes(0));
        }
    }

    // Simplified from PangolinLibrary
    // Combines PangolinLibrary.getAmountOut and PangolinLibrary.getReserves
    function getAmountOut(
        uint256 amountIn,
        address pair,
        address tokenA,
        address tokenB
    ) internal view returns (uint256 amountOut) {
        (uint256 reserve0, uint256 reserve1,) = IPangolinPair(pair).getReserves();
        (uint256 reserveIn, uint256 reserveOut) = tokenA < tokenB ? (reserve0, reserve1) : (reserve1, reserve0);

        uint256 amountInWithFee = amountIn * 997;
        uint256 numerator = amountInWithFee * reserveOut;
        uint256 denominator = (reserveIn * 1000) + amountInWithFee;
        amountOut = numerator / denominator;
    }

    // Migrated from PangolinLibrary
    // calculates the CREATE2 address for a Pangolin pair without making any external calls
    function pairFor(address tokenA, address tokenB) private view returns (address pair) {
        (address token0, address token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        pair = address(uint160(uint256(keccak256(abi.encodePacked(
            hex'ff',
            FACTORY,
            keccak256(abi.encodePacked(token0, token1)),
            PAIR_INIT_HASH
        )))));
    }
}
