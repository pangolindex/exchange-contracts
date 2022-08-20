const WCFLR = "0x1659941d425224408c5679eeef606666c7991a8A";
exports.WRAPPED_NATIVE_TOKEN = WCFLR;
exports.PNG_SYMBOL = "PCT";
exports.PNG_NAME = "Pangolin Coston";
exports.TOTAL_SUPPLY = 230000000; // 230M
exports.AIRDROP_AMOUNT = 3450000; // 3.45M or 1.5% of max supply
exports.TIMELOCK_DELAY = 3 * 24 * 60 * 60; // 3 days
exports.USE_GNOSIS_SAFE = false;
exports.WETH_PNG_FARM_ALLOCATION = 3000, // 30x weight
exports.AIRDROP_MERKLE_ROOT = "0xdf80b955444b88869eab91f07f8412f2ed362a2a11f46e36c5f56f5ab5a6e37d";
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
