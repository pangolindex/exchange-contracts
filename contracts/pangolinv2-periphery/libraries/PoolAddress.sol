// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.5.0 <0.8.0;

/// @title Provides functions for deriving a pool address from the factory, tokens, and the fee
library PoolAddress {
    // For OpenZeppelin Clones, init code hash is derived from the hash of the bytecode
    // `0x3d602d80600a3d3981f3363d3d373d3d3d363d73A08bD621a8f2a8FD551f080242Cd2DB27dB88C0D5af43d82803e903d91602b57fd5bf3`
    // if implementation address is `0xA08bD621a8f2a8FD551f080242Cd2DB27dB88C0D`. We get that implementation address
    // by always using `0xC9AA35dEA67B155fb709BC88A07936fd65EC2652` with nonce 0 as the deployer of the implementation.
    bytes32 internal constant POOL_INIT_CODE_HASH = 0x000cbf4d86001640860651f244cd69869becc83c6dd9e7210bb7e7ef89c5e3fd;

    /// @notice The identifying key of the pool
    struct PoolKey {
        address token0;
        address token1;
        uint24 fee;
    }

    /// @notice Returns PoolKey: the ordered tokens with the matched fee levels
    /// @param tokenA The first token of a pool, unsorted
    /// @param tokenB The second token of a pool, unsorted
    /// @param fee The fee level of the pool
    /// @return Poolkey The pool details with ordered token0 and token1 assignments
    function getPoolKey(
        address tokenA,
        address tokenB,
        uint24 fee
    ) internal pure returns (PoolKey memory) {
        if (tokenA > tokenB) (tokenA, tokenB) = (tokenB, tokenA);
        return PoolKey({token0: tokenA, token1: tokenB, fee: fee});
    }

    /// @notice Deterministically computes the pool address given the factory and PoolKey
    /// @param factory The Pangolin V2 factory contract address
    /// @param key The PoolKey
    /// @return pool The contract address of the V3 pool
    function computeAddress(address factory, PoolKey memory key) internal pure returns (address pool) {
        require(key.token0 < key.token1);
        pool = address(
            uint256(
                keccak256(
                    abi.encodePacked(
                        hex'ff',
                        factory,
                        keccak256(abi.encode(key.token0, key.token1, key.fee)),
                        POOL_INIT_CODE_HASH
                    )
                )
            )
        );
    }
}
