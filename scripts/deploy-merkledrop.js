const { ethers } = require("hardhat");
const { FOUNDATION_MULTISIG } = require("../constants/shared.js");
const { AIRDROP_MERKLE_ROOT } = require(`../constants/${network.name}.js`);

const PNG_ADDRESS = "";
const STAKING_ADDRESS = "";
const MULTISIG_ADDRESS = "";

function delay(timeout) {
    return new Promise((resolve) => {
        setTimeout(resolve, timeout);
    });
}

async function main() {
    const [deployer] = await ethers.getSigners();
    console.log("\nDeployer:", deployer.address);

    const initBalance = await deployer.getBalance();
    console.log("Balance:", ethers.utils.formatEther(initBalance) + "\n");

    // dirty hack to circumvent duplicate nonce submission error
    var txCount = await ethers.provider.getTransactionCount(deployer.address);
    async function confirmTransactionCount() {
        await delay(5000);
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

    async function deploy(factory, args) {
        await delay(5000);
        var ContractFactory = await ethers.getContractFactory(factory);
        var contract = await ContractFactory.deploy(...args);
        await contract.deployed();
        await confirmTransactionCount();
        console.log(contract.address, ":", factory);
        return contract;
    }

    console.log("\n============\n DEPLOYMENT \n============");

    const airdrop = await deploy("MerkledropToStaking", [
        PNG_ADDRESS,
        STAKING_ADDRESS,
        deployer.address,
    ]);

    console.log("\n===============\n CONFIGURATION \n===============");

    await airdrop.setMerkleRoot(AIRDROP_MERKLE_ROOT);
    await confirmTransactionCount();
    console.log("Set merkle root.");

    await airdrop.unpause();
    await confirmTransactionCount();
    console.log("Started airdrop.");

    await airdrop.transferOwnership(MULTISIG_ADDRESS);
    await confirmTransactionCount();
    console.log("Transferred airdrop ownership to multisig.");

    const endBalance = await deployer.getBalance();
    console.log(
        "\nDeploy cost:",
        ethers.utils.formatEther(initBalance.sub(endBalance)) + "\n"
    );
}

main()
    .then(() => process.exit(0))
    .catch((error) => {
        console.error(error);
        process.exit(1);
    });
