pragma solidity >=0.8.0;

// SPDX-License-Identifier: MIT
interface ITimelock {
    function GRACE_PERIOD() external view returns (uint256);
    function delay() external view returns (uint256);
    function queuedTransactions(bytes32 hash) external view returns (bool);
    function setDelay(uint256 delay) external;
    function acceptAdmin() external;
    function setPendingAdmin(address pendingAdmin_) external;
    function queueTransaction(address target, uint256 value, string calldata signature, bytes calldata data, uint256 eta) external returns (bytes32);
    function cancelTransaction(address target, uint256 value, string calldata signature, bytes calldata data, uint256 eta) external;
    function executeTransaction(address target, uint256 value, string calldata signature, bytes calldata data, uint256 eta) external payable returns (bytes memory);
}
