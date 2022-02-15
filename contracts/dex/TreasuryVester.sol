// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IMiniChefV2 {
    function fundRewards(uint256 newFunding, uint256 duration) external;
}

interface IPng is IERC20 {
    function mint(address dst, uint rawAmount) external returns (bool);
}

contract TreasuryVester {
    using SafeERC20 for IPng;

    struct Recipient{
        address account;
        uint allocation;
        bool isMiniChef;
    }

    mapping(uint => Recipient) private _recipients;

    uint[5] private _initialVestingPercentages = [2500, 1400, 800, 530, 390];

    address public admin;
    address public guardian;

    IPng public immutable vestedToken;

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
        vestedToken = IPng(vestedToken_);
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
        for (uint i; i < _recipientsLength; i++) {
            Recipient memory recipient = _recipients[i];
            uint amount = recipient.allocation * _vestingAmount / DENOMINATOR;
            if (!recipient.isMiniChef) {
                vestedToken.mint(recipient.account, amount);
            } else {
                vestedToken.mint(address(this), amount);
                vestedToken.approve(recipient.account, amount);
                IMiniChefV2(recipient.account)
                    .fundRewards(
                        amount,
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
