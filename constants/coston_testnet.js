const WONE = "0x3Ee7094DADda15810F191DD6AcF7E4FFa37571e4";
exports.WRAPPED_NATIVE_TOKEN = WONE;
exports.PNG_SYMBOL = "cosPNG";
exports.PNG_NAME = "Pangolin";
exports.TOTAL_SUPPLY = 230000000; // 230M
exports.AIRDROP_AMOUNT = 11500000; // 11.5M or 5% of max supply
exports.TIMELOCK_DELAY = 3 * 24 * 60 * 60; // 3 days
exports.USE_GNOSIS_SAFE = false;
exports.PROPOSAL_THRESHOLD = 100000; // 100K
exports.PNG_STAKING_ALLOCATION = 500, // 5x weight in minichef
exports.WETH_PNG_FARM_ALLOCATION = 3000, // 30x weight
exports.INITIAL_FARMS = [
  {
    tokenA: "0x21cf0eB2E3Ab483a67C900b27dA8F34185991982", // WAVAX
    tokenB: WONE,
    weight: 2000
  },
  {
    tokenA: "0xf1db872E6454D553686b088c1Ea3889cF2FE3ABe", // OG
    tokenB: WONE,
    weight: 2000
  }
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
