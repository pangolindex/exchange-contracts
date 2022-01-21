pragma solidity >=0.5.0;

import "../../beetrade-core/interfaces/IBeeTradeERC20.sol";

interface IBridgeToken is IBeeTradeERC20 {
    function swap(address token, uint256 amount) external;
    function swapSupply(address token) external view returns (uint256);
}