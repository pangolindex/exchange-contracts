const { ethers } = require('hardhat');
const { BigNumber } = require('ethers');
const fs = require('fs');
const { Chains, ALL_CHAINS, CHAINS } = require('@pangolindex/sdk');

async function main() {

    async function attach(factory, address) {
        var ContractFactory = await ethers.getContractFactory(factory);
        var contract = await ContractFactory.attach(address);
        console.log(factory, "has been load");
        return contract;
    }

    function getTreasuryVester() {
        var i;
        for(i = 0; i < ALL_CHAINS.length; i++) {
            if (ALL_CHAINS[i].id == `${network.name}`) {
                return ALL_CHAINS[i].contracts.treasury_vester;
            }
        }
    }
    const [deployer] = await ethers.getSigners();
    console.log("Account:", deployer.address);
    const initBalance = await deployer.getBalance();
    console.log("Account balance:", initBalance.toString());

    const TreasuryVester = await attach("TreasuryVester", getTreasuryVester());

    let tx;

    let vestingEnabled = await TreasuryVester.vestingEnabled();
    if(vestingEnabled == false) {
        console.log("Vesting is disable");
        process.exit(1);
    }
    const ONE_SECOND = BigNumber.from(1000);
    const ONE_DAY = BigNumber.from(86400).mul(ONE_SECOND);
    while (await TreasuryVester.vestingEnabled() == true) {
        let lastUpdate = (await TreasuryVester.lastUpdate()).mul(ONE_SECOND);
        console.log("lastUpdate: ", lastUpdate.toNumber());
        let time = getTime();
        let updateIn = (lastUpdate.add(ONE_DAY).add(ONE_SECOND)).sub(time);
        if (updateIn.gte(0)) {
         await sleep(updateIn);
        }
        try {
            console.log("Calling distribute() ...");
            tx = await TreasuryVester.distribute();
            await tx.wait();
            console.log(getTime().toString(), "Transaction hash:", tx.hash)
        //    fs.appendFileSync(`${network.name}.log`, getTime().toString() + " Transaction hash: " + tx.hash + "\n");
            const endBalance = await deployer.getBalance();
            console.log("Total cost: ", initBalance.sub(endBalance).toString())
            let balance = await deployer.getBalance();
            console.log("Actual balance: " + balance.toString());
        //    fs.appendFileSync(`${network.name}.log`, "Actual balance: " + balance.toString());
        } catch (error) {
            console.error("Errpr attempting distribute()")
            console.error(error.message);
            await sleep(ONE_SECOND)
        }
    }
}

function sleep(ms) {
    console.log("Will sleep during", ms.toNumber(), "ms until", getTime().add(ms).toNumber());
    return new Promise ((resolve) => {
        setTimeout(resolve, ms.toNumber());
    })
}

function getTime() {
    let date = new Date();
	return BigNumber.from(date.getTime());
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
