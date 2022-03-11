const WAGMI = "0x3Ee7094DADda15810F191DD6AcF7E4FFa37571e4";
exports.WRAPPED_NATIVE_TOKEN = WAGMI;
exports.PNG_SYMBOL = "wagmiPNG";
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
    tokenA: "0x25dbCAb8709E6222d74a56bD0184fc41439806CE", // wagmiPNG
    tokenB: WAGMI,
    weight: 2000
  },
  {
    tokenA: "0xf1db872E6454D553686b088c1Ea3889cF2FE3ABe", // OG
    tokenB: WAGMI,
    weight: 2000
  },
  {
    tokenA: "0x4eaA03A9C9c9CE745517538d262653B9e43c51f2", // staySAFU
    tokenB: WAGMI,
    weight: 2000
  },
  {
    tokenA: "0x21cf0eB2E3Ab483a67C900b27dA8F34185991982", // wrappedAVAX
    tokenB: WAGMI,
    weight: 2000
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
    isMiniChef: true
  }
];
exports.REVENUE_DISTRIBUTION = [
  {
    recipient: "foundation", // Pangolin Foundation
    allocation: 2000,        // 20%
  },
  {
    recipient: "multisig", // New team
    allocation: 8000,      // 80%
  }
]
