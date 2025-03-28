const { ethers, utils } = require("ethers");

const bytecodePrefix = "3d602d80600a3d3981f3363d3d373d3d3d363d73";
const implementation = "6Dd86cfBD864647dc10703342dd5Ea8643c2A2D4";
const bytecodeSuffix = "5af43d82803e903d91602b57fd5bf3";
const constructedBytecode = `0x${bytecodePrefix}${implementation}${bytecodeSuffix}`;
const initCodeHash = utils.keccak256(constructedBytecode);
console.log(initCodeHash);
