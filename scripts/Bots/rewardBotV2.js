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
    console.log("Account:", deployer.address);
    const initBalance = await deployer.getBalance();
    console.log("Account balance:", initBalance.toString());

    const TreasuryVester = await attach("TreasuryVester", ADDRESSES[11].address);
    const multisig = await attach("MultiSigWalletWithDailyLimit", ADDRESSES[2].address);

    let tx;

    let vestingEnabled = await TreasuryVester.vestingEnabled();
    if(vestingEnabled == false) {
        console.log("Vesting is disable")
        if (await multisig.isOwner == false) {
            console.log("You are not an owner of multisig");
            return ;
        }
        tx = await multisig.submitTransaction(TreasuryVester.address, 0,"0xdeb36e32");
        await tx.wait();
        console.log("Request multisig to enable vesting");
        console.log("Waiting for multisig votes ...")
        while (vestingEnabled == false) {
            vestingEnabled = await TreasuryVester.vestingEnabled();
        }
        console.log("Vesting has been enabled");
    }
    const ONE_SECOND = BigNumber.from(1000);
    const ONE_DAY = BigNumber.from(86400).mul(ONE_SECOND);
    while (true) {
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
