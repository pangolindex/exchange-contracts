// SPDX-License-Identifier: MIT
pragma solidity 0.8.15;

import "./PangoChef.sol";

contract RewarderViaMultiplierForPangoChef is IRewarder {
    using SafeTransferLib for ERC20;

    ERC20[] public rewardTokens;
    uint256[] public rewardMultipliers;
    address private immutable CHEF_V2;
    uint256 private immutable BASE_REWARD_TOKEN_DIVISOR;

    // @dev Ceiling on additional rewards to prevent a self-inflicted DOS via gas limitations when claim
    uint256 private constant MAX_REWARDS = 100;

    /// @dev Additional reward quantities that might be owed to users trying to claim after funds have been exhausted
    mapping(address => mapping(uint256 => uint256)) private rewardDebts;

    /// @dev Previous sum of entry times to check if staking duration was reset.
    mapping(uint256 => mapping(address => PangoChef.ValueVariables)) private usersValueVariables;

    /// @param _rewardTokens The address of each additional reward token
    /// @param _rewardMultipliers The amount of each additional reward token to be claimable for every 1 base reward (PNG) being claimed
    /// @param _baseRewardTokenDecimals The decimal precision of the base reward (PNG) being emitted
    /// @param _chefV2 The address of the chef contract where the base reward (PNG) is being emitted
    /// @notice Each reward multiplier should have a precision matching that individual token
    constructor (
        ERC20[] memory _rewardTokens,
        uint256[] memory _rewardMultipliers,
        uint256 _baseRewardTokenDecimals,
        address _chefV2
    ) {
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
            require(address(_rewardTokens[i]).code.length != 0, "RewarderViaMultiplier::Cannot reward zero address");
            require(_rewardMultipliers[i] > 0, "RewarderViaMultiplier::Invalid multiplier");
        }

        rewardTokens = _rewardTokens;
        rewardMultipliers = _rewardMultipliers;
        BASE_REWARD_TOKEN_DIVISOR = 10 ** _baseRewardTokenDecimals;
        CHEF_V2 = _chefV2;
    }

    function onReward(
        uint256 pid,
        address user,
        bool destructiveAction,
        uint256 rewardAmount,
        uint256 newBalance
    ) onlyMCV2 override external {

        // determine the action type
        PangoChef.ValueVariables memory newUserValueVariables = PangoChef(CHEF_V2).getUser(pid, user).valueVariables;
        PangoChef.ValueVariables memory previousUserValueVariables = usersValueVariables[pid][user];
        usersValueVariables[pid][user] = newUserValueVariables;
        int256 deltaBalance = int256(uint256(newUserValueVariables.balance)) - int256(uint256(previousUserValueVariables.balance)); // pangochef balances are limited to uint104, so no underflow or truncation possible
        int256 deltaSumOfEntryTimes = int256(uint256(newUserValueVariables.sumOfEntryTimes)) - int256(uint256(previousUserValueVariables.sumOfEntryTimes));
        if (newBalance != 0 && deltaBalance == 0 && deltaSumOfEntryTimes == 0) {
            destructiveAction = false; // override because in these circumstances value given by songbird pangochef is invalid. the circumstance happens during `compoundToPoolZero`. songbird pangochef incorrectly returns `true` for it, however it should have been a non-destructive action.
        }

        for (uint256 i; i < rewardTokens.length; ++i) {
            uint256 pendingReward = rewardDebts[user][i] + (rewardAmount * rewardMultipliers[i] / BASE_REWARD_TOKEN_DIVISOR);
            uint256 rewardBal = rewardTokens[i].balanceOf(address(this));
            if (!destructiveAction) {
                rewardDebts[user][i] = pendingReward;
            } else if (pendingReward > rewardBal) {
                rewardDebts[user][i] = pendingReward - rewardBal;
                rewardTokens[i].safeTransfer(user, rewardBal);
            } else {
                rewardDebts[user][i] = 0;
                rewardTokens[i].safeTransfer(user, pendingReward);
            }
        }
    }

    /// @notice Shows pending tokens that can be currently claimed
    function pendingTokens(uint256, address user, uint256 rewardAmount) external view returns (ERC20[] memory tokens, uint256[] memory amounts) {
        amounts = new uint256[](rewardTokens.length);
        for (uint256 i; i < rewardTokens.length; ++i) {
            uint256 pendingReward = rewardDebts[user][i] + (rewardAmount * rewardMultipliers[i] / BASE_REWARD_TOKEN_DIVISOR);
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
    function pendingTokensDebt(uint256, address user, uint256 rewardAmount) external view returns (ERC20[] memory tokens, uint256[] memory amounts) {
        amounts = new uint256[](rewardTokens.length);
        for (uint256 i; i < rewardTokens.length; ++i) {
            uint256 pendingReward = rewardDebts[user][i] + (rewardAmount * rewardMultipliers[i] / BASE_REWARD_TOKEN_DIVISOR);
            amounts[i] = pendingReward;
        }
        return (rewardTokens, amounts);
    }

    /// @notice Overloaded getter for easy access to the reward tokens
    function getRewardTokens() external view returns (ERC20[] memory) {
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
