// SPDX-License-Identifier: GPLv3
pragma solidity ^0.8.0;

interface IPangolinPair {
    function token0() external view returns (address);

    function token1() external view returns (address);

    function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32);

    function mint(address to) external returns (uint256 liquidity);
}
