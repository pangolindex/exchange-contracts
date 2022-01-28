// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract TreasuryVester {
    using SafeERC20 for IERC20;

    struct Recipient{
        address account;
        uint allocation;
    }

    mapping(uint => Recipient) private _recipients;

    uint[5] private _initialVestingPercentages = [2500, 1400, 800, 530, 390];

    address public admin;

    IERC20 public immutable vestedToken;

    bool public vestingEnabled;

    uint public lastUpdate;
    uint private _startingBalance;
    uint private _vestingAmount;
    uint private _recipientsLength;
    uint private _step;
    uint private _vestingPercentage = _initialVestingPercentages[0];
    uint private constant DENOMINATOR = 10000;
    uint private constant STEPS_TO_SLASH = 30;
    uint private constant VESTING_CLIFF = 86400;

    constructor(
        address _vestedToken,
        Recipient[] memory newRecipients
    ) {
        admin = msg.sender;
        vestedToken = IERC20(_vestedToken);
        setRecipients(newRecipients);
    }

    function getRecipients() external view returns (Recipient[] memory) {
        require(_recipientsLength != 0, "no recipient exists");
        Recipient[] memory recipients = new Recipient[](_recipientsLength);
        for (uint i; i < _recipientsLength; ++i) {
            recipients[i] = _recipients[i];
        }
        return recipients;
    }

    function getVestingAmount() public view returns (uint) {
        return
            _startingBalance *
                _vestingPercentage /
                DENOMINATOR /
                STEPS_TO_SLASH;
    }

    function distribute() public {
        require(vestingEnabled, "vesting not enabled");
        require(
            block.timestamp >= lastUpdate + VESTING_CLIFF,
            "too early to distribute"
        );
        lastUpdate = block.timestamp;
        _step++;
        if (_step % STEPS_TO_SLASH == 0) {
            uint slash = _step / STEPS_TO_SLASH;
            if (slash < 5) {
                _vestingPercentage = _initialVestingPercentages[slash];
            } else if (slash < 12) {
                _vestingPercentage -= 20;
            } else if (slash < 20) {
                _vestingPercentage -= 15;
            } else if (slash < 30) {
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
            vestedToken.safeTransfer(
                recipient.account,
                recipient.allocation * _vestingAmount / DENOMINATOR
            );
        }
        emit TokensVested(_vestingAmount);
    }

    function setRecipients(Recipient[] memory newRecipients) public onlyAdmin {
        _recipientsLength = newRecipients.length;
        require(
            _recipientsLength != 0 && _recipientsLength < 21,
            "invalid recipient number"
        );
        uint allocations;
        for (uint i; i < _recipientsLength; ++i) {
            Recipient memory recipient = newRecipients[i];
            require(
                recipient.account != address(0),
                "invalid recipient address"
            );
            require(recipient.allocation != 0, "invalid recipient allocation");
            _recipients[i] = recipient;
            allocations += recipient.allocation;
        }
        require(
            allocations == DENOMINATOR,
            "total allocations do not equal to denominator"
        );
        emit RecipientsChanged(newRecipients);
    }

    /// @notice enable distribution
    /// @dev sufficient amount of vestedToken must exist
    function startVesting() external onlyAdmin {
        require(!vestingEnabled, "vesting already started");
        require(_recipientsLength > 0, "no recipients were set");
        _startingBalance = vestedToken.balanceOf(address(this));
        _vestingAmount = getVestingAmount();
        require(_vestingAmount > 0, "insufficient amount of vestedToken");
        vestingEnabled = true;
        emit VestingEnabled();
    }

    function setAdmin(address newAdmin) external onlyAdmin {
        require(msg.sender == admin, "sender not admin");
        admin = newAdmin;
        emit AdminChanged(admin);
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "unpriviledged message sender");
        _;
    }

    event VestingEnabled();
    event TokensVested(uint amount);
    event RecipientsChanged(Recipient[] newRecipients);
    event AdminChanged(address newAdmin);
}
