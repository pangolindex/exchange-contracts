const { ethers } = require('hardhat');
const { BigNumber } = require('ethers');
const fs = require('fs');
const { ADDRESSES } = require(`../../addresses/${network.name}.js`);
const { attach, multisigWallet } = require('./modules/utils')

async function main() {

    const [deployer] = await ethers.getSigners();
    console.log("Using script with the account:", deployer.address);
    const initBalance = await deployer.getBalance();
    console.log("Account balance:", initBalance.toString());

    const Airdrop = await attach("Airdrop", ADDRESSES[9 - (13 - ADDRESSES.length) ].address);
    const multisig = await attach("MultiSigWalletWithDailyLimit", ADDRESSES[2 - (13 - ADDRESSES.length) ].address);
    
    if (!(await multisig.isOwner(deployer.address))) {
        console.error("You are not an owner of Multisig");
        process.exit(1);
    }
    
    if (await Airdrop.owner() != multisig.address) {
        console.error("Multisig is not the owner of Airdrop");
        process.exit(1);
    }
    await multisigWallet(multisig, [Airdrop.address, 0, "0x6556c391"]);

    const endBalance = await deployer.getBalance();
    console.log("Deploy cost: ", initBalance.sub(endBalance).toString())
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });