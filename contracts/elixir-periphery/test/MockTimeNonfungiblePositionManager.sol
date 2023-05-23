// SPDX-License-Identifier: UNLICENSED
pragma solidity =0.7.6;
pragma abicoder v2;

import "../NonfungiblePositionManager.sol";

contract MockTimeNonfungiblePositionManager is NonfungiblePositionManager {
    uint256 time;

    constructor(
        address _factory,
        address _WETH9,
        address _tokenDescriptor,
        address _elixirRewarder
    )
        NonfungiblePositionManager(
            _factory,
            _WETH9,
            _tokenDescriptor,
            _elixirRewarder
        )
    {}

    function _blockTimestamp() internal view returns (uint256) {
        return time;
    }

    function setTime(uint256 _time) external {
        time = _time;
    }
}
