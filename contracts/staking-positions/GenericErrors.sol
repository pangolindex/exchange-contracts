// SPDX-License-Identifier: MIT
pragma solidity ^0.8.7;

interface GenericErrors {
    error Locked();
    error TooLate();
    error TooEarly();
    error Overflow();
    error NoEffect();
    error NullInput();
    error Underflow();
    error InvalidType();
    error OutOfBounds();
    error InvalidToken();
    error HighSlippage();
    error InvalidAmount();
    error FailedTransfer();
    error NonExistentToken();
    error UnprivilegedCaller();
    error InsufficientBalance();
    error MismatchedArrayLengths();
}
