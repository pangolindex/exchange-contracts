// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IMiniChefV2 {
    function fundRewards(uint256 newFunding, uint256 duration) external;
}

contract TreasuryVester {
    using SafeERC20 for IERC20;

    struct Recipient{
        address account;
        uint allocation;
        bool isMiniChef;
    }

    mapping(uint => Recipient) private _recipients;

    uint[5] private _initialVestingPercentages = [2500, 1400, 800, 530, 390];

    address public admin;
    address public guardian;

    IERC20 public immutable vestedToken;

    bool public vestingEnabled;

    uint public lastUpdate;
    uint private _vestingAmount;
    uint private _recipientsLength;
    uint private _step;
    uint private _vestingPercentage;
    uint private immutable _startingBalance;
    uint private constant DENOMINATOR = 10000;
    uint private constant STEPS_TO_SLASH = 30;
    uint private constant VESTING_CLIFF = 86400;

    constructor(
        address vestedToken_,
        uint startingBalance_,
        Recipient[] memory newRecipients,
        address guardian_
    ) {
        require(startingBalance_ > 0, "cannot have zero starting balance");
        require(guardian_ != address(0), "invalid guardian address");
        guardian = guardian_;
        admin = msg.sender;
        vestedToken = IERC20(vestedToken_);
        _startingBalance = startingBalance_;
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
        _step++;
        uint balance = vestedToken.balanceOf(address(this));
        require(balance >= DENOMINATOR, "too little to distribute");
        if (_vestingAmount > balance) {
            _vestingAmount = balance;
        }
        // Distribute the tokens. Leaves dust but who cares.
        for (uint i; i < _recipientsLength; i++) {
            Recipient memory recipient = _recipients[i];
            uint allocation =
                recipient.allocation * _vestingAmount / DENOMINATOR;
            if (!recipient.isMiniChef) {
                vestedToken.safeTransfer(
                    recipient.account,
                    allocation
                );
            } else {
                vestedToken.approve(recipient.account, allocation);
                IMiniChefV2(recipient.account)
                    .fundRewards(
                        allocation,
                        VESTING_CLIFF
                    );
            }
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
    function startVesting() external {
        require(
            msg.sender == guardian || msg.sender == admin,
            "unprivileged message sender"
        );
        require(!vestingEnabled, "vesting already started");
        require(
            vestedToken.balanceOf(address(this)) >= _startingBalance,
            "contract holds insufficient amount of vestedToken"
        );
        _vestingAmount = getVestingAmount();
        vestingEnabled = true;
        emit VestingEnabled();
    }

    function setAdmin(address newAdmin) external onlyAdmin {
        require(newAdmin != address(0), "cannot set zero address as admin");
        admin = newAdmin;
        emit AdminChanged(admin);
    }

    modifier onlyAdmin() {
        require(msg.sender == admin, "unprivileged message sender");
        _;
    }

    event VestingEnabled();
    event TokensVested(uint amount);
    event RecipientsChanged(Recipient[] newRecipients);
    event AdminChanged(address newAdmin);
}
