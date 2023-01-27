const WFLR = "0x1D80c49BbBCd1C0911346656B529DF9E5c2F783d";
exports.WRAPPED_NATIVE_TOKEN = WFLR;
exports.PNG_SYMBOL = "PFL";
exports.PNG_NAME = "Pangolin Flare";
exports.TOTAL_SUPPLY = 230000000; // two-hundred-and-thirty million.
exports.INITIAL_MINT = 16100000; // sixteen-million and one-hundred thousand. 2% airdrop, 5% protocol-owned liquidity.
exports.AIRDROP_AMOUNT = 0; // 0% initial airdrop.
exports.TIMELOCK_DELAY = 3 * 24 * 60 * 60; // 3 days
exports.USE_GNOSIS_SAFE = false;
exports.WETH_PNG_FARM_ALLOCATION = 3000; // 30x weight
exports.START_VESTING = false;
exports.LINEAR_VESTING = true;
exports.VESTING_COUNT = 900; // 30 months == 900 days.
exports.AIRDROP_MERKLE_ROOT = "0x0000000000000000000000000000000000000000000000000000000000000000";
exports.VESTER_ALLOCATIONS = [
  {
    recipient: "treasury", // community treasury
    allocation: 1613, // 15% community treasury (to be transferred to governance)
  },
  {
    recipient: "multisig", // team
    allocation: 1828, // 15% team + 2% advisors
  },
  {
    recipient: "chef", // MiniChef
    allocation: 6559, // 61% LPs & PNG Staking
  }
];
