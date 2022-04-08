const { ethers } = require('hardhat');
const { BigNumber } = require('ethers');
const fs = require('fs');
const { ADDRESSES } = require(`../../addresses/${network.name}.js`);

async function main() {

    async function attach(factory, address) {
        var ContractFactory = await ethers.getContractFactory(factory);
        var contract = await ContractFactory.attach(address);
        console.log(factory, "has been load");
        return contract;
    }

    const [deployer] = await ethers.getSigners();
    
    const Airdrop = await attach("Airdrop", ADDRESSES[10 - (16 - ADDRESSES.length) ].address);
    const multisig = await attach("MultiSigWalletWithDailyLimit", ADDRESSES[2 - (16 - ADDRESSES.length) ].address);

    let info, tx;
    
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