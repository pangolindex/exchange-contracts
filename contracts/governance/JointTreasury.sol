// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract JointTreasury {
    using SafeERC20 for IERC20;

    address public admin;
    uint256 public constant ALLOCATION_DENOMINATOR = 1000;
    uint8 internal numberOfBeneficiaries;

    mapping(address => uint256) internal _allocations;
    mapping(uint8 => address) internal _beneficiaries;

    struct Beneficiary {
        address account;
        uint256 allocation;
    }

    constructor(address newAdmin, Beneficiary[] memory newBeneficiaries) {
        admin = newAdmin;
        setBeneficiaries(newBeneficiaries);
    }

    function setAdmin(address newAdmin) public {
        require(msg.sender == admin, "sender not admin");
        admin = newAdmin;
        emit adminChanged(admin);
    }

    function setBeneficiaries(Beneficiary[] memory newBeneficiaries) public {
        if (numberOfBeneficiaries != 0) {
            require(msg.sender == admin, "sender not admin");
        }
        numberOfBeneficiaries = uint8(newBeneficiaries.length);
        uint256 allocations;
        for (uint8 i; i < numberOfBeneficiaries; i++) {
            Beneficiary memory beneficiary = newBeneficiaries[i];
            _allocations[beneficiary.account] = beneficiary.allocation;
            _beneficiaries[i] = beneficiary.account;
            allocations += beneficiary.allocation;
        }
        require(
            allocations == ALLOCATION_DENOMINATOR,
            "total allocations does not equal to denominator"
        );
        emit beneficiariesChanged(newBeneficiaries);
    }

    function getBeneficiaries() external view returns (Beneficiary[] memory) {
        Beneficiary[] memory beneficiaries =
            new Beneficiary[](numberOfBeneficiaries);
        for (uint8 i; i < numberOfBeneficiaries; i++) {
            address account = _beneficiaries[i];
            beneficiaries[i] = Beneficiary({
                account: account, allocation: _allocations[account]
            });
        }
        return beneficiaries;
    }

    function distributeToken(address token) public {
        uint256 amount = IERC20(token).balanceOf(address(this));
        for (uint8 i; i < numberOfBeneficiaries; i++) {
            address receiverAddress = _beneficiaries[i];
            IERC20(token).safeTransfer(
                receiverAddress,
                amount * _allocations[receiverAddress] / ALLOCATION_DENOMINATOR
            );
        }
        emit tokenDistributed(token, amount);
    }

    event tokenDistributed(address token, uint256 amount);
    event beneficiariesChanged(Beneficiary[] newBeneficiaries);
    event adminChanged(address newAdmin);
}
