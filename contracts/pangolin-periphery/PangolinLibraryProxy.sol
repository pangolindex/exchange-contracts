pragma solidity >=0.5.0;

import './libraries/PangolinLibrary.sol';

contract PangolinLibraryProxy {
    function pairFor(address factory, address tokenA, address tokenB) external pure returns (address pair) {
        pair = PangolinLibrary.pairFor(factory, tokenA, tokenB);
    }
}
