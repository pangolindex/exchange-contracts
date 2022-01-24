const WETH = "0x9D29f395524B3C817ed86e2987A14c1897aFF849";
exports.WRAPPED_NATIVE_TOKEN = WETH;
exports.PNG_SYMBOL = "aurPNG";
exports.PNG_NAME = "Pangolin";
exports.TOTAL_SUPPLY = 230000000; // 230M
exports.AIRDROP_AMOUNT = 11500000; // 11.5M or 5% of max supply
exports.TIMELOCK_DELAY = 3 * 24 * 60 * 60; // 3 days
exports.MULTISIG = {
  owners: [
    "0x72C397908Cb93d1B569BBB0Ff8d3D26B7b21d730", // Trollip
    "0xDA315a838E918026E51A864c43766f5AE86be8c6"  // Shung
  ],
  threshold: 2
};
exports.USE_GNOSIS_SAFE = false;
exports.PROPOSAL_THRESHOLD = 100000; // 100K
exports.PNG_STAKING_ALLOCATION = 500, // 5x weight in minichef
exports.WETH_PNG_FARM_ALLOCATION = 3000, // 30x weight
exports.INITIAL_FARMS = [
  {
    tokenA: "0x5B8eEA476a17d47A3d40A0239707be9E8bc02015", // REY
    tokenB: WETH,
    weight: 2000
  },
  {
    tokenA: "0x23601aE38B8aBB28Bd538EE83dFcfd23987Bd1f9", // MATIC
    tokenB: WETH,
    weight: 1000
  },
  {
    tokenA: "0x0f1695B78b14F31bD8E621083c1A82637A190284", // AVAX
    tokenB: WETH,
    weight: 1000
  }
];
exports.VESTER_ALLOCATIONS = [
  {
    recipient: "treasury", // community treasury
    allocation: 2105, // 20%
  },
  {
    recipient: "multisig", // fPNG team
    allocation: 1579, // 10% team + 5% vc investor
  },
  {
    recipient: "foundation", // PNG Foundation multisig
    allocation: 263, // 2.5% advisory
  },
  {
    recipient: "chef", // MiniChef
    allocation: 6053, // 57.5% LPs & PNG Staking
  }
];
