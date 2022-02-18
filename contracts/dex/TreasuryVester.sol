// SPDX-License-Identifier: MIT
// solhint-disable  not-rely-on-time
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

interface IMiniChefV2 {
    function fundRewards(uint256 newFunding, uint256 duration) external;
}

interface IPng is IERC20 {
    function mint(address dst, uint rawAmount) external returns (bool);
}

/**
 * @notice A contract that vests & distributes tokens.
 * It only distributes a single token with a `mint` function.
 */
contract TreasuryVester is Ownable {
    using SafeERC20 for IPng;

    struct Recipient{
        address account;
        uint allocation;
        bool isMiniChef;
    }

    /// @notice The list of recipients who have an allocation
    mapping(uint => Recipient) private _recipients;

    /// @notice The multisig who can initialize the vesting
    address public guardian;

    /// @notice The token to be vested/minted
    IPng public immutable vestedToken;

    /// @notice Whether the vesting is enabled or not
    bool public vestingEnabled;

    /// @notice The time stamp of the last vesting
    uint public lastUpdate;

    /// @notice The number of vestings that took place
    uint public step;

    /// @notice The total amount of tokens that are being vested
    uint public immutable startingBalance;

    /// @notice The amount of tokens that was distributed on the last vesting
    uint private _vestingAmount;

    /// @notice The number of recipients
    uint private _recipientsLength;

    /// @notice The proportion of tokens that are being distributed this month
    uint private _vestingPercentage;

    /// @notice The proportion of tokens to be distributed in the first 5 months
    uint[5] private _initialVestingPercentages = [2500, 1400, 800, 530, 390];

    /// @notice The denominator for both the allocations and the vesting percentages
    uint private constant DENOMINATOR = 10000;

    /// @notice The minimum duration between two vestings (i.e.: 1 day)
    uint private constant VESTING_CLIFF = 86400;

    /// @notice The number of steps before decreasing the vesting percentage (i.e.: 1 month)
    uint private constant STEPS_TO_SLASH = 30;

    /**
     * @notice Construct a new TreasuryVester contract
     * @param newVestedToken The token that is being vested & distributed
     * @param newStartingBalance The total number of tokens to be distributed
     * @param newRecipients Recipients with an allocation
     * @param newGuardian An authorized address that can initialize the vesting
     */
    constructor(
        address newVestedToken,
        uint newStartingBalance,
        Recipient[] memory newRecipients,
        address newGuardian
    ) {
        require(newStartingBalance > 0, "TreasuryVester::Constructor: invalid starting balance");
        require(newGuardian != address(0), "TreasuryVester::Constructor: invalid guardian address");
        guardian = newGuardian;
        vestedToken = IPng(newVestedToken);
        startingBalance = newStartingBalance;
        setRecipients(newRecipients);
    }

    /**
     * @notice Interfacing function that displays all recipients
     * @return The list of current recipients and their allocations
     */
    function getRecipients() external view returns (Recipient[] memory) {
        require(_recipientsLength != 0, "TreasuryVester::getRecipients: no recipients exist");
        Recipient[] memory recipients = new Recipient[](_recipientsLength);
        for (uint i; i < _recipientsLength; ++i) {
            recipients[i] = _recipients[i];
        }
        return recipients;
    }

    /**
     * @notice Gets the amount of tokens distributed at each vesting
     * @dev When externally called, the next distribution amount will be less than the returned amount every 30th step
     * @return The current amount of tokens distributed at each vesting
     */
    function getVestingAmount() public view returns (uint) {
        return
            startingBalance *
                _vestingPercentage /
                DENOMINATOR /
                STEPS_TO_SLASH;
    }

    /**
     * @notice Distributes the tokens to recipients based on their allocation
     * @dev If the vesting is enabled, anyone can call this function with 1 day intervals
     */
    function distribute() public {
        require(vestingEnabled, "TreasuryVester::distribute: vesting is not enabled");
        require(
            block.timestamp >= lastUpdate + VESTING_CLIFF,
            "TreasuryVester::distribute: it is too early to distribute"
        );
        lastUpdate = block.timestamp;

        // defines a vesting schedule that lasts for 30 months
        if (step % STEPS_TO_SLASH == 0) {
            uint slash = step / STEPS_TO_SLASH;
            if (slash < 5) {
                _vestingPercentage = _initialVestingPercentages[slash];
            } else if (slash < 12) {
                _vestingPercentage -= 20;
            } else if (slash < 20) {
                _vestingPercentage -= 15;
            } else if (slash < 30) {
                _vestingPercentage -= 10;
            } else {
               revert("TreasuryVester::distribute: vesting is over");
            }
            _vestingAmount = getVestingAmount();
        }
        step++;

        // distributes _vestingAmount of tokens to recipients based on their allocation
        for (uint i; i < _recipientsLength; i++) {
            Recipient memory recipient = _recipients[i];
            uint amount = recipient.allocation * _vestingAmount / DENOMINATOR;
            if (!recipient.isMiniChef) {
                // simply mints or transfer tokens to regular recipients
                vestedToken.mint(recipient.account, amount);
            } else {
                // calls fund rewards of minichef after minting tokens to self
                vestedToken.mint(address(this), amount);
                vestedToken.approve(recipient.account, amount);
                IMiniChefV2(recipient.account).fundRewards(amount, VESTING_CLIFF);
            }
        }
        emit TokensVested(_vestingAmount);
    }

    /**
     * @notice Adds new recipients by overriding old recipients
     * @dev Only callable by the owner (i.e.: governance)
     * @param newRecipients An array of new recipients with allocation
     */
    function setRecipients(Recipient[] memory newRecipients) public onlyOwner {
        _recipientsLength = newRecipients.length;
        require(
            _recipientsLength != 0,
            "TreasuryVester::setRecipients: invalid recipient number"
        );
        uint allocations;
        for (uint i; i < _recipientsLength; ++i) {
            Recipient memory recipient = newRecipients[i];
            require(
                recipient.account != address(0),
                "TreasuryVester::setRecipients: invalid recipient address"
            );
            require(
                recipient.allocation != 0,
                "TreasuryVester::setRecipients: invalid recipient allocation"
            );
            _recipients[i] = recipient;
            allocations += recipient.allocation;
        }
        require(
            allocations == DENOMINATOR,
            "TreasuryVester::setRecipients: invalid total allocation"
        );
        emit RecipientsChanged(newRecipients);
    }

    /**
     * @notice Enables distribution of the tokens
     * @dev Callable by either the owner (i.e.: governance) or guardian
     */
    function startVesting() external {
        require(
            msg.sender == guardian || msg.sender == owner(),
            "TreasuryVester::startVesting: unauthorized message sender"
        );
        require(
            !vestingEnabled,
            "TreasuryVester::startVesting: vesting is already enabled"
        );
        _vestingAmount = getVestingAmount();
        vestingEnabled = true;
        emit VestingEnabled();
    }

    /// @notice An event that is emitted when vesting is enabled
    event VestingEnabled();

    /// @notice An event that is emitted when tokens are distributed
    event TokensVested(uint amount);

    /// @notice An event that is emitted when recipients are changed
    event RecipientsChanged(Recipient[] newRecipients);
}
