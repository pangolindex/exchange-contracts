// SPDX-License-Identifier: MIT
pragma solidity 0.8.13;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "../Claimable.sol";

/**
 * @title Allocation Vester
 * @author shung for Pangolin
 * @notice This contract allows allocating and distributing tokens to recipients by vesting (i.e.,
 * streaming) it for arbitrary durations for each recipient.
 */
contract AllocationVester is Claimable {
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

    /**
     * @notice The properties of an address. `reserve` is the remaining tokens to be distributed,
     * `stash` is the tokens stored when the allocation changes, `lastUpdate` is the time stamp of
     * the last harvest, and `rate` is the reward tokens per second being vested.
     */
    struct Member {
        uint96 reserve;
        uint96 stash;
        uint64 lastUpdate;
        uint256 rate;
    }

    /**
     * @notice The mapping of member addresses to their properties.
     */
    mapping(address => Member) public members;

    /**
     * @notice The set of members who have any remaining allocation.
     */
    EnumerableSet.AddressSet private _membersAddresses;

    /**
     * @notice The address of the token being distributed.
     */
    IERC20 public immutable token;

    /**
     * @notice The total amount of tokens set to be vested to all members.
     */
    uint256 public reserve;

    /**
     * @notice The minimum duration a vesting can last.
     */
    uint256 public minDuration = 2 weeks;

    /**
     * @notice Emit an event whenever an allocation is changed.
     * @param member The address of the member whose allocation was changed.
     * @param allocation The new amount of tokens allocated for the member.
     * @param duration The time it will take to distribute the whole `allocation`.
     */
    event AllocationSet(address indexed member, uint256 allocation, uint256 duration);

    /**
     * @notice Emit an event whenever the `minDuration` is changed.
     * @param newMinDuration The minimum duration that can be defined for any allocation set after
     * this event.
     */
    event MinDurationSet(uint256 newMinDuration);

    /**
     * @notice Emit an event whenever a member's pending rewards are harvested.
     * @param member The address of the member whose rewards were harvested.
     * @param amount The amount of reward tokens that was harvested.
     */
    event Harvested(address indexed member, uint256 amount);

    /**
     * @notice Emit an event when unallocated tokens from the contract are withdrawn by the admin.
     * @param amount The amount of reward tokens that was withdrawn from the contract.
     */
    event Withdrawn(uint256 amount);

    /**
     * @notice Constructs a new AllocationVester contract.
     * @param distributionToken The address of the token to be distributed.
     */
    constructor(address distributionToken) {
        // Ensure the supplied argument is not null.
        require(distributionToken != address(0), "zero address");

        // Set the reward token to the supplied argument.
        token = IERC20(distributionToken);
    }

    /**
     * @notice External function to claim pending rewards of the caller.
     */
    function harvest() external {
        // Get the member using a storage pointer.
        Member storage member = members[msg.sender];

        // Get the claimable rewards of the member.
        uint256 amount = pendingHarvest(msg.sender);
        require(amount != 0, "no pending harvest");

        // Update the Member properties.
        member.lastUpdate = uint64(block.timestamp);
        member.stash = 0;
        member.reserve -= uint96(amount);

        // Free claimed tokens from the reserves.
        reserve -= amount;

        // Remove the member from the set if it has no allocation remaining.
        if (member.reserve == 0) {
            _membersAddresses.remove(msg.sender);
        }

        // Transfer the rewards from the contract to the member, and then emit an event.
        token.safeTransfer(msg.sender, amount);
        emit Harvested(msg.sender, amount);
    }

    /**
     * @notice External restricted function to withdraw unallocated tokens from the contract.
     * @param amount The amount of tokens to withdraw.
     */
    function withdraw(uint256 amount) external onlyOwner {
        // Ensure only unallocated reward tokens are being withdrawn.
        require(unreserved() >= amount, "low balance");

        // Transfer the tokens from the contract to the owner, and then emit an event.
        token.safeTransfer(msg.sender, amount);
        emit Withdrawn(amount);
    }


    /**
     * @notice External restricted function to add or removes members, or change their allocations.
     * @param accounts An array of member addresses.
     * @param allocations The amount of tokens to allocate to the corresponding member.
     * @param durations The duration the corresponding allocation will last for.
     */
    function setAllocations(
        address[] calldata accounts,
        uint256[] calldata allocations,
        uint256[] calldata durations
    ) external onlyOwner {
        // Record variables in memory to save gas when looping.
        uint256 length = accounts.length;
        uint256 tmpReserve = reserve;
        uint256 tmpMinDuration = minDuration;

        // Ensure all array lengths are equal and non-zero.
        require(length != 0, "empty array");
        require(
            length == allocations.length && length == durations.length,
            "varying-length arrays"
        );

        // Loop through all the supplied members.
        for (uint256 i; i < length; ++i) {
            // Record variables in memory to save gas.
            address account = accounts[i];
            uint256 allocation = allocations[i];
            uint256 duration = durations[i];

            // Ensure the supplied member address is not null.
            require(account != address(0), "bad recipient");

            // Get the member using a storage pointer, and record its reserve.
            Member storage member = members[account];
            uint96 tmpMemberReserve = member.reserve;

            // Check the member's remaining allocation.
            if (tmpMemberReserve != 0) {
                // Stash the pending rewards of the member so it remains claimable.
                uint96 tmpMemberStash = uint96(pendingHarvest(account));
                member.stash = tmpMemberStash;

                // Free non-stashed reserves of the member from the reserves.
                tmpReserve -= (tmpMemberReserve - tmpMemberStash);

                // Free non-stashed tokens from member's reserves.
                tmpMemberReserve = tmpMemberStash;
            }

            // Check the member's new allocation.
            if (allocation != 0) {
                // Ensure duration is at or above the minimum duration and allocation fits 96 bits.
                require(duration >= tmpMinDuration, "short vesting duration");
                require(allocation <= type(uint96).max, "invalid allocation");

                // Lock the new allocation as reserve.
                tmpReserve += allocation;

                // Get reward rate and ensure that is not truncated to zero.
                uint256 rate = allocation / duration;
                require(rate != 0, "rate truncated to zero");

                // Update Member properties.
                tmpMemberReserve += uint96(allocation);
                member.rate = rate;
                member.lastUpdate = uint64(block.timestamp);

                // Add the member to the members set if it is not already included in the set.
                _membersAddresses.add(account);
            } else if (tmpMemberReserve == 0) {
                // Remove member from the set if has no reserves remaining.
                _membersAddresses.remove(account);
            }

            // Assign back the temporary variable to the member storage property.
            member.reserve = tmpMemberReserve;

            // Emit an event for the new allocation.
            emit AllocationSet(account, allocation, duration);
        }

        // Ensure sufficient balance is present for the allocations.
        require(token.balanceOf(address(this)) >= tmpReserve, "low balance");

        // Assign back the temporary variable to the storage.
        reserve = tmpReserve;
    }

    /**
     * @notice External restricted function to change the minimum duration.
     * @param newMinDuration The new minimum duration a vesting can last for.
     */
    function setMinDuration(uint256 newMinDuration) external onlyOwner {
        // Ensure the supplied argument is not null.
        require(newMinDuration != 0, "zero duration");

        // Set minimum duration and emit an event.
        minDuration = newMinDuration;
        emit MinDurationSet(newMinDuration);
    }

    /**
     * @notice External view function to get all active the members.
     * @return The list of all members who have remaining allocation.
     */
    function getMembers() external view returns (address[] memory) {
        return _membersAddresses.values();
    }

    /**
     * @notice Public view function to get the amount of pending reward tokens of a member.
     * @param account The address of the member.
     * @return The amount of harvestable reward tokens of the member.
     */
    function pendingHarvest(address account) public view returns (uint256) {
        // Get the member into the memory.
        Member memory member = members[account];

        // Get the amount by adding stashed amount to reward rate multiplied by time.
        uint256 amount = member.stash + ((block.timestamp - member.lastUpdate) * member.rate);

        // Clamp the returned amount to member's reserve amount.
        return amount > member.reserve ? member.reserve : amount;
    }

    /**
     * @notice Public view function to get the amount of unallocated reward tokens in the contract.
     * @return The amount of unallocated reward tokens in the contract.
     */
    function unreserved() public view returns (uint256) {
        return token.balanceOf(address(this)) - reserve;
    }
}
