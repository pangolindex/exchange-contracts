exports.WRAPPED_NATIVE_TOKEN;
exports.PNG_SYMBOL = "PNG";
exports.PNG_NAME = "Pangolin";
exports.TOTAL_SUPPLY = 230000000; // two-hundred-and-thirty million.
exports.INITIAL_MINT = 9200000; // nine-million and two-hundred thousand. 1% initial airdrop, 1% feature airdrop, 2% protocol-owned liquidity.
exports.AIRDROP_AMOUNT = 2300000; // two-million and three-hundred thousand. 1% initial airdrop.
exports.TIMELOCK_DELAY = 3 * 24 * 60 * 60; // 3 days
exports.USE_GNOSIS_SAFE = false;
exports.WETH_PNG_FARM_ALLOCATION = 3000; // 30x weight
exports.START_VESTING = false;
exports.AIRDROP_MERKLE_ROOT = "0x0000000000000000000000000000000000000000000000000000000000000000";
exports.VESTER_ALLOCATIONS = [
  {
    recipient: "treasury", // community treasury
    allocation: 1354, // 13% community treasury (to be transferred to governance)
  },
  {
    recipient: "multisig", // team
    allocation: 3385, // 17.5% team + 15% strategic sale
  },
  {
    recipient: "chef", // MiniChef
    allocation: 5261, // 50.5% LPs & PNG Staking
  }
];
