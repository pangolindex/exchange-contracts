pragma solidity ^0.5.16;

import "@pangolindex/exchange-contracts/contracts/pangolin-core/PangolinFactory.sol";
import "@pangolindex/exchange-contracts/contracts/pangolin-core/PangolinPair.sol";


contract PangFactory is PangolinFactory {
    constructor(address _feeToSetter) public {
        feeToSetter = _feeToSetter;
    }
}