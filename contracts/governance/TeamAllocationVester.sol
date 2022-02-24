// SPDX-License-Identifier: MIT
// solhint-disable not-rely-on-time
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Simple contract to allocate & vest a token to EOAs
/// @author shung for Pangolin
contract TeamAllocationVester is Ownable {
    using EnumerableSet for EnumerableSet.AddressSet;
    using SafeERC20 for IERC20;

    struct Member {
        /// @notice remaining tokens to be distributed
        uint reserved;
        /// @notice rewards per second
        uint rate;
        /// @notice timestamp of last harvest
        uint lastUpdate;
    }

    /// @notice Set of member addresses with allocations
    EnumerableSet.AddressSet private membersAddresses;

    IERC20 public immutable png;

    mapping(address => Member) public members;

    /// @notice The total amount of tokens set to be streamed to all members
    uint public reserved;

    /// @notice Min duration for the reserved tokens of a member to be vested
    uint public minVestingPeriod = 52 weeks;

    constructor(address allocationToken) {
        png = IERC20(allocationToken);
    }

    function getMembers() external view returns (address[] memory) {
        return membersAddresses.values();
    }

    function membersLength() external view returns (uint) {
        return membersAddresses.length();
    }

    function memberAt(uint index) external view returns (address) {
        return membersAddresses.at(index);
    }

    function pendingHarvest(address account) public view returns (uint) {
        Member memory member = members[account];

        uint amount = (block.timestamp - member.lastUpdate) * member.rate;
        return amount > member.reserved ? member.reserved : amount;
    }

    function harvest(address account) public {
        uint amount = pendingHarvest(account);
        if (amount != 0) {
            members[account].lastUpdate = block.timestamp;
            members[account].reserved -= amount;
            reserved -= amount;
            png.transfer(account, amount);
        }
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
        require(length < 41, "array too long");
        require(
            length == allocations.length && length == vestFor.length,
            "array arguments must be of equal length"
        );

        for (uint i; i < length; ++i) {
            uint allocation = allocations[i];
            uint duration = vestFor[i];
            address account = accounts[i];

            if (members[account].reserved != 0) {
                // send pending rewards if any
                harvest(account);
                // remove remaining account reserve from `reserved`
                // we will add it as allocation in the next statements
                reserved -= members[account].reserved;
            }

            if (allocation != 0) {
                require(
                    duration > minVestingPeriod,
                    "vesting period is too short"
                );
                require(
                    png.balanceOf(address(this)) - reserved >= allocation,
                    "insufficient balance"
                );

                reserved += allocation;
                members[account].reserved = allocation;
                members[account].rate = allocation / duration;
                members[account].lastUpdate = block.timestamp;

                // add the member to the set
                membersAddresses.add(account);
            } else {
                members[account].reserved = 0;
                // remove the member from the set
                membersAddresses.remove(account);
            }
        }

        emit MembersChanged(accounts, allocations);
    }

    function withdraw(uint amount) external onlyOwner {
        require(
            png.balanceOf(address(this)) - reserved >= amount,
            "insufficient balance"
        );
        png.transfer(msg.sender, amount);
    }

    function setMinVestingPeriod(uint newMinVestingPeriod) external onlyOwner {
        require(
            newMinVestingPeriod > 8 weeks,
            "min vesting must be longer than 8 weeks"
        );
        minVestingPeriod = newMinVestingPeriod;
    }

    event MembersChanged(address[] members, uint[] allocation);
}
