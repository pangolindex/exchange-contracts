const WFTM = "0x21be370D5312f44cB42ce377BC9b8a0cEF1A4C83";
exports.WRAPPED_NATIVE_TOKEN = WFTM;
exports.PNG_SYMBOL = "fanPNG";
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
    tokenA: "0x04068DA6C83AFCFA0e13ba15A6696662335D5B75", // USDC
    tokenB: WFTM,
    weight: 2000
  },
  {
    tokenA: "0x049d68029688eAbF473097a2fC38ef61633A3C7A", // fUSDT
    tokenB: WFTM,
    weight: 1000
  },
  {
    tokenA: "0x8D11eC38a3EB5E956B052f67Da8Bdc9bef8Abf3E", // DAI
    tokenB: WFTM,
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
