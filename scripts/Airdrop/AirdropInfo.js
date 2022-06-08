const { ethers } = require('hardhat');
const { BigNumber } = require('ethers');
const fs = require('fs');
const { ADDRESSES } = require(`../../addresses/${network.name}.js`);
const { attach } = require('./modules/utils');

async function main() {

    const [deployer] = await ethers.getSigners();
    
    const Airdrop = await attach("Airdrop", ADDRESSES[9 - (13 - ADDRESSES.length) ].address);
    
    let info;

    console.log("address : " + await Airdrop.address);
    info = await Airdrop.owner();
    console.log("owner : " + info);
    info = await Airdrop.whitelister();
    console.log("whitelister : " + info);
    info = await Airdrop.remainderDestination();
    console.log("remainderDestination : " + info);
    info = await Airdrop.totalAllocated();
    console.log("totalAllocated : " + info);
    info = await Airdrop.withdrawAmount(deployer.address);
    console.log("Your withdrawAmount : " + info);
    info = await Airdrop.airdropSupply();
    console.log("airdropSupply : " + info);
    info = await Airdrop.claimingAllowed();
    console.log("claimingAllowed : " + info);
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });