const { ethers } = require('hardhat');
const { BigNumber } = require('ethers');
const { config } = require("dotenv");

// get identifying network name from hardhat config
const networkName = network.name.replace(/_(mainnet|testnet)$/,'');

// chain specific env variables
config({ path: `.${networkName}.env` });
// fallback env variables
config({ path: '.env' });

// assign env variables
const PNG_SYMBOL = process.env.PNG_SYMBOL;
const PNG_NAME = process.env.PNG_NAME;
const FOUNDATION_MULTISIG_OWNERS = process.env.FOUNDATION_MULTISIG_OWNERS.split(',');
const MULTISIG_OWNERS = process.env.MULTISIG_OWNERS.split(',');
const PROPOSAL_THRESHOLD = ethers.utils.parseUnits(process.env.PROPOSAL_THRESHOLD, 18);

async function main() {

    const [deployer] = await ethers.getSigners();

    console.log("Deploying contracts with the account:",deployer.address);

    const initBalance = await deployer.getBalance();
    console.log("Account balance:", initBalance.toString());

    //// Airdrop tokens
    //const UNI = ethers.utils.getAddress("0xf39f9671906d8630812f9d9863bBEf5D523c84Ab");
    //const SUSHI = ethers.utils.getAddress("0x39cf1BD5f15fb22eC3D9Ff86b0727aFc203427cc");
    //const WAVAX = ethers.utils.getAddress("0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7");

    // Timelock constants
    const DELAY = 14 * 24 * 60 * 60 // 14 days

    // Deploy PNG
    const PNG = await ethers.getContractFactory("Png");
    const png = await PNG.deploy(deployer.address, PNG_SYMBOL, PNG_NAME);
    await png.deployed()

    // Deploy foundation multisig
    const FoundationMultisig = await ethers.getContractFactory("MultiSigWalletWithDailyLimit");
    const foundation = await FoundationMultisig.deploy(FOUNDATION_MULTISIG_OWNERS, 5, 0);
    await foundation.deployed();

    // Deploy this chain multisig
    const Multisig = await ethers.getContractFactory("MultiSigWalletWithDailyLimit");
    const multisig = await Multisig.deploy(MULTISIG_OWNERS, MULTISIG_OWNERS.length,0);
    await multisig.deployed();

    // Deploy MiniChefV2
    const MiniChef = await ethers.getContractFactory("contracts/dex/MiniChefV2.sol:MiniChefV2");
    const chef = await MiniChef.deploy(png.address, multisig.address);
    await chef.deployed();

    // Deploy TreasuryVester
    const TreasuryVester = await ethers.getContractFactory("TreasuryVester");
    const vester = await TreasuryVester.deploy(png.address);
    await vester.deployed();

    // Deploy CommunityTreasury
    const CommunityTreasury = await ethers.getContractFactory('CommunityTreasury')
    const treasury = await CommunityTreasury.deploy(png.address);
    await treasury.deployed();

    // Deploy TreasuryVesterProxy
    const TreasuryVesterProxy = await ethers.getContractFactory("TreasuryVesterProxy");
    const proxy = await TreasuryVesterProxy.deploy(png.address, vester.address, treasury.address, chef.address);
    await proxy.deployed();

    //// Deploy Airdrop
    //const Airdrop = await ethers.getContractFactory("Airdrop");
    //const airdrop = await Airdrop.deploy(png.address, UNI, SUSHI, deployer.address, community.address);
    //await airdrop.deployed();

    // Deploy Timelock
    const Timelock = await ethers.getContractFactory("Timelock");
    const timelock = await Timelock.deploy(multisig.address, DELAY);
    await timelock.deployed();

    // Deploy Governor
    const Governor = await ethers.getContractFactory("GovernorAlpha");
    const governor = await Governor.deploy(timelock.address, png.address, multisig.address, PROPOSAL_THRESHOLD);
    await governor.deployed();

    console.log("PNG address:                ", png.address);
    console.log("Foundation Multisig address:", foundation.address);
    console.log("Multisig address:           ", multisig.address);
    console.log("MiniChefV2 address:         ", chef.address)
    console.log("TreasuryVester address:     ", vester.address)
    console.log("CommunityTreasury address:  ", treasury.address)
    console.log("TreasuryVesterProxy address:", proxy.address)
    //console.log("Airdrop address:            ", airdrop.address);
    console.log("Timelock address:           ", timelock.address);
    console.log("GovernorAlpha address:      ", governor.address);

    const endBalance = await deployer.getBalance();
    console.log("Deploy cost: ", initBalance.sub(endBalance).toString())
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
