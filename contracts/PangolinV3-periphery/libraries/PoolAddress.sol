// SPDX-License-Identifier: GPL-2.0-or-later
pragma solidity >=0.5.0 <0.8.0;

/// @title Provides functions for deriving a pool address from the factory, tokens, and the fee
library PoolAddress {
    // For OpenZeppelin Clones, init code hash is derived from the hash of the bytecode
    // `0x41a723f9e6457830b1b7a44df4435fab88581d073226894b33131815dd674c22`
    // if implementation address is `0x5cB5539A18591947C82f5D840B05ed79f6395491`. We get that implementation address
    // by always using `0x427207B1Cdb6F2Ab8B1D21Ab77600f00b0a639a7` with nonce 0 as the deployer of the implementation.
    bytes32 internal constant POOL_INIT_CODE_HASH = 0x9c4eadbb7836beaabee4af53772e9ebfb57b4d7cd0cabe4774596f06376808a4;

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
    /// @param factory The PangolinV3 factory contract address
    /// @param key The PoolKey
    /// @return pool The contract address of the pangolinv3 pool
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
