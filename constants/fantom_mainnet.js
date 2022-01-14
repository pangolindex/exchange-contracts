const WFTM = "0x21be370D5312f44cB42ce377BC9b8a0cEF1A4C83";
exports.WRAPPED_NATIVE_TOKEN = WFTM;
exports.PNG_SYMBOL = "fanPNG";
exports.PNG_NAME = "Pangolin";
exports.MULTISIG_OWNERS = [
  "0xDA315a838E918026E51A864c43766f5AE86be8c6" // shung
];
exports.PROPOSAL_THRESHOLD = 100000; // 100K
exports.INITIAL_FARMS = [
  {
    tokenA: "0x04068DA6C83AFCFA0e13ba15A6696662335D5B75",
    tokenB: WFTM,
    weight: 2000
  },
  {
    tokenA: "0x049d68029688eAbF473097a2fC38ef61633A3C7A",
    tokenB: WFTM,
    weight: 1000
  },
  {
    tokenA: "0x8D11eC38a3EB5E956B052f67Da8Bdc9bef8Abf3E",
    tokenB: WFTM,
    weight: 1000
  }
];
