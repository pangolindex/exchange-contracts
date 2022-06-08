const { ethers } = require('hardhat');
const { BigNumber } = require('ethers');
const fs = require('fs');
const csv = require('csvtojson');
const { ADDRESSES } = require(`../../addresses/${network.name}.js`);
const { attach, check_whitelister, check_arrays_equal_length} = require('./modules/utils');

async function main() {

    const [verifier] = await ethers.getSigners();
    console.log("Using script with the account:", verifier.address);

    let txCount = await ethers.provider.getTransactionCount(verifier.address);
    async function confirmTransactionCount() {
        let newTxCount;
        while (true) {
            try {
                newTxCount = await ethers.provider.getTransactionCount(
                    verifier.address
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

    const initBalance = await verifier.getBalance();
    console.log("Account balance:", initBalance.toString());

    const airdrop = await attach("Airdrop", ADDRESSES[9 - (13 - ADDRESSES.length) ].address);

    await check_whitelister(airdrop, verifier);

    let csv = await csv().fromFile(`scripts/airdrop/lists/${network.name}.csv`)
    let addresses = [], amounts = [];
    let amount;
    for(const csvInfo of csv) {
        amount = BigNumber.from(csvInfo.allocated_amount);
        if (!((await airdrop.withdrawAmount(csvInfo.address)).eq(amount))) {
            addresses.push(csvInfo.address);
            amounts.push(amount);
            if (addresses.length == 250) {
                await check_arrays_equal_length(addresses, amounts);
                await airdrop.whitelistAddresses(addresses, amounts);
                await confirmTransactionCount();
                console.log("Whitelist has been added");
                addresses = [];
                amounts = [];
            }
        }
    }
    if (addresses.length > 0) {
        await check_arrays_equal_length(addresses, amounts);
        await airdrop.whitelistAddresses(addresses, amounts);
        await confirmTransactionCount();
        console.log("Whitelist has been added");

    }
    
    const endBalance = await verifier.getBalance();
    console.log("Deploy cost: ", initBalance.sub(endBalance).toString())
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });