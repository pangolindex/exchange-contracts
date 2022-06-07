const WGLMR = "0x9D29f395524B3C817ed86e2987A14c1897aFF849";
exports.WRAPPED_NATIVE_TOKEN = WGLMR;
exports.PNG_SYMBOL = "PMB";
exports.PNG_NAME = "Pangolin Moonbeam";
exports.TOTAL_SUPPLY = 230000000; // 230M
exports.AIRDROP_AMOUNT = 11500000; // 11.5M or 5% of max supply
exports.TIMELOCK_DELAY = 3 * 24 * 60 * 60; // 3 days
exports.USE_GNOSIS_SAFE = true;
exports.PROPOSAL_THRESHOLD = 100000; // 100K
exports.PNG_STAKING_ALLOCATION = 500, // 5x weight in minichef
exports.WETH_PNG_FARM_ALLOCATION = 3000, // 30x weight
exports.INITIAL_FARMS = [
  // We should add the following initial Farms
  // GLMR 0xAcc15dC74880C9944775448304B263D191c6077F
  // USDC 0x8f552a71EFE5eeFc207Bf75485b356A0b3f01eC9
  // UST 0x085416975fe14C2A731a97eC38B9bF8135231F62
  // LUNA 0x31DAB3430f3081dfF3Ccd80F17AD98583437B213
  // ETH 0xfA9343C3897324496A05fC75abeD6bAC29f8A40f
  // WBTC 0x1DC78Acda13a8BC4408B207c9E48CDBc096D95e0
];
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
    isMiniChef: true
  }
];
