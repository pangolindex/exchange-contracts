// SPDX-License-Identifier: MIT
// solhint-disable not-rely-on-time
pragma solidity 0.8.13;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "@openzeppelin/contracts/utils/math/SafeCast.sol";
import "../Claimable.sol";

/**
 * @title Allocation Vester
 * @notice Allows allocating and distributing tokens to recipients by vesting
 * it for arbitrary durations for each recipient
 * @author shung for Pangolin
 */
contract AllocationVester is Claimable {
    using SafeCast for uint256;
    using SafeERC20 for IERC20;
    using EnumerableSet for EnumerableSet.AddressSet;

    struct Member {
        uint96 reserve; // remaining tokens to be distributed
        uint96 stash; // tokens stashed when allocation is changed
        uint64 lastUpdate; // timestamp of last harvest
        uint256 rate; // rewards per second
    }

    /// @notice The mapping of member addresses to their properties
    mapping(address => Member) public members;

    /// @notice The set of members who have remaining allocation
    EnumerableSet.AddressSet private _membersAddresses;

    /// @notice The token to be distributed
    IERC20 public immutable token;

    /// @notice The total amount of tokens set to be streamed to all members
    uint256 public reserve;

    /// @notice The minimum duration a vesting can last
    uint256 private constant MIN_DURATION = 8 weeks;

    event AllocationSet(address indexed member, uint256 allocation, uint256 duration);
    event Harvested(address indexed member, uint256 amount);
    event Withdrawn(uint256 amount);

    /**
     * @notice Constructs a new AllocationVester contract
     * @param distributionToken The address of the token to be distributed
     * @dev Distribution token supply must fit 96bits
     */
    constructor(address distributionToken) {
        require(distributionToken != address(0), "zero address");
        token = IERC20(distributionToken);
    }

    /// @notice Claims all the pending rewards of the member
    function harvest() external {
        Member storage member = members[msg.sender];

        // get the claimable rewards of the member
        uint256 amount = pendingHarvest(msg.sender);
        require(amount != 0, "no pending harvest");

        // update the member's properties
        member.lastUpdate = uint64(block.timestamp);
        member.stash = 0;
        member.reserve -= amount.toUint96();

        // free up to-be-transferred tokens from the reserves
        reserve -= amount;

        // remove the member from the set if its harvest has ended
        if (member.reserve == 0) _membersAddresses.remove(msg.sender);

        token.safeTransfer(msg.sender, amount);
        emit Harvested(msg.sender, amount);
    }

    /**
     * @notice Withdraws unallocated tokens from the contract
     * @param amount The amount of tokens to withdraw
     */
    function withdraw(uint256 amount) external onlyOwner {
        require(unreserved() >= amount, "low balance");
        token.safeTransfer(msg.sender, amount);
        emit Withdrawn(amount);
    }

    /**
     * @notice Adds or removes members, or changes their allocations
     * @param accounts An array of member addresses
     * @param allocations The amount of tokens to allocate to the corresponding
     * member, overriding the previous allocation
     * @param durations The duration the corresponding allocation will last for
     * @dev `allocation` for a member must be sufficiently greater than its `duration` such that
     * the `rate` will be precise
     */
    function setAllocations(
        address[] calldata accounts,
        uint256[] calldata allocations,
        uint256[] calldata durations
    ) external onlyOwner {
        uint256 length = accounts.length;
        uint256 tmpReserve = reserve; // gas saving in the for loop
        require(length != 0, "empty array");
        require(
            length == allocations.length && length == durations.length,
            "varying-length arrays"
        );

        for (uint256 i; i < length; ++i) {
            address account = accounts[i];
            uint256 allocation = allocations[i];
            uint256 duration = durations[i];
            Member storage member = members[account];

            require(account != address(0), "bad recipient");

            uint96 tmpMemberReserve = member.reserve; // gas saving

            // check the member's remaining harvest
            if (tmpMemberReserve != 0) {
                // stash pending rewards of the member so it remains claimable
                uint96 tmpMemberStash = uint96(pendingHarvest(account));
                member.stash = tmpMemberStash;
                // free non-stashed reserves of the member from the reserves
                tmpReserve -= (tmpMemberReserve - tmpMemberStash);
                // free non-stashed tokens from member's reserves
                tmpMemberReserve = tmpMemberStash;
            }

            // check the member's new allocation
            if (allocation != 0) {
                require(duration >= MIN_DURATION, "short vesting duration");

                // lock tokens as reserve
                tmpReserve += allocation;

                // add vesting info for the member
                tmpMemberReserve += allocation.toUint96();
                uint256 rate = allocation / duration;
                require(rate != 0, "rate truncated to zero");
                member.rate = rate;
                member.lastUpdate = uint64(block.timestamp);

                // add the member to the set if not already inside the set
                _membersAddresses.add(account);
            } else if (tmpMemberReserve == 0) {
                // remove member from set if has no reserves remaining
                _membersAddresses.remove(account);
            }

            member.reserve = tmpMemberReserve; // assign tmp value back to the storage
            emit AllocationSet(account, allocation, duration);
        }

        // ensure sufficient balance is present for the allocations
        require(token.balanceOf(address(this)) >= tmpReserve, "low balance");
        reserve = tmpReserve; // assign back the tmp value
    }

    /// @notice Returns the list of members for easy access
    function getMembers() external view returns (address[] memory) {
        return _membersAddresses.values();
    }

    /// @notice Returns the claimable rewards of a member
    function pendingHarvest(address account) public view returns (uint256) {
        Member memory member = members[account];

        uint256 amount = member.stash + ((block.timestamp - member.lastUpdate) * member.rate);
        return amount > member.reserve ? member.reserve : amount;
    }

    /// @notice Returns the amount of unallocated tokens in the contract
    function unreserved() public view returns (uint256) {
        return token.balanceOf(address(this)) - reserve;
    }
}
