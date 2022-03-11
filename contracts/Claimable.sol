// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";

contract Claimable is Ownable {
    address private _pendingOwner;

    function claimOwnership() external {
        require(_msgSender() == _pendingOwner, "Claimable: not pending owner");
        _transferOwnership(_pendingOwner);
    }

    function transferOwnership(address newOwner) public override onlyOwner {
        _pendingOwner = newOwner;
    }
}
