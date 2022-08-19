const { MerkleTree } = require('merkletreejs')
const { ethers } = require('ethers')
const fs = require("fs")
require("dotenv").config();

const airdropFile = `airdrop/${network.name}-addresses.csv`;
const readFileLines = filename => fs.readFileSync(filename).toString('UTF8').split('\n');

let lines = readFileLines(airdropFile);

// discard first four lines
lines.shift();
lines.shift();
lines.shift();
lines.shift();

const header = lines[0].split(',');
const addressColumn = header.indexOf('address');
const amountColumn = header.indexOf('total_amount');
lines.pop() // remove empty last line
lines.shift(); // remove header

const leaves = lines.map((line) => (
  ethers.utils.solidityPack(
    ["address", "uint96"],
    [line.split(',')[addressColumn], line.split(',')[amountColumn]]
  )
))
const tree = new MerkleTree(leaves, ethers.utils.keccak256, { sort: true })
const root = tree.getHexRoot();

console.log(`Root: ${root}`);

// WRITE TO FILE FOR WHITELISED
let n = 0;
leaves.forEach((leaf) => {
  console.log(`${n}: ${leaf}`);
  n++;

  const address = ethers.utils.hexDataSlice(leaf, 0, 20);
  const amount = ethers.BigNumber.from(ethers.utils.hexDataSlice(leaf, 20)).toString();

  const proof = tree.getHexProof(leaf)
  const obj = {
    address: address,
    amount: amount,
    proof: proof,
    root: root
  };
  const file = `airdrop/${network.name}/${address}.json`
  fs.writeFileSync(file, JSON.stringify(obj) , 'utf-8');
})

console.log(`Root: ${root}. Record this value!!!`);
