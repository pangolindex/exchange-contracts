// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";

abstract contract Claimable is Ownable {
    address private _pendingOwner;

    event PendingOwnerSet(address indexed pendingOwner);

    constructor() {
        _pendingOwner = _msgSender();
    }

    function claimOwnership() external {
        require(_msgSender() == _pendingOwner, "Claimable: not pending owner");
        _transferOwnership(_pendingOwner);
    }

    function transferOwnership(address newOwner) public virtual override onlyOwner {
        _pendingOwner = newOwner;
        emit PendingOwnerSet(newOwner);
    }

    function renounceOwnership() public virtual override onlyOwner {
        require(_pendingOwner == address(0), "Claimable: pending owner not zero address");
        _transferOwnership(address(0));
    }

    function pendingOwner() public view virtual returns (address) {
        return _pendingOwner;
    }
}
