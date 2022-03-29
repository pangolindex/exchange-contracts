// SPDX-License-Identifier: MIT
// solhint-disable not-rely-on-time
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";
import "../Claimable.sol";

/**
 * @title Allocation Vester
 * @notice Allows allocating and distributing tokens to recipients by vesting
 * it for arbitrary durations for each recipient
 * @author shung for Pangolin
 */
contract AllocationVester is Claimable {
    using EnumerableSet for EnumerableSet.AddressSet;
    using SafeERC20 for IERC20;

    struct Member {
        uint reserve; // remaining tokens to be distributed
        uint stash; // tokens stashed when allocation is changed
        uint rate; // rewards per second
        uint lastUpdate; // timestamp of last harvest
    }

    /// @notice The mapping of member addresses to their properties
    mapping(address => Member) public members;

    /// @notice The set of members who have remaining allocation
    EnumerableSet.AddressSet private _membersAddresses;

    /// @notice The token to be distributed
    IERC20 public immutable token;

    /// @notice The minimum & maximum durations a vesting can last
    uint private constant MIN_DURATION = 8 weeks;
    uint private constant MAX_DURATION = 1_000 * 365 days;

    /// @notice The multiplier for precision when calculationg reward rate
    uint private constant PRECISION = 10_000 * 365 days;

    /// @notice The total amount of tokens set to be streamed to all members
    uint public reserve;

    /// @notice The event emitted when a new allocation is defined for a member
    event AllocationSet(address indexed member, uint allocation, uint duration);

    /// @notice The event emitted when a user harvests their rewards
    event Harvested(address indexed member, uint amount);

    /// @notice The event emitted when the owner withdraws tokens
    event Withdrawn(uint amount);

    /**
     * @notice Constructs a new AllocationVester contract
     * @param distributionToken The address of the token to be distributed
     */
    constructor(IERC20 distributionToken) {
        require(address(distributionToken) != address(0), "zero address");
        token = distributionToken;
    }

    /// @notice Claims all the pending rewards of the member
    function harvest() external {
        address account = msg.sender;
        Member storage member = members[account];

        // get the claimable rewards of the member
        uint amount = pendingHarvest(account);
        require(amount != 0, "no pending harvest");

        // update the member's properties
        member.lastUpdate = block.timestamp;
        member.stash = 0;
        member.reserve -= amount;

        // free up to-be-transferred tokens from the reserves
        reserve -= amount;

        // remove the member from the set if its harvest has ended
        if (member.reserve == 0) _membersAddresses.remove(account);

        token.safeTransfer(account, amount);
        emit Harvested(account, amount);
    }

    /**
     * @notice Withdraws unallocated tokens from the contract
     * @param amount The amount of tokens to withdraw
     */
    function withdraw(uint amount) external onlyOwner {
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
     */
    function setAllocations(
        address[] memory accounts,
        uint[] memory allocations,
        uint[] memory durations
    ) external onlyOwner {
        uint length = accounts.length;
        require(length != 0, "empty array");
        require(length <= 40, "long array");
        require(
            length == allocations.length && length == durations.length,
            "varying-length arrays"
        );

        uint balance = token.balanceOf(address(this));
        for (uint i; i < length; ++i) {
            address account = accounts[i];
            uint allocation = allocations[i];
            uint duration = durations[i];
            Member storage member = members[account];

            require(account != address(0), "bad recipient");

            // check the member's remaining harvest
            if (member.reserve != 0) {
                // stash pending rewards of the member so it remains claimable
                member.stash = pendingHarvest(account);
                // free non-stashed reserves of the member from the reserves
                reserve -= (member.reserve - member.stash);
                // free non-stashed tokens from member's reserves
                member.reserve = member.stash;
            }

            // check the member's new allocation
            if (allocation != 0) {
                require(duration >= MIN_DURATION, "short vesting duration");
                require(duration <= MAX_DURATION, "long vesting duration");

                // lock tokens as reserve and ensure sufficient balance
                reserve += allocation;
                require(balance >= reserve, "low balance");

                // add vesting info for the member
                member.reserve += allocation;
                member.rate = (allocation * PRECISION) / duration;
                member.lastUpdate = block.timestamp;

                // add the member to the set
                _membersAddresses.add(account);
            }

            emit AllocationSet(account, allocation, duration);
        }
    }

    /**
     * @notice Returns a list of members for easy access
     * @dev Although this function can fail on very high number of members,
     * in general usage we do not expect that to happen. In the case that
     * happens, direct storage access or event filtering can be used instead.
     * @return The list of addresses of members who have an allocation
     */
    function getMembers() external view returns (address[] memory) {
        return _membersAddresses.values();
    }

    /**
     * @notice Returns the claimable rewards of a member
     * @param account The address of the member
     * @return The amount of tokens that can be harvested by the member
     */
    function pendingHarvest(address account) public view returns (uint) {
        Member memory member = members[account];

        uint amount = member.stash +
            ((block.timestamp - member.lastUpdate) * member.rate) /
            PRECISION;
        return amount > member.reserve ? member.reserve : amount;
    }

    /**
     * @notice Returns the amount of unallocated tokens
     * @return The amount of unallocated tokens in the contract
     */
    function unreserved() public view returns (uint) {
        return token.balanceOf(address(this)) - reserve;
    }
}
