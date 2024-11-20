const { ethers, utils } = require("ethers");

const bytecodePrefix = "3d602d80600a3d3981f3363d3d373d3d3d363d73";
const implementation = "474195Ac6cC3bDe2018DD0689694c79F33f00E12";
const bytecodeSuffix = "5af43d82803e903d91602b57fd5bf3";
const constructedBytecode = `0x${bytecodePrefix}${implementation}${bytecodeSuffix}`;
const initCodeHash = utils.keccak256(constructedBytecode);
console.log(initCodeHash);
