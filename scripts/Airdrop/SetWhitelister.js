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

    async function multisigWallet(multisig, args) {
        let estimatedGas = await estimateGas(multisig.estimateGas.submitTransaction, args);
        tx = await multisig.submitTransaction(...args, {gasLimit: estimatedGas}); 
        await tx.wait();
        if (await multisig.required() > 1) {
            console.log("Vote has been emitted")
        } else {
            console.log("Proposition has been accepted")
        }
    }

    const [deployer] = await ethers.getSigners();
    console.log("Using script with the account:", deployer.address);
    const initBalance = await deployer.getBalance();
    console.log("Account balance:", initBalance.toString());

    const Airdrop = await attach("Airdrop", ADDRESSES[10 - (16 - ADDRESSES.length) ].address);
    const multisig = await attach("MultiSigWalletWithDailyLimit", ADDRESSES[2 - (16 - ADDRESSES.length) ].address);

    let info, tx;
    const multisigRequired = await multisig.required();
    
    if (await multisig.isOwner(deployer.address) == false) {
        console.error("You are not an owner of Multisig");
        process.exit(1);
    }
    
    if (await Airdrop.owner() != multisig.address) {
        console.error("Multisig is not the owner of Airdrop");
        process.exit(1);
    }

    await multisigWallet(multisig, [Airdrop.address, 0, "0xf98f5b92000000000000000000000000" + deployer.address.substr(2)]);

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