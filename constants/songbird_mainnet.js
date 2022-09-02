const WSGB = "0x02f0826ef6aD107Cfc861152B32B52fD11BaB9ED";
exports.WRAPPED_NATIVE_TOKEN = WSGB;
exports.PNG_SYMBOL = "PSB";
exports.PNG_NAME = "Pangolin Songbird";
exports.TOTAL_SUPPLY = 230000000; // two-hundred-and-thirty million.
exports.INITIAL_MINT = 9200000; // nine-million and two-hundred thousand. 1% initial airdrop, 1% feature airdrop, 2% protocol-owned liquidity.
exports.AIRDROP_AMOUNT = 2300000; // two-million and three-hundred thousand. 1% initial airdrop.
exports.TIMELOCK_DELAY = 3 * 24 * 60 * 60; // 3 days
exports.USE_GNOSIS_SAFE = false;
exports.WETH_PNG_FARM_ALLOCATION = 3000; // 30x weight
exports.START_VESTING = false;
exports.LINEAR_VESTING = true;
exports.VESTING_COUNT = 900; // 30 months == 900 days.
exports.AIRDROP_MERKLE_ROOT = "0xa99168d65703044b47554952229de9e52fe8a5486e095ea150c0501b29de0a32";
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
