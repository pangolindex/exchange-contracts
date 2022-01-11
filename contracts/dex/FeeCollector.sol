pragma solidity 0.8.9;
// SPDX-License-Identifier: MIT

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/utils/Address.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./interfaces/IPangolinPair.sol";
import "./interfaces/IPangolinRouter.sol";
import "./interfaces/IStakingRewards.sol";
import "./interfaces/IMiniChef.sol";

contract PangolinFeeCollector is Ownable {

    using SafeERC20 for IERC20;
    using Address for address;

    address public constant pangolinRouter =
    0xE54Ca86531e17Ef3616d22Ca28b0D458b6C89106;
    address public constant miniChef =
    0x1f806f7C8dED893fd3caE279191ad7Aa3798E928;
    address public constant governor =
    0xb0Ff2b1047d9E8d294c2eD798faE3fA817F43Ee1;

    address public constant wrappedNativeToken =
    0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7;
    uint256 public constant FEE_DENOMINATOR = 10000;
    uint256 public constant MAX_INCENTIVE = 200;

    address public stakingRewards;
    // Pangolin multisig
    address public treasury = 0xA4cB6e1971Ed8A1F76d9e8d50A5FC56DFA5cc1e6;
    uint256 public harvestIncentive = 50;
    uint256 public treasuryFee = 0;
    uint256 public miniChefPoolId;


    constructor(address _stakingRewards, uint256 _pid) public {
        require(_stakingRewards != address(0), "Invalid address");
        stakingRewards = _stakingRewards;
        miniChefPoolId = _pid;
    }

    /// @notice Change staking rewards contract address
    /// @param _stakingRewards - New contract address
    function setRewardsContract(address _stakingRewards) external onlyOwner {
        require(_stakingRewards != address(0), "Invalid address");
        stakingRewards = _stakingRewards;
    }

    /// @notice Change the percentage of each harvest that goes to the caller
    /// @param _harvestIncentive - New incentive ratio in bips
    function setHarvestIncentive(uint256 _harvestIncentive) external onlyOwner {
        require(_harvestIncentive <= MAX_INCENTIVE, "Incentive too large");
        require(_harvestIncentive + treasuryFee <= FEE_DENOMINATOR,
            "Total fees must <= 100");
        harvestIncentive = _harvestIncentive;
    }

    /// @notice Change the percentage of each harvest that goes to the treasury
    /// @param _treasuryFee - New ratio in bips
    /// @dev Can only be called through a governance vote
    function setTreasuryFee(uint256 _treasuryFee) external {
        require(msg.sender == governor, "Governor only");
        require(harvestIncentive + _treasuryFee <= FEE_DENOMINATOR,
            "Total fees must <= 100");
        treasuryFee = _treasuryFee;
    }

    /// @notice Updates the recipient of treasury fees
    /// @param _treasury - New treasury wallet
    function setTreasury(address _treasury) external onlyOwner {
        require(_treasury != address(0));
        treasury = _treasury;
    }

    /// @notice Sets the MiniChef pool used to accumulate rewards from emissions
    /// @param _pid - ID of the pool on MiniChef
    function setMiniChefPool(uint256 _pid) external onlyOwner {
        miniChefPoolId = _pid;
    }

    /// @notice Proxy function to set reward duration on the staking contract
    /// @param _rewardsDuration - the duration of the new period
    function setRewardsDuration(uint256 _rewardsDuration) external onlyOwner {
        IStakingRewards(stakingRewards).setRewardsDuration(_rewardsDuration);
    }

    /// @notice Proxy function to change ownership of the staking contract
    /// @param _newOwner - address to transfer ownership to
    function transferStakingOwnership(address _newOwner) external onlyOwner {
        IStakingRewards(stakingRewards).transferOwnership(_newOwner);
    }

    /// @notice Remove liquidity associated with a pair
    /// @param pair - The pair from which to retrieve liquidity
    /// @param balance - The amount to pull
    function _pullLiquidity(IPangolinPair pair, uint256 balance) internal {
        pair.approve(pangolinRouter, balance);
        IPangolinRouter(pangolinRouter).removeLiquidity(
            pair.token0(),
            pair.token1(),
            balance,
            0,
            0,
            address(this),
            block.timestamp + 60
        );
    }

    /// @notice Swap a token for the specified output token
    /// @param token - address of the token to swap
    /// @param amount - amount of the token to swap
    /// @dev Swaps are executed via router, there is currently no check
    /// for existence of LP for output token
    function _swap(address token, address outputToken, uint256 amount)
    internal {

        address[] memory path;

        if (outputToken == wrappedNativeToken || token == wrappedNativeToken) {
            path = new address[](2);
            path[0] = token;
            path[1] = outputToken;
        } else {
            path = new address[](3);
            path[0] = token;
            path[1] = wrappedNativeToken;
            path[2] = outputToken;
        }

        IERC20(token).safeApprove(pangolinRouter, 0);
        IERC20(token).safeApprove(pangolinRouter, amount);
        IPangolinRouter(pangolinRouter).swapExactTokensForTokens(
            amount,
            0,
            path,
            address(this),
            block.timestamp + 60
        );
    }

    /// @notice For a list of liquidity pairs, pulls all liquidity and swaps it
    /// to the same previously specified output token
    /// @param liquidityPairs - list of all the pairs to pull
    /// @param outputToken - the token into which all liquidity will be swapped
    function _collectFees(address[] memory liquidityPairs,
        address outputToken) internal {
        require(outputToken != address(0), "Output token unspecified");
        for (uint256 i; i < liquidityPairs.length; ++i) {
            address currentPairAddress = liquidityPairs[i];
            IPangolinPair currentPair = IPangolinPair(currentPairAddress);
            uint256 pglBalance = currentPair.balanceOf(address(this));
            if (pglBalance > 0) {
                _pullLiquidity(currentPair, pglBalance);
                address token0 = currentPair.token0();
                address token1 = currentPair.token1();
                if (token0 != outputToken) {
                    _swap(token0, outputToken,
                        IERC20(token0).balanceOf(address(this)));
                }
                if (token1 != outputToken) {
                    _swap(token1, outputToken,
                        IERC20(token1).balanceOf(address(this)));
                }
            }
        }
    }

    /// @notice - Converts all the LP tokens specified to the rewards token and
    /// transfers it to the staking contract
    /// @param liquidityPairs - list of all the pairs to harvest
    /// @param claimMiniChef - whether to also harvest additional rewards
    /// accrued via MiniChef
    function harvest(address[] memory liquidityPairs, bool claimMiniChef)
    external {

        require(!address(msg.sender).isContract() && msg.sender == tx.origin, "No contracts");
        require(liquidityPairs.length <= 50, "50 pairs max");

        address _outputToken = IStakingRewards(stakingRewards).rewardsToken();

        if (claimMiniChef) {
            IMiniChef(miniChef).harvest(miniChefPoolId, address(this));
        }

        if (liquidityPairs.length > 0) {
            _collectFees(liquidityPairs, _outputToken);
        }

        uint256 _finalBalance = IERC20(_outputToken).balanceOf(address(this));

        uint256 _callIncentive = _finalBalance * harvestIncentive
        / FEE_DENOMINATOR;
        uint256 _treasuryFee = _finalBalance * treasuryFee / FEE_DENOMINATOR;
        uint256 _totalRewards = _finalBalance - _callIncentive - _treasuryFee;

        if (_totalRewards > 0) {
            IERC20(_outputToken).safeTransfer(stakingRewards, _totalRewards);
            IStakingRewards(stakingRewards).notifyRewardAmount(_totalRewards);
        }
        if (_treasuryFee > 0) {
            IERC20(_outputToken).safeTransfer(treasury, _treasuryFee);
        }
        if (_callIncentive > 0) {
            IERC20(_outputToken).safeTransfer(msg.sender, _callIncentive);
        }

    }

}
