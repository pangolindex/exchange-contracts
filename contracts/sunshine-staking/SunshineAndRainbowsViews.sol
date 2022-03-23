// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface ISunshineAndRainbows {
    function positions(uint)
        external
        view
        returns (
            uint reward,
            uint balance,
            uint lastUpdate,
            uint rewardsPerStakingDuration,
            uint idealPosition,
            address owner
        );

    function rewardRates(uint[] calldata posIds)
        external
        view
        returns (uint[] memory);

    function pendingRewards(uint[] calldata posIds)
        external
        view
        returns (uint[] memory);

    function positionsOf(address) external view returns (uint[] memory);
}

/**
 * @title Sunshine and Rainbows: External View Functions
 * @author shung for Pangolin
 */
contract SunshineAndRainbowsViews {
    struct PositionInfo {
        uint id;
        uint rate;
        uint reward;
        uint balance;
        uint lastUpdate;
    }

    function getUserPositions(ISunshineAndRainbows sar, address user)
        external
        view
        returns (PositionInfo[] memory)
    {
        return (getPositionInfos(sar, sar.positionsOf(user)));
    }

    function getPositionInfos(ISunshineAndRainbows sar, uint[] memory posIds)
        public
        view
        returns (PositionInfo[] memory)
    {
        uint[] memory rewardRates = sar.rewardRates(posIds);
        uint[] memory pendingRewards = sar.pendingRewards(posIds);
        PositionInfo[] memory positions = new PositionInfo[](posIds.length);
        for (uint i; i < posIds.length; ++i) {
            (, uint balance, uint lastUpdate, , , ) = sar.positions(posIds[i]);
            positions[i] = PositionInfo(
                posIds[i],
                rewardRates[i],
                pendingRewards[i],
                balance,
                lastUpdate
            );
        }
        return positions;
    }
}
