pragma solidity 0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/security/ReentrancyGuard.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ITreasuryVester {
    function claim() external returns (uint);
    function recipient() external returns (address);
}

interface MiniChefV2 {
    function fundRewards(uint256 newFunding, uint256 duration) external;
}

// SPDX-License-Identifier: MIT

contract TreasuryVesterProxy is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 png;
    ITreasuryVester treasuryVester;
    MiniChefV2 chef;
    address treasury;

    uint constant PNG_MAX_SUPPLY = 512_000_000e18;
    uint constant PNG_MAX_VESTED = 230_000_000e18;
    uint constant PNG_VESTING_CLIFF = 86_400;
    uint constant TREASURY_TARGET_BALANCE = 30_000_000e18;
    address constant BURN_ADDRESS = address(0x000000000000000000000000000000000000dEaD);

    uint pngVested;
    uint pngVestingTreasuryCutoff;
    uint distributionCount;

    uint diversionAmount;
    uint diversionGain;

    bool initialized;

    constructor(address _png, address _treasuryVester, address _treasury, address _chef) {
        require(
            _png != address(0)
            && _treasuryVester != address(0)
            && _treasury != address(0)
            && _chef != address(0),
            "TreasuryVesterProxy::Cannot construct with zero address"
        );

        png = IERC20(_png);
        treasuryVester = ITreasuryVester(_treasuryVester);
        treasury = _treasury;
        chef = MiniChefV2(_chef);

        // Required for chef.fundRewards()
        png.approve(_chef, type(uint256).max);
    }

    function init() external onlyOwner {
        require(treasuryVester.recipient() == address(this), "TreasuryVesterProxy::Invalid treasury vester recipient");

        uint unvestedPng = png.balanceOf(address(treasuryVester));
        uint treasuryBalance = png.balanceOf(treasury);

        // PNG that has already been vested
        pngVested = PNG_MAX_SUPPLY - unvestedPng;

        // PNG should be diverted to the treasury until this point to reach the target balance
        pngVestingTreasuryCutoff = pngVested + TREASURY_TARGET_BALANCE - treasuryBalance;

        initialized = true;
    }

    function claimAndDistribute() external {
        require(initialized == true, "TreasuryVesterProxy::Not initialized");
        uint vestedAmountRemaining = treasuryVester.claim();

        // Increase rate of diversion gain once every 300 days
        if (distributionCount % uint(300) == uint(0)) {
            diversionGain += 1_000e18;
        }

        // Increase diversion every 30 days
        if (distributionCount % uint(30) == uint(0)) {
            diversionAmount += diversionGain;
        }

        // Clamps diversionAmount to [0, vestedAmountRemaining]
        if (diversionAmount > vestedAmountRemaining) {
            diversionAmount = vestedAmountRemaining;
        }

        if (pngVested < pngVestingTreasuryCutoff) {
            // Clamps treasuryAmount to [1, diversionAmount]
            uint treasuryAmount = (pngVested + diversionAmount > pngVestingTreasuryCutoff)
                ? pngVestingTreasuryCutoff - pngVested // Avoid overfunding in the last diversion
                : diversionAmount;

            pngVested += treasuryAmount;
            vestedAmountRemaining -= treasuryAmount;
            png.safeTransfer(treasury, treasuryAmount);
        }

        if (pngVested < PNG_MAX_VESTED) {
            // Clamps chefAmount to [1, vestedAmountRemaining]
            uint chefAmount = (pngVested + vestedAmountRemaining > PNG_MAX_VESTED)
                ? PNG_MAX_VESTED - vestedAmountRemaining // Avoid overvesting in the last diversion
                : vestedAmountRemaining;

            pngVested += chefAmount;
            vestedAmountRemaining -= chefAmount;
            chef.fundRewards(chefAmount, PNG_VESTING_CLIFF);
        }

        if (vestedAmountRemaining > 0) {
            // Logical burn since PNG cannot be sent to the 0 address
            png.safeTransfer(BURN_ADDRESS, vestedAmountRemaining);
        }

        distributionCount++;
    }

}
