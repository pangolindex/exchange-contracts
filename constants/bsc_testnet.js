exports.WRAPPED_NATIVE_TOKEN;
exports.PNG_SYMBOL = "bscPNG";
exports.PNG_NAME = "Pangolin";
exports.TOTAL_SUPPLY = "230000000"; // 230M
exports.TIMELOCK_DELAY = 3 * 24 * 60 * 60; // 3 days
exports.MULTISIG_OWNERS = [
  "0x72C397908Cb93d1B569BBB0Ff8d3D26B7b21d730" // Trollip
];
exports.PROPOSAL_THRESHOLD = "100000"; // 100K
exports.INITIAL_FARMS = [
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
