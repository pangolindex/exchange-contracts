pragma solidity >=0.8.0;

// SPDX-License-Identifier: MIT
interface IPangolinStakingPositions {
    struct ValueVariables {
        uint96 balance;
        uint160 sumOfEntryTimes;
    }

    struct RewardSummations {
        uint256 idealPosition;
        uint256 rewardPerValue;
    }

    struct Position {
        ValueVariables valueVariables;
        RewardSummations rewardSummationsPaid;
        uint160 previousValues;
        uint48 lastUpdate;
        uint48 lastDevaluation;
    }

    function positions(uint256 positionId) external view returns (Position memory);
    function ownerOf(uint256 tokenId) external view returns (address owner);
}
