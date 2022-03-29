const { ethers } = require('hardhat');
const { BigNumber } = require('ethers');
const fs = require('fs');
const csv = require('csvtojson');
const { ADDRESSES } = require(`../../addresses/${network.name}.js`);

async function main() {

    async function attach(factory, address) {
        var ContractFactory = await ethers.getContractFactory(factory);
        var contract = await ContractFactory.attach(address);
        console.log(factory, "has been load");
        return contract;
    }


    const [deployer] = await ethers.getSigners();
    console.log("Using script with the account:", deployer.address);

    const initBalance = await deployer.getBalance();
    console.log("Account balance:", initBalance.toString());

    csvFile = await csv({noheader:true}).fromFile("airdrop/avalanche_fuji.csv")
    let airdropAddresses = [], airdropAmounts = [];
    for(i = 0; i < csvFile.length; i++) {
        airdropAddresses.push(csvFile[i].field1);
        airdropAmounts.push(csvFile[i].field2);
    }
    
    if (airdropAddresses.length != airdropAmounts.length) {
        console.log("Airdrop address length need to be egal with airdrop amounts lenght");
        process.exit(1);
    }

    const Airdrop = await attach("Airdrop", ADDRESSES[10].address);

    let info, tx;
    
    if (await Airdrop.whitelister() != deployer.address) {
        console.error("You are not the whitelister of Airdrop");
        process.exit(1);
    }

    tx = await Airdrop.whitelistAddresses(airdropAddresses, airdropAmounts);
    await tx.wait();    
    console.log("Whitedlist has been added");

    const endBalance = await deployer.getBalance();
    console.log("Deploy cost: ", initBalance.sub(endBalance).toString())
}

async function estimateGas(ft, args) {
    let estimatedGas;
    while (1) {
	    try {
			    estimatedGas = await ft(...args);
            return (estimatedGas.mul(2)).toNumber();
	    } catch (e) {
		    console.log("EstimateGas: something went wrong");
            console.log(e);
            process.exit(1);
	    }
    }
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });