// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract RevenueDistributor {
    using SafeERC20 for IERC20;

    address public admin;
    uint public constant ALLOCATION_DENOMINATOR = 1000;

    uint internal _beneficiariesLength;

    mapping(address => uint) internal _allocations;
    mapping(uint => address) internal _beneficiaries;

    struct Beneficiary {
        address account;
        uint allocation;
    }

    constructor(address newAdmin, Beneficiary[] memory newBeneficiaries) {
        admin = newAdmin;
        setBeneficiaries(newBeneficiaries);
    }

    function getBeneficiaries() external view returns (Beneficiary[] memory) {
        Beneficiary[] memory beneficiaries =
            new Beneficiary[](_beneficiariesLength);
        for (uint i; i < _beneficiariesLength; i++) {
            address account = _beneficiaries[i];
            beneficiaries[i] = Beneficiary({
                account: account, allocation: _allocations[account]
            });
        }
        return beneficiaries;
    }

    function distributeToken(address token) public {
        uint amount = IERC20(token).balanceOf(address(this));
        for (uint i; i < _beneficiariesLength; i++) {
            address receiverAddress = _beneficiaries[i];
            IERC20(token).safeTransfer(
                receiverAddress,
                amount * _allocations[receiverAddress] / ALLOCATION_DENOMINATOR
            );
        }
        emit tokenDistributed(token, amount);
    }

    function setAdmin(address newAdmin) public {
        require(msg.sender == admin, "sender not admin");
        admin = newAdmin;
        emit adminChanged(admin);
    }

    function setBeneficiaries(Beneficiary[] memory newBeneficiaries) public {
        if (_beneficiariesLength != 0) {
            require(msg.sender == admin, "sender not admin");
        }
        _beneficiariesLength = newBeneficiaries.length;
        require(_beneficiariesLength > 0, "cannot set zero beneficiaries");
        uint allocations;
        for (uint i; i < _beneficiariesLength; i++) {
            Beneficiary memory beneficiary = newBeneficiaries[i];
            _allocations[beneficiary.account] = beneficiary.allocation;
            _beneficiaries[i] = beneficiary.account;
            allocations += beneficiary.allocation;
        }
        require(
            allocations == ALLOCATION_DENOMINATOR,
            "total allocations do not equal to denominator"
        );
        emit beneficiariesChanged(newBeneficiaries);
    }

    event tokenDistributed(address token, uint amount);
    event beneficiariesChanged(Beneficiary[] newBeneficiaries);
    event adminChanged(address newAdmin);
}
