pragma solidity ^0.8.0;

import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract JointTreasury {
    using SafeERC20 for IERC20;

    uint256 constant ALLOCATION_DENOMINATOR = 1000;

    struct Receiver {
        address treasury;
        uint256 allocation;
    }

    Receiver[] public receivers;

    address admin;

    constructor(address _admin, Receiver[] memory newReceivers) {
        admin = _admin;
        setReceivers(newReceivers);
    }

    function setAdmin(address _admin) public {
        require(msg.sender == admin, "sender not admin");
        admin = _admin;
    }

    function setReceivers(Receiver[] memory _receivers) public {
        require(msg.sender == admin, "sender not admin");
        uint256 allocations;
        for (uint256 i; i < _receivers.length; i++) {
            receivers[i] = _receivers[i];
            allocations += _receivers[i].allocation;
        }
        require(
            allocations == ALLOCATION_DENOMINATOR,
            "total allocations not equal to denominator"
        );
    }

    function distributeToken(address token) public {
        for (uint256 i; i < receivers.length; i++) {
            IERC20(token).safeTransfer(
                receivers[i].treasury,
                IERC20(token).balanceOf(address(this)) *
                    receivers[i].allocation / ALLOCATION_DENOMINATOR
            );
        }
    }

}
