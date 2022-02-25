// SPDX-License-Identifier: GPLv3
// solhint-disable not-rely-on-time
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @title A contract that allocates & vests a token to EOAs
/// @author shung for Pangolin
contract TeamAllocationVester is Ownable {
    using EnumerableSet for EnumerableSet.AddressSet;
    using SafeERC20 for IERC20;

    struct Member {
        uint reserved;   // remaining tokens to be distributed
        uint rate;       // rewards per second
        uint lastUpdate; // timestamp of last harvest
    }

    mapping(address => Member) public members;

    EnumerableSet.AddressSet private _membersAddresses;

    IERC20 public immutable png;

    /// @notice The total amount of tokens set to be streamed to all members
    uint public reserved;

    event MembersChanged(address[] members, uint[] allocation);

    constructor(address allocationToken) {
        png = IERC20(allocationToken);
    }

    function harvest(address account) external {
        uint amount = pendingHarvest(account);
        require(amount != 0, "no pending harvest");
        members[account].lastUpdate = block.timestamp;
        members[account].reserved -= amount;
        reserved -= amount;
        png.safeTransfer(account, amount);
    }

    function withdraw(uint amount) external onlyOwner {
        require(unreserved() >= amount, "low balance");
        png.safeTransfer(msg.sender, amount);
    }

    /**
     * @notice Adds or removes members, or changes their allocations
     * @param accounts An array of member addresses
     * @param allocations The amount of tokens to allocate to the corresponding
     * member, overriding the previous allocation
     * @param vestFor The duration the corresponding allocation will last for
     */
    function setAllocations(
        address[] memory accounts,
        uint[] memory allocations,
        uint[] memory vestFor
    ) external onlyOwner {
        uint length = accounts.length;
        require(length < 41, "long array");
        require(length > 0, "empty array");
        require(
            length == allocations.length && length == vestFor.length,
            "varying-length arrays"
        );

        uint balance = png.balanceOf(address(this));
        for (uint i; i < length; ++i) {
            uint allocation = allocations[i];
            uint duration = vestFor[i];
            address account = accounts[i];

            require(account != address(0), "bad recipient");

            uint unclaimed;
            if (members[account].reserved != 0) {
                // record any unclaimed rewards of member
                unclaimed = pendingHarvest(account);
                balance -= unclaimed;
                // free png that was locked for this member’s allocation
                reserved -= members[account].reserved;
            }

            if (allocation != 0) {
                require(duration >= 8 weeks, "short vesting duration");
                require(balance - reserved >= allocation, "low balance");

                // lock png as reserved
                reserved += allocation;

                // add vesting info for the member
                members[account].reserved = allocation;
                members[account].rate = allocation / duration;
                members[account].lastUpdate = block.timestamp;

                // add the member to the set for easy access
                _membersAddresses.add(account);
            } else {
                // remove member’s allocation
                members[account].reserved = 0;
                // remove the member from the set
                _membersAddresses.remove(account);
            }

            if (unclaimed != 0) png.safeTransfer(account, unclaimed);
        }

        emit MembersChanged(accounts, allocations);
    }

    function getMembers() external view returns (address[] memory) {
        return _membersAddresses.values();
    }

    function pendingHarvest(address account) public view returns (uint) {
        Member memory member = members[account];

        uint amount = (block.timestamp - member.lastUpdate) * member.rate;
        return amount > member.reserved ? member.reserved : amount;
    }

    function unreserved() public view returns (uint) {
        return png.balanceOf(address(this)) - reserved;
    }
}
