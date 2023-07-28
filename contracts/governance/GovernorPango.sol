pragma solidity =0.8.15;

import "./interfaces/IPangolinStakingPositions.sol";
import "./interfaces/ITimelock.sol";

// SPDX-License-Identifier: MIT
/*
 * @notice GovernorPango is an adaptation of GovernorAlpha intended to work with PangolinStakingPositions NFTs
 *         on an evm compatible blockchain. The proposal lifecycle is the same as GovernorAlpha but additional
 *         restrictions are imposed:
 *
 *         1) Proposers must hold an NFT that has not been modified for the duration of 1+ proposal lifecycle
 *         2) The voting power of an NFT used for proposing will be invalid for the duration of one proposal lifecycle
 *         3) Voters must own an NFT that has not been modified after the voting period starts
 *         4) An NFT cannot be used for voting on the same proposal multiple times, regardless of ownership
 *         5) The proposer is always allowed to cancel the proposal before voting begins
 */
contract GovernorPango {
    /// @notice The delay before voting on a proposal may take place, once proposed
    /// @dev Can be changed via vote within the range: [1 days, 7 days]
    uint40 public VOTING_DELAY = 1 days;

    /// @notice The duration of voting on a proposal, in seconds
    /// @dev Can be changed via vote within the range: [3 days, 30 days]
    uint40 public VOTING_PERIOD = 3 days;

    /// @notice The number of votes required in order for a voter to become a proposer
    /// @dev Can be changed via vote within the range: [PROPOSAL_THRESHOLD_MIN, PROPOSAL_THRESHOLD_MAX]
    uint96 public PROPOSAL_THRESHOLD;
    uint96 public immutable PROPOSAL_THRESHOLD_MIN;
    uint96 public immutable PROPOSAL_THRESHOLD_MAX;

    /// @notice Associated Timelock contract
    ITimelock public immutable TIMELOCK;

    /// @notice Associated PangolinStakingPositions contract
    IPangolinStakingPositions public immutable PANGOLIN_STAKING_POSITIONS;

    /// @notice The total number of proposals
    uint256 public proposalCount;

    /// @notice The record of all proposals
    /// ProposalId => ProposalStruct
    mapping(uint64 => Proposal) public proposals;

    /// @notice The record of all proposal actions
    /// ProposalId => ProposalActionStruct
    mapping(uint64 => ProposalAction) private proposalActions;

    /// @notice The record of all receipts for a given proposal id
    /// @notice ProposalId => NftId => ReceiptStruct
    mapping(uint64 => mapping(uint256 => Receipt)) public receipts;

    /// @notice Timestamp when a NFT can be used to propose again
    /// @dev State growth rate is limited by PROPOSAL_THRESHOLD and the lifecycle time of a proposal.
    /// NftId => TimeoutTime
    mapping(uint256 => uint40) public proposalTimeout;

    /// @notice Possible states that a proposal may be in
    enum ProposalState {
        Pending,
        Active,
        Canceled,
        Defeated,
        Succeeded,
        Queued,
        Expired,
        Executed
    }

    struct Proposal {
        /// @notice The NFT which provided the voting weight for this proposal
        uint256 proposer;

        /// @notice Current number of votes in favor of this proposal
        uint96 forVotes;

        /// @notice Current number of votes in opposition to this proposal
        uint96 againstVotes;

        /// @notice The timestamp at which voting begins: holders must delegate their votes prior to this time
        uint40 startTime;

        /// @notice The timestamp at which voting ends: votes must be cast prior to this time
        uint40 endTime;

        /// @notice The timestamp that the proposal will be available for execution, set once the vote succeeds
        uint40 eta;

        /// @notice Flag marking whether the proposal has been executed
        bool executed;

        /// @notice Flag marking whether the proposal has been canceled
        bool canceled;
    }

    struct ProposalAction {
        /// @notice the ordered list of target addresses for calls to be made
        address[] targets;

        /// @notice The ordered list of values (i.e. msg.value) to be passed to the calls to be made
        uint256[] values;

        /// @notice The ordered list of function signatures to be called
        string[] signatures;

        /// @notice The ordered list of calldata to be passed to each call
        bytes[] calldatas;
    }

    struct Receipt {
        /// @notice Whether or not a vote has been cast
        bool hasVoted;

        /// @notice Whether or not the voter supports the proposal
        bool support;

        /// @notice The number of votes the voter had, which were cast
        uint96 votes;
    }

    event ProposalCreated(uint64 proposalId, address[] targets, uint256[] values, string[] signatures, bytes[] calldatas, uint40 startTime, uint40 endTime, string description);
    event ProposalCanceled(uint64 proposalId);
    event VoteCast(uint64 proposalId, bool support, uint96 votes);
    event ProposalQueued(uint64 proposalId, uint40 eta);
    event ProposalExecuted(uint64 proposalId);
    event ProposalThresholdChanged(uint96 newProposalThreshold);
    event VotingDelayChanged(uint40 newVotingDelay);
    event VotingPeriodChanged(uint40 newVotingPeriod);

    error InvalidAction();
    error InsufficientVotes();
    error IllegalVote();
    error InvalidNFT();
    error InvalidOwner();
    error InvalidState();

    constructor(
        address _TIMELOCK,
        address _PANGOLIN_STAKING_POSITIONS,
        uint96 _PROPOSAL_THRESHOLD,
        uint96 _PROPOSAL_THRESHOLD_MIN,
        uint96 _PROPOSAL_THRESHOLD_MAX
    ) {
        if (_PROPOSAL_THRESHOLD_MIN > _PROPOSAL_THRESHOLD_MAX) revert InvalidAction();
        if (_PROPOSAL_THRESHOLD < _PROPOSAL_THRESHOLD_MIN) revert InvalidAction();
        if (_PROPOSAL_THRESHOLD > _PROPOSAL_THRESHOLD_MAX) revert InvalidAction();
        TIMELOCK = ITimelock(_TIMELOCK);
        PANGOLIN_STAKING_POSITIONS = IPangolinStakingPositions(_PANGOLIN_STAKING_POSITIONS);
        PROPOSAL_THRESHOLD = _PROPOSAL_THRESHOLD;
        PROPOSAL_THRESHOLD_MIN = _PROPOSAL_THRESHOLD_MIN;
        PROPOSAL_THRESHOLD_MAX = _PROPOSAL_THRESHOLD_MAX;
    }

    /*
     * @dev Proposers must own an NFT with voting power of at least PROPOSAL_THRESHOLD. This NFT must not have been
     *      updated for a duration of 1+ proposal lifecycle before proposing.
     */
    function propose(
        address[] memory targets,
        uint256[] memory values,
        string[] memory signatures,
        bytes[] memory calldatas,
        string memory description,
        uint256 nftId
    ) external returns (uint64 proposalId) {
        if (targets.length != values.length || targets.length != signatures.length || targets.length != calldatas.length) revert InvalidAction();
        if (targets.length > 10) revert InvalidAction();

        _verifyOwnership(nftId);

        uint40 startTime = uint40(block.timestamp) + VOTING_DELAY;
        uint40 endTime = startTime + VOTING_PERIOD;
        uint40 proposalLifeCycleTime = VOTING_DELAY + VOTING_PERIOD + uint40(TIMELOCK.delay()); // Range: [4 days, 67 days]

        // Ensure enough voting power exists and has not been altered recently
        // By using a timestamp predated by the lifecycle of a proposal, spam can be prevented from the same underlying voting power
        if (_getNftValueAt(nftId, uint40(block.timestamp) - proposalLifeCycleTime) < PROPOSAL_THRESHOLD) revert InsufficientVotes();

        // Prevent usage of NFT voting weight to concurrently create proposals
        if (block.timestamp < proposalTimeout[nftId]) revert InsufficientVotes();
        proposalTimeout[nftId] = uint40(block.timestamp) + proposalLifeCycleTime;

        proposalId = uint64(++proposalCount);

        Proposal memory newProposal;
        newProposal.proposer = nftId;
        newProposal.startTime = startTime;
        newProposal.endTime = endTime;

        proposals[proposalId] = newProposal;

        ProposalAction memory newProposalAction;
        newProposalAction.targets = targets;
        newProposalAction.values = values;
        newProposalAction.signatures = signatures;
        newProposalAction.calldatas = calldatas;

        proposalActions[proposalId] = newProposalAction;

        emit ProposalCreated(proposalId, targets, values, signatures, calldatas, startTime, endTime, description);
    }

    /*
     * @dev Non-executed proposals can be canceled when the proposer fails to maintain sufficient voting power
     *      Proposals can also be canceled by the owner of the proposal's proposing NFT before voting begins
     */
    function cancel(uint64 proposalId) external {
        Proposal storage proposal = proposals[proposalId];
        ProposalState proposalState = _state(proposal);
        if (proposalState == ProposalState.Executed || proposalState == ProposalState.Expired) revert InvalidState();

        // Pending proposals maintaining sufficient voting power can only be canceled by the proposer NFT owner
        if (_getNftValueAt(proposal.proposer, uint40(block.timestamp)) >= PROPOSAL_THRESHOLD) {
            if (proposalState == ProposalState.Pending) {
                _verifyOwnership(proposal.proposer);
            } else {
                revert InvalidState();
            }
        }

        proposal.canceled = true;

        emit ProposalCanceled(proposalId);
    }

    function castVote(uint64 proposalId, bool support, uint256 nftId) external {
        Proposal storage proposal = proposals[proposalId];
        if (_state(proposal) != ProposalState.Active) revert InvalidState();

        _verifyOwnership(nftId);

        // Verify NFT was not updated after voting began
        uint96 votes = _getNftValueAt(nftId, proposal.startTime);
        if (votes == 0) revert InsufficientVotes();

        // Verify NFT can only vote once
        Receipt storage receipt = receipts[proposalId][nftId];
        if (receipt.hasVoted) revert IllegalVote();

        // Cast vote
        receipt.hasVoted = true;
        receipt.support = support;
        receipt.votes = votes;

        if (support) {
            proposal.forVotes += votes;
        } else {
            proposal.againstVotes += votes;
        }

        emit VoteCast(proposalId, support, votes);
    }

    function queue(uint64 proposalId) external {
        Proposal storage proposal = proposals[proposalId];
        if (_state(proposal) != ProposalState.Succeeded) revert InvalidState();

        ProposalAction storage action = proposalActions[proposalId];

        uint40 eta = uint40(block.timestamp + TIMELOCK.delay());

        uint256 length = action.targets.length;
        for (uint256 i; i < length;) {
            _queueOrRevert(action.targets[i], action.values[i], action.signatures[i], action.calldatas[i], eta);
            unchecked {++i;}
        }

        proposal.eta = eta;

        emit ProposalQueued(proposalId, eta);
    }

    function _queueOrRevert(address target, uint256 value, string memory signature, bytes memory data, uint40 eta) private {
        if (TIMELOCK.queuedTransactions(keccak256(abi.encode(target, value, signature, data, eta)))) revert InvalidState();
        TIMELOCK.queueTransaction(target, value, signature, data, eta);
    }

    /*
     * @notice Execute a proposal in the Queued state
     * @notice Proposals in a valid executable state can be executed by anyone
     */
    function execute(uint64 proposalId) external payable {
        Proposal storage proposal = proposals[proposalId];
        if (_state(proposal) != ProposalState.Queued) revert InvalidState();

        ProposalAction storage action = proposalActions[proposalId];

        uint256 length = action.targets.length;
        for (uint256 i; i < length;) {
            TIMELOCK.executeTransaction{value: action.values[i]}(action.targets[i], action.values[i], action.signatures[i], action.calldatas[i], proposal.eta);
            unchecked {++i;}
        }

        proposal.executed = true;

        emit ProposalExecuted(proposalId);
    }

    /*
     * @notice UX supporting method for ease of querying proposal state
     */
    function state(uint64 proposalId) external view returns (ProposalState) {
        return _state(proposals[proposalId]);
    }

    /*
     * @notice Business logic for determining the state of a proposal
     */
    function _state(Proposal memory proposal) private view returns (ProposalState) {
        if (proposal.canceled) {
            return ProposalState.Canceled;
        } else if (block.timestamp <= proposal.startTime) {
            return ProposalState.Pending;
        } else if (block.timestamp <= proposal.endTime) {
            return ProposalState.Active;
        } else if (proposal.forVotes <= proposal.againstVotes) {
            return ProposalState.Defeated;
        } else if (proposal.eta == 0) {
            return ProposalState.Succeeded;
        } else if (proposal.executed) {
            return ProposalState.Executed;
        } else if (block.timestamp >= proposal.eta + TIMELOCK.GRACE_PERIOD()) {
            return ProposalState.Expired;
        } else {
            return ProposalState.Queued;
        }
    }

    /*
     * @notice Helper method to expose proposal execution data.
     */
    function getActions(uint64 proposalId) external view returns (ProposalAction memory) {
        return proposalActions[proposalId];
    }

    /*
     * @notice Ensure the NFT is owned by `msg.sender` and revert when not satisfied.
     */
    function _verifyOwnership(uint256 nftId) private view {
        if (PANGOLIN_STAKING_POSITIONS.ownerOf(nftId) != msg.sender) revert InvalidOwner();
    }

    /*
     * @dev This is how voting power is calculated from the NFT.
     *      The NFT must not have been modified after `timestamp` for the voting power to be valid.
     */
    function _getNftValueAt(uint256 nftId, uint40 timestamp) private view returns (uint96) {
        if (nftId <= 0) revert InvalidNFT();
        IPangolinStakingPositions.Position memory position = PANGOLIN_STAKING_POSITIONS.positions(nftId);
        if (position.lastUpdate < timestamp) {
            return position.valueVariables.balance;
        } else {
            return 0;
        }
    }

    function __acceptAdmin() external {
        TIMELOCK.acceptAdmin();
    }

    function __setProposalThreshold(uint96 newProposalThreshold) external {
        if (msg.sender != address(TIMELOCK)) revert InvalidAction();
        if (newProposalThreshold < PROPOSAL_THRESHOLD_MIN) revert InvalidAction();
        if (newProposalThreshold > PROPOSAL_THRESHOLD_MAX) revert InvalidAction();
        PROPOSAL_THRESHOLD = newProposalThreshold;
        emit ProposalThresholdChanged(newProposalThreshold);
    }

    function __setVotingDelay(uint40 newVotingDelay) external {
        if (msg.sender != address(TIMELOCK)) revert InvalidAction();
        if (newVotingDelay < 1 days) revert InvalidAction();
        if (newVotingDelay > 7 days) revert InvalidAction();
        VOTING_DELAY = newVotingDelay;
        emit VotingDelayChanged(newVotingDelay);
    }

    function __setVotingPeriod(uint40 newVotingPeriod) external {
        if (msg.sender != address(TIMELOCK)) revert InvalidAction();
        if (newVotingPeriod < 3 days) revert InvalidAction();
        if (newVotingPeriod > 30 days) revert InvalidAction();
        VOTING_PERIOD = newVotingPeriod;
        emit VotingPeriodChanged(newVotingPeriod);
    }
}
