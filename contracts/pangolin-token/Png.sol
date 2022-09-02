// SPDX-License-Identifier: MIT
pragma solidity 0.8.15;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Capped.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import "@openzeppelin/contracts/token/ERC20/extensions/draft-ERC20Permit.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract Png is ERC20, ERC20Burnable, ERC20Capped, ERC20Permit, Ownable {
    constructor(uint96 cap_, uint96 preMint, string memory name_, string memory symbol_)
        ERC20(name_, symbol_)
        ERC20Capped(cap_)
        ERC20Permit(name_)
    {
        _mint(msg.sender, preMint);
    }

    function mint(address to, uint256 amount) external onlyOwner {
        _mint(to, amount);
    }

    function _mint(address to, uint256 amount) internal override(ERC20, ERC20Capped) {
        super._mint(to, amount);
    }
}
