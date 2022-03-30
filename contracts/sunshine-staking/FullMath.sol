// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

/**
 * @notice A barebones 512-bits math library for Sunshine and Rainbows (SAR)
 * @dev This library only includes functions used by SAR. Therefore it is missing essential
 * operations like division. Arbitrary denominator division function is not necessary, because
 * SAR uses 2^256 as the fixed denominator for achieving high precision. Divisions (a/2^256) and
 * (2^256/a) are trivial as opposed to arbitrary 512-bit division operations.
 * Credit: Most algorithms are taken from Mathemagic series of Remco Bloemen <https://2π.com/>.
 * @author shung for Pangolin
 */
library FullMath {
    struct Uint512 {
        uint256 r0; // least significant 256 bits
        uint256 r1; // most significant 256 bits
    }

    /// @dev a+b
    function add(Uint512 memory a, Uint512 memory b) internal pure returns (Uint512 memory) {
        uint256 r0;
        uint256 r1;
        unchecked {
            r0 = a.r0 + b.r0;
        }
        r1 = a.r1 + b.r1 + (r0 < a.r0 ? 1 : 0);
        return Uint512(r0, r1);
    }

    /// @dev a-b
    function sub(Uint512 memory a, Uint512 memory b) internal pure returns (Uint512 memory) {
        uint256 r0;
        uint256 r1;
        unchecked {
            r0 = a.r0 - b.r0;
        }
        r1 = a.r1 - b.r1 - (a.r0 < b.r0 ? 1 : 0);
        return Uint512(r0, r1);
    }

    /// @dev a*b
    function mul(uint256 a, uint256 b) internal pure returns (Uint512 memory) {
        uint256 r0;
        uint256 r1;
        assembly {
            let mm := mulmod(a, b, not(0))
            r0 := mul(a, b)
            r1 := sub(sub(mm, r0), lt(mm, r0))
        }
        return Uint512(r0, r1);
    }

    /// @dev a*b
    function mul(Uint512 memory a, uint256 b) internal pure returns (Uint512 memory) {
        Uint512 memory i0 = mul(a.r0, b);
        if (a.r1 == 0) return i0;
        return Uint512(i0.r0, i0.r1 + a.r1 * b);
    }

    /// @dev ⌊2^256/a⌋_2^256 when (a > 1)
    function div256(uint256 a) internal pure returns (uint256 r) {
        require(a > 1, "FullMath: division by zero or one");
        assembly {
            r := add(div(sub(0, a), a), 1)
        }
    }

    /// @dev ⌊a/2^256⌋
    function shiftToUint256(Uint512 memory a) internal pure returns (uint256) {
        return (a.r1);
    }
}
