const { ethers } = require('hardhat');
const { BigNumber } = require('ethers');
const fs = require('fs');

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

async function attach(factory, address) {
    let ContractFactory = await ethers.getContractFactory(factory);
    let contract = await ContractFactory.attach(address);
    console.log(factory, "has been load");
    return contract;
}

async function multisigWallet(contract, args) {
    let estimatedGas = await estimateGas(contract.estimateGas.submitTransaction, args);
    let tx = await contract.submitTransaction(...args, {gasLimit: estimatedGas}); 
    await tx.wait();
    if (await contract.required() > 1) {
        console.log("Vote has been emitted")
    } else {
        console.log("Proposition has been accepted")
    }
}

async function check_whitelister(Airdrop, deployer) {
    if (await Airdrop.whitelister() != deployer.address) {
        console.error("You are not the whitelister of Airdrop");
        process.exit(1);
    }
}

async function check_arrays_equal_length(airdropAddresses, airdropAmounts) {
    if (airdropAddresses.length != airdropAmounts.length) {
        console.log("Airdrop address length need to be equal with airdrop amounts length");
        process.exit(1);
    }
}

module.exports = {
    estimateGas,
    attach,
    multisigWallet,
    check_whitelister,
    check_arrays_equal_length,
  }
  