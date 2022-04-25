// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";

abstract contract Claimable is Ownable {
    address private _pendingOwner;

    event PendingOwnerSet(address indexed pendingOwner);

    function claimOwnership() external {
        require(_msgSender() == _pendingOwner, "Claimable: not pending owner");
        _transferOwnership(_pendingOwner);
        delete _pendingOwner;
    }

    function transferOwnership(address newOwner) public override onlyOwner {
        _pendingOwner = newOwner;
        emit PendingOwnerSet(newOwner);
    }

    function pendingOwner() public view virtual returns (address) {
        return _pendingOwner;
    }
}
