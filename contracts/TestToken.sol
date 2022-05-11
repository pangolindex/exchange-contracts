// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/*
 * @dev Used for testing standard token logic
 */
contract TestToken is ERC20 {
    uint8 private immutable _decimals;

    constructor(
        string memory name,
        string memory symbol,
        uint8 decimals_,
        uint256 totalSupply,
        address owner
    ) ERC20(name, symbol) {
        _decimals = decimals_;
        _mint(owner, totalSupply);
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }
}
