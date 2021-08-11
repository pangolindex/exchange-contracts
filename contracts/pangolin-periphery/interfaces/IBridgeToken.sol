pragma solidity >=0.5.0;

import "../../pangolin-core/interfaces/IPangolinERC20.sol";

interface IBridgeToken is IPangolinERC20 {
    function swap(address token, uint256 amount) external;
    function swapSupply(address token) external view returns (uint256);
}