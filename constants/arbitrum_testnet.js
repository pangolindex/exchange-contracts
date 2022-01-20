const WETH = "0x9D29f395524B3C817ed86e2987A14c1897aFF849";
exports.WRAPPED_NATIVE_TOKEN;
exports.PNG_SYMBOL = "arbPNG";
exports.PNG_NAME = "Pangolin";
exports.TOTAL_SUPPLY = "230000000"; // 230M
exports.MULTISIG_OWNERS = [
  "0x72C397908Cb93d1B569BBB0Ff8d3D26B7b21d730" // Trollip
];
exports.PROPOSAL_THRESHOLD = "100000"; // 100K
exports.INITIAL_FARMS = [
  {
    tokenA: "0x04068DA6C83AFCFA0e13ba15A6696662335D5B75", // USDC
    tokenB: WRAPPED_NATIVE_TOKEN,
    weight: 2000
  },
  {
    tokenA: "0x049d68029688eAbF473097a2fC38ef61633A3C7A", // fUSDT
    tokenB: WRAPPED_NATIVE_TOKEN,
    weight: 1000
  },
  {
    tokenA: "0x8D11eC38a3EB5E956B052f67Da8Bdc9bef8Abf3E", // DAI
    tokenB: WRAPPED_NATIVE_TOKEN,
    weight: 1000
  }
];
exports.AIRDROP_AMOUNT = "11500000"; // 11.5M or 5% of max supply
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
