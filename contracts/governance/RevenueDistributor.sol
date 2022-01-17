// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract RevenueDistributor {
    using SafeERC20 for IERC20;

    struct Recipient {
        address account;
        uint allocation;
    }

    mapping(uint => Recipient) private _recipients;

    address public admin;
    uint public constant DENOMINATOR = 10000;
    uint private _recipientsLength;

    constructor(address newAdmin, Recipient[] memory newRecipients) {
        admin = newAdmin;
        setRecipients(newRecipients);
    }

    function getRecipients() external view returns (Recipient[] memory) {
        require(_recipientsLength != 0, "No recipients exist");
        Recipient[] memory recipients =
            new Recipient[](_recipientsLength);
        for (uint i; i < _recipientsLength; i++) {
            recipients[i] = Recipient({
                account: _recipients[i].account,
                allocation: _recipients[i].allocation
            });
        }
        return recipients;
    }

    function distributeToken(address token) public {
        uint amount = IERC20(token).balanceOf(address(this));
        for (uint i; i < _recipientsLength; i++) {
            address receiverAddress = _recipients[i].account;
            IERC20(token).safeTransfer(
                receiverAddress,
                amount * _recipients[i].allocation / DENOMINATOR
            );
        }
        emit TokenDistributed(token, amount);
    }

    function setAdmin(address newAdmin) public {
        require(msg.sender == admin, "sender not admin");
        admin = newAdmin;
        emit AdminChanged(admin);
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
            _recipients[i].account = recipient.account;
            _recipients[i].allocation = recipient.allocation;
            allocations += recipient.allocation;
        }
        require(
            allocations == DENOMINATOR,
            "total allocations do not equal to denominator"
        );
        emit RecipientsChanged(newRecipients);
    }

    event TokenDistributed(address token, uint amount);
    event RecipientsChanged(Recipient[] newRecipients);
    event AdminChanged(address newAdmin);
}
