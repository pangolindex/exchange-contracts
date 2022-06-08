const { ethers } = require('hardhat');
const { BigNumber } = require('ethers');
const fs = require('fs');
const csv = require('csvtojson');
const { ADDRESSES } = require(`../../addresses/${network.name}.js`);

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

async function main() {

    const [deployer] = await ethers.getSigners();
    console.log("Using script with the account:", deployer.address);

    let txCount = await ethers.provider.getTransactionCount(deployer.address);
    async function confirmTransactionCount() {
        let newTxCount;
        while (true) {
            try {
                newTxCount = await ethers.provider.getTransactionCount(
                    deployer.address
                );
                if (newTxCount != txCount + 1) {
                    continue;
                }
                txCount++;
            } catch (err) {
                console.log(err);
                process.exit(0);
            }
            break;
        }
    }

    async function attach(factory, address) {
        let ContractFactory = await ethers.getContractFactory(factory);
        let contract = await ContractFactory.attach(address);
        console.log(factory, "has been load");
        return contract;
    }

    const initBalance = await deployer.getBalance();
    console.log("Account balance:", initBalance.toString());

    const Airdrop = await attach("Airdrop", ADDRESSES[9 - (13 - ADDRESSES.length) ].address);

    await check_whitelister(Airdrop, deployer);

    let csvFile = await csv().fromFile(`scripts/Airdrop/lists/${network.name}.csv`)
    let airdropAddresses = [], airdropAmounts = [];
    let amount;
    for(let i = 0; i < csvFile.length; i++) {
        amount = BigNumber.from(csvFile[i].allocated_amount);
        if (!((await Airdrop.withdrawAmount(csvFile[i].address)).eq(amount))) {
            airdropAddresses.push(csvFile[i].address);
            airdropAmounts.push(amount);
            if (airdropAddresses.length == 250) {
                await check_arrays_equal_length(airdropAddresses, airdropAmounts);
                await Airdrop.whitelistAddresses(airdropAddresses, airdropAmounts);
                await confirmTransactionCount();
                console.log("Whitelist has been added");
                airdropAddresses = [];
                airdropAmounts = [];
            }
        }
    }
    if (airdropAddresses.length > 0) {
        await check_arrays_equal_length(airdropAddresses, airdropAmounts);
        await Airdrop.whitelistAddresses(airdropAddresses, airdropAmounts);
        await confirmTransactionCount();
        console.log("Whitelist has been added");

    }
    
    const endBalance = await deployer.getBalance();
    console.log("Deploy cost: ", initBalance.sub(endBalance).toString())
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });