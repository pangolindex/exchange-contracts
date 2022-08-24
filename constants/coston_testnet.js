const WCFLR = "0x1659941d425224408c5679eeef606666c7991a8A";
exports.WRAPPED_NATIVE_TOKEN = WCFLR;
exports.PNG_SYMBOL = "PCT";
exports.PNG_NAME = "Pangolin Coston";
exports.TOTAL_SUPPLY = 230000000; // 230M
exports.INITIAL_MINT = 3450000;
exports.AIRDROP_AMOUNT = 3450000; // 3.45M or 1.5% of max supply
exports.TIMELOCK_DELAY = 3 * 24 * 60 * 60; // 3 days
exports.USE_GNOSIS_SAFE = false;
exports.WETH_PNG_FARM_ALLOCATION = 3000; // 30x weight
exports.START_VESTING = true;
exports.AIRDROP_MERKLE_ROOT = "0xb594d4b23bbadc25478b55b3f93b38ca756eb88be8ce1ae7d206ba1c7af39b61";
exports.VESTER_ALLOCATIONS = [
  {
    recipient: "treasury", // community treasury
    allocation: 2105, // 20%
  },
  {
    recipient: "multisig", // team
    allocation: 1842, // 10% team + 5% vc investor + 2.5% advisory
  },
  {
    recipient: "chef", // MiniChef
    allocation: 6053, // 57.5% LPs & PNG Staking
  }
];
