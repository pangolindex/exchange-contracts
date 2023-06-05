// SPDX-License-Identifier: MIT
pragma solidity 0.8.19;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

contract WrappedNativeToken is ERC20("Wrapped Native Token", "WNT") {
    using Address for address payable;

    function deposit() external payable {
        _mint(msg.sender, msg.value);
    }

    function withdraw(uint256 amount) external {
        _burn(msg.sender, amount);
        payable(msg.sender).sendValue(amount);
    }

    receive() external payable {
        _mint(msg.sender, msg.value);
    }
}
