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

    csvFile = await csv().fromFile(`scripts/Airdrop/lists/${network.name}.csv`)
    let airdropAddresses = [], airdropAmounts = [];

    const Airdrop = await attach("Airdrop", ADDRESSES[10 - (16 - ADDRESSES.length) ].address);
    const multisig = await attach("MultiSigWalletWithDailyLimit", ADDRESSES[2 - (16 - ADDRESSES.length) ].address);

    let info, tx;
    const multisigRequired = await multisig.required();
    
    if (multisigRequired > 1) {
        console.error("No more than 1 Multisig Require for this script");
        process.exit(1);
    }
    
    if (await multisig.isOwner(deployer.address) == false) {
        console.error("You are not an owner of Multisig");
        process.exit(1);
    }
    
    if (await Airdrop.owner() != multisig.address) {
        console.error("Multisig is not the owner of Airdrop");
        process.exit(1);
    }

    let estimatedGas = await estimateGas(multisig.estimateGas.submitTransaction, [Airdrop.address, 0, "0xf98f5b92000000000000000000000000" + deployer.address.substr(2)]);
    tx = await multisig.submitTransaction(Airdrop.address, 0, "0xf98f5b92000000000000000000000000" + deployer.address.substr(2), {gasLimit: estimatedGas}); 
    await tx.wait();
    console.log("Whitelister has been set");
    for(i = 0; i < csvFile.length; i++) {
        amount = BigNumber.from(csvFile[i].allocated_amount);
        airdropAddresses.push(csvFile[i].address);
        airdropAmounts.push(amount);
        if (airdropAddresses.length == 250) {
            if (airdropAddresses.length != airdropAmounts.length) {
                console.log("Airdrop address length need to be equal with airdrop amounts length");
                process.exit(1);
            }
            tx = await Airdrop.whitelistAddresses(airdropAddresses, airdropAmounts);
            await confirmTransactionCount();
            console.log("Whitelist has been added");
            airdropAddresses = [];
            airdropAmounts = [];
        }
    }
    if (airdropAddresses.length > 0) {

        if (airdropAddresses.length != airdropAmounts.length) {
            console.log("Airdrop address length need to be equal with airdrop amounts length");
            process.exit(1);
        }
    
        tx = await Airdrop.whitelistAddresses(airdropAddresses, airdropAmounts);
        await tx.wait();
        console.log("Whitelist has been added");

    }

    estimatedGas = await estimateGas(multisig.estimateGas.submitTransaction, [Airdrop.address, 0, "0xde733397"]);
    tx = await multisig.submitTransaction(Airdrop.address, 0, "0xde733397" , {gasLimit: estimatedGas});
    await tx.wait();
    console.log("AllowedClaiming has been changed");

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