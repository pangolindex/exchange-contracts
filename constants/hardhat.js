exports.WRAPPED_NATIVE_TOKEN;
exports.PNG_SYMBOL = "PNG";
exports.PNG_NAME = "Pangolin";
exports.TOTAL_SUPPLY = "230000000"; // 230M
exports.MULTISIG_OWNERS = [
  "0xDA315a838E918026E51A864c43766f5AE86be8c6" // shung
];
exports.PROPOSAL_THRESHOLD = "1000000"; // 1M
exports.INITIAL_FARMS = [
];
exports.AIRDROP_AMOUNT = "11500000"; // 11.5M or 5% of max supply
exports.VESTER_ALLOCATIONS = [
  {
    recipient: "treasury", // community treasury
    allocation: 2105, // 20%
  },
  {
    recipient: "multisig", // team
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
