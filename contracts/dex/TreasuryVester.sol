// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract TreasuryVester is Ownable {
    using SafeERC20 for IERC20;

    struct Recipient{
        address account;
        uint allocation;
    }

    mapping(uint => Recipient) private _recipients;

    address public admin;

    bool public vestingEnabled;

    IERC20 public immutable vestedToken;

    uint public step;
    uint public lastUpdate;

    uint private constant DENOMINATOR = 10000;
    uint private constant STEPS_TO_SLASH = 30;
    uint private constant VESTING_CLIFF = 86400;
    uint private _startingBalance;
    uint private _vestingAmount;
    uint private _recipientsLength;

    /* The percentage of the 5 first months is constant, after this the percentage
    * is decreased according to the algorithm.
    * two decimals for percentage, 2000 = 20.00%, 505 = 5.05%, 65 = 0.65%
    */
    uint[5] private _initialVestingPercentages = [2500, 1400, 800, 530, 390];

    // Percentage of startingBalance to distribute during between slashes
    uint private _vestingPercentage = _initialVestingPercentages[0];

    constructor(
        address newAdmin,
        address _vestedToken,
        Recipient[] memory newRecipients
    ) {
        admin = newAdmin;
        vestedToken = IERC20(_vestedToken);
        _vestingAmount = getVestingAmount();
        setRecipients(newRecipients);
    }

    function getRecipients() external view returns (Recipient[] memory) {
        require(_recipientsLength != 0, "no recipient exists");
        Recipient[] memory recipients = new Recipient[](_recipientsLength);
        for (uint i; i < _recipientsLength; i++) {
            recipients[i] = Recipient({
                account: _recipients[i].account,
                allocation: _recipients[i].allocation
            });
        }
        return recipients;
    }

    function getVestingAmount() private view returns (uint) {
        return
            _startingBalance *
                _vestingPercentage /
                DENOMINATOR /
                STEPS_TO_SLASH;
    }

    function setAdmin(address newAdmin) public {
        require(msg.sender == admin, "sender not admin");
        admin = newAdmin;
        emit AdminChanged(admin);
    }

    /**
     * @dev Enable distribution. A sufficient amount of vestedToken
     * must be transferred to the contract before enabling.
     */
    function startVesting() external {
        require(msg.sender == admin, "sender not admin");
        require(!vestingEnabled, 'vesting already started');
        require(_recipientsLength > 0, 'no recipients were set');
        _startingBalance = vestedToken.balanceOf(address(this));
        vestingEnabled = true;
        emit VestingEnabled();
    }

    function setRecipients(Recipient[] memory newRecipients) public {
        if (_recipientsLength != 0) {
            require(msg.sender == admin, "sender not admin");
        }
        _recipientsLength = newRecipients.length;
        require(_recipientsLength > 0, "cannot set zero recipients");
        require(_recipientsLength < 51, "cannot set more than 50 recipients");
        uint allocations;
        for (uint i; i < _recipientsLength; i++) {
            Recipient memory recipient = newRecipients[i];
            allocations += recipient.allocation;
            _recipients[i].account = recipient.account;
            _recipients[i].allocation = recipient.allocation;
        }
        require(
            allocations == DENOMINATOR,
            "total allocations do not equal to denominator"
        );
        emit RecipientsChanged(newRecipients);
    }

    function distribute() public {
        require(vestingEnabled, 'vesting not enabled');
        require(
            block.timestamp >= lastUpdate + VESTING_CLIFF,
            'too early to distribute'
        );

        lastUpdate = block.timestamp;
        step++;

        uint slash = step / STEPS_TO_SLASH;
        if (step % STEPS_TO_SLASH == 0 && slash <= 29) {
            if (slash < 5) {
                _vestingPercentage = _initialVestingPercentages[slash];
            } else if (slash < 12) {
                _vestingPercentage -= 20;
            } else if (slash < 20){
                _vestingPercentage -= 15;
            } else {
                _vestingPercentage -= 10;
            }
            _vestingAmount = getVestingAmount();
        }

        uint balance = vestedToken.balanceOf(address(this));
        if (_vestingAmount > balance) {
            _vestingAmount = balance;
        }

        // Distribute the tokens
        for (uint i; i < _recipientsLength; i++) {
            Recipient memory recipient = _recipients[i];
            uint amount = recipient.allocation * _vestingAmount / DENOMINATOR;
            vestedToken.safeTransfer(recipient.account, amount);
        }
        emit TokensVested(_vestingAmount);
    }

    event VestingEnabled();
    event TokensVested(uint amount);
    event RecipientsChanged(Recipient[] newRecipients);
    event AdminChanged(address newAdmin);
}
