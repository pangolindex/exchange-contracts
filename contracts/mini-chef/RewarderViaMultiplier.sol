// SPDX-License-Identifier: MIT

pragma solidity 0.6.12;

import "@boringcrypto/boring-solidity/contracts/libraries/BoringERC20.sol";
import "@boringcrypto/boring-solidity/contracts/libraries/BoringMath.sol";

import "./IRewarder.sol";

contract RewarderViaMultiplier is IRewarder {
    using BoringMath for uint256;
    using BoringERC20 for IERC20;

    IERC20[] public rewardTokens;
    uint256[] public rewardMultipliers;
    address private immutable CHEF_V2;
    uint256 private immutable BASE_REWARD_TOKEN_DIVISOR;

    // @dev Ceiling on additional rewards to prevent a self-inflicted DOS via gas limitations when claim
    uint256 private constant MAX_REWARDS = 100;

    /// @dev Additional reward quantities that might be owed to users trying to claim after funds have been exhausted
    mapping(address => mapping(uint256 => uint256)) private rewardDebts;

    /// @param _rewardTokens The address of each additional reward token
    /// @param _rewardMultipliers The amount of each additional reward token to be claimable for every 1 base reward (PNG) being claimed
    /// @param _baseRewardTokenDecimals The decimal precision of the base reward (PNG) being emitted
    /// @param _chefV2 The address of the chef contract where the base reward (PNG) is being emitted
    /// @notice Each reward multiplier should have a precision matching that individual token
    constructor (
        IERC20[] memory _rewardTokens,
        uint256[] memory _rewardMultipliers,
        uint256 _baseRewardTokenDecimals,
        address _chefV2
    ) public {
        require(
            _rewardTokens.length > 0
            && _rewardTokens.length <= MAX_REWARDS
            && _rewardTokens.length == _rewardMultipliers.length,
            "RewarderViaMultiplier::Invalid input lengths"
        );

        require(
            _baseRewardTokenDecimals <= 77,
            "RewarderViaMultiplier::Invalid base reward token decimals"
        );

        require(
            _chefV2 != address(0),
            "RewarderViaMultiplier::Invalid chef address"
        );

        for (uint256 i; i < _rewardTokens.length; ++i) {
            require(address(_rewardTokens[i]) != address(0), "RewarderViaMultiplier::Cannot reward zero address");
            require(_rewardMultipliers[i] > 0, "RewarderViaMultiplier::Invalid multiplier");
        }

        rewardTokens = _rewardTokens;
        rewardMultipliers = _rewardMultipliers;
        BASE_REWARD_TOKEN_DIVISOR = 10 ** _baseRewardTokenDecimals;
        CHEF_V2 = _chefV2;
    }

    function onReward(uint256, address user, address to, uint256 rewardAmount, uint256) onlyMCV2 override external {
        for (uint256 i; i < rewardTokens.length; ++i) {
            uint256 pendingReward = rewardDebts[user][i].add(rewardAmount.mul(rewardMultipliers[i]) / BASE_REWARD_TOKEN_DIVISOR);
            uint256 rewardBal = rewardTokens[i].balanceOf(address(this));
            if (pendingReward > rewardBal) {
                rewardDebts[user][i] = pendingReward - rewardBal;
                rewardTokens[i].safeTransfer(to, rewardBal);
            } else {
                rewardDebts[user][i] = 0;
                rewardTokens[i].safeTransfer(to, pendingReward);
            }
        }
    }

    /// @notice Shows pending tokens that can be currently claimed
    function pendingTokens(uint256, address user, uint256 rewardAmount) override external view returns (IERC20[] memory tokens, uint256[] memory amounts) {
        amounts = new uint256[](rewardTokens.length);
        for (uint256 i; i < rewardTokens.length; ++i) {
            uint256 pendingReward = rewardDebts[user][i].add(rewardAmount.mul(rewardMultipliers[i]) / BASE_REWARD_TOKEN_DIVISOR);
            uint256 rewardBal = rewardTokens[i].balanceOf(address(this));
            if (pendingReward > rewardBal) {
                amounts[i] = rewardBal;
            } else {
                amounts[i] = pendingReward;
            }
        }
        return (rewardTokens, amounts);
    }

    /// @notice Shows pending tokens including rewards accrued after the funding has been exhausted
    /// @notice these extra rewards could be claimed if more funding is added to the contract
    function pendingTokensDebt(uint256, address user, uint256 rewardAmount) external view returns (IERC20[] memory tokens, uint256[] memory amounts) {
        amounts = new uint256[](rewardTokens.length);
        for (uint256 i; i < rewardTokens.length; ++i) {
            uint256 pendingReward = rewardDebts[user][i].add(rewardAmount.mul(rewardMultipliers[i]) / BASE_REWARD_TOKEN_DIVISOR);
            amounts[i] = pendingReward;
        }
        return (rewardTokens, amounts);
    }

    /// @notice Overloaded getter for easy access to the reward tokens
    function getRewardTokens() external view returns (IERC20[] memory) {
        return rewardTokens;
    }

    /// @notice Overloaded getter for easy access to the reward multipliers
    function getRewardMultipliers() external view returns (uint256[] memory) {
        return rewardMultipliers;
    }

    modifier onlyMCV2 {
        require(
            msg.sender == CHEF_V2,
            "Only MCV2 can call this function."
        );
        _;
    }

}
