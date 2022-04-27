const { ethers } = require('hardhat');

const STAKING_CONTRACT = "0x88afdaE1a9F58Da3E68584421937E5F564A0135b";
const MULTISIG = "0x66c048d27aFB5EE59E4C07101A483654246A4eda"; // gnosis
const FACTORY = "0xefa94DE7a4656D787667C749f7E1223D71E9FD88";
const MINICHEF = "0x1f806f7C8dED893fd3caE279191ad7Aa3798E928";
const GOVERNOR = "0xEB5c91bE6Dbfd30cf616127C2EA823C64e4b1ff8"; // timelock
const WAVAX = "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7";

async function main() {

    // Deploy Fee Collector
    const FeeCollector = await ethers.getContractFactory("FeeCollector");
    const feeCollector = await FeeCollector.deploy(
        WAVAX,
        FACTORY,
        "0x40231f6b438bce0797c9ada29b718a87ea0a5cea3fe9a771abdd76bd41a3e545", // init pair hash
        STAKING_CONTRACT,
        MINICHEF,
        0, // chef pid for dummy PGL
        MULTISIG, // “treasury” fees
        GOVERNOR, // timelock
        MULTISIG // admin
    );
    await feeCollector.deployed();
    console.log("Fee Collector deployed at: " + feeCollector.address);

    // Deploy DummyERC20 for diverting some PNG emissions to PNG staking
    const DummyERC20 = await ethers.getContractFactory("DummyERC20");
    const dummyERC20 = await DummyERC20.deploy(
        "Dummy ERC20",
        "PGL",
        MULTISIG,
        100 // arbitrary amount
    );
    await dummyERC20.deployed();
    await dummyERC20.transferOwnership(MULTISIG);
    console.log("Dummy PGL for Fee Collector deployed at: " + dummyERC20.address);

}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
