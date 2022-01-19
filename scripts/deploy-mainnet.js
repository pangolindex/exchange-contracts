const { ethers } = require('hardhat');
const { BigNumber } = require('ethers');
const fs = require('fs');

const { FOUNDATION_MULTISIG_OWNERS } = require("../constants/shared.js");

const {
    PNG_SYMBOL,
    PNG_NAME,
    TOTAL_SUPPLY,
    MULTISIG_OWNERS,
    PROPOSAL_THRESHOLD,
    WRAPPED_NATIVE_TOKEN,
    INITIAL_FARMS,
    AIRDROP_AMOUNT,
    VESTER_ALLOCATIONS
} = require( `../constants/${network.name}.js`);

async function main() {

    const [deployer] = await ethers.getSigners();

    console.log("Deploying contracts with the account:",deployer.address);

    const initBalance = await deployer.getBalance();
    console.log("Account balance:", initBalance.toString());

    // Timelock constants
    const DELAY = 3 * 24 * 60 * 60 // 3 days

    // Deploy WAVAX if not defined
    if (WRAPPED_NATIVE_TOKEN === undefined) {
        const WAVAX = await ethers.getContractFactory("WAVAX");
        const wavax = await WAVAX.deploy();
        await wavax.deployed;
        var nativeToken = wavax.address;
    } else {
        var nativeToken = WRAPPED_NATIVE_TOKEN;
    }

    /**************
     * GOVERNANCE *
     **************/

    // Deploy PNG
    const PNG = await ethers.getContractFactory("Png");
    const png = await PNG.deploy(
        ethers.utils.parseUnits(TOTAL_SUPPLY, 18),
        deployer.address, // PNG receiver
        PNG_SYMBOL,
        PNG_NAME
    );
    await png.deployed()
    console.log("PNG token deployed at: " + png.address);

    // Deploy this chain multisig
    const Multisig = await ethers.getContractFactory("MultiSigWalletWithDailyLimit");
    const multisig = await Multisig.deploy(MULTISIG_OWNERS, MULTISIG_OWNERS.length, 0);
    await multisig.deployed();
    console.log("Multisig deployed at: " + multisig.address);

    // Deploy foundation multisig
    const foundation = await Multisig.deploy(FOUNDATION_MULTISIG_OWNERS, 5, 0);
    await foundation.deployed();
    console.log("Foundation multisig deployed at: " + foundation.address);

    // Deploy Timelock
    const Timelock = await ethers.getContractFactory("Timelock");
    const timelock = await Timelock.deploy(DELAY); // sets msg.sender as temporary admin

    await timelock.deployed();
    console.log("Timelock deployed at: " + timelock.address);

    // Deploy Governor
    //const Governor = await ethers.getContractFactory("GovernorAlpha");
    //const governor = await Governor.deploy(timelock.address, png.address, multisig.address, PROPOSAL_THRESHOLD);
    //await governor.deployed();

    // Transfer timelock administrator to governor
    //await timelock.initiate(governor.address);

    /*****************
     * AMM CONTRACTS *
     *****************/

    // Deploy LP Factory
    const PangolinFactory = await ethers.getContractFactory("contracts/pangolin-core/PangolinFactory.sol:PangolinFactory");
    const factory = await PangolinFactory.deploy(deployer.address); // feeToSetter transferred to multisig after fee collector setup
    await factory.deployed();
    console.log("Pangolin Factory deployed at: " + factory.address);

    // Deploy Router
    const PangolinRouter = await ethers.getContractFactory("PangolinRouter");
    const router = await PangolinRouter.deploy(factory.address, nativeToken);
    await router.deployed();
    console.log("Pangolin Router deployed at: " + router.address);

    /**********************
     * TOKEN DISTRIBUTION *
     **********************/

    // Deploy MiniChefV2
    const MiniChef = await ethers.getContractFactory("contracts/dex/MiniChefV2.sol:MiniChefV2");
    const chef = await MiniChef.deploy(png.address, deployer.address); // ownership is transferred to multisig after initial farms are setup
    await chef.deployed();
    console.log("MiniChefV2 deployed at: " + chef.address);

    // Deploy CommunityTreasury
    const CommunityTreasury = await ethers.getContractFactory('CommunityTreasury');
    const treasury = await CommunityTreasury.deploy(png.address);
    await treasury.deployed();
    await treasury.transferOwnership(timelock.address);
    console.log("Treasury address is: " + treasury.address);

    // Deploy Airdrop
    const Airdrop = await ethers.getContractFactory("Airdrop");
    const airdrop = await Airdrop.deploy(
        ethers.utils.parseUnits(AIRDROP_AMOUNT, 18),
        png.address,
        multisig.address,
        treasury.address
    );
    await airdrop.deployed();
    console.log("Airdrop address is: " + airdrop.address)

    // Deploy TreasuryVester
    var vesterAllocations = [];
    for (let i = 0; i < VESTER_ALLOCATIONS.length; i++) {
        vesterAllocations.push([
            eval(VESTER_ALLOCATIONS[i].recipient + '.address'),
            VESTER_ALLOCATIONS[i].allocation
        ]);
    };
    const TreasuryVester = await ethers.getContractFactory("TreasuryVester");
    const vester = await TreasuryVester.deploy(
        png.address, // vested token
        vesterAllocations
    );
    await vester.deployed();
    console.log("Treasury Vester deployed at: " + vester.address)

    // Transfer PNG to 5% airdrop and 95% treasury vester
    await png.transfer(airdrop.address,ethers.utils.parseUnits(AIRDROP_AMOUNT, 18));
    await png.transfer(vester.address,
        (ethers.utils.parseUnits(TOTAL_SUPPLY, 18))
            .sub(ethers.utils.parseUnits(AIRDROP_AMOUNT, 18))
    );

    // Start vesting and transfer ownership to timelock
    await vester.startVesting();
    await vester.setAdmin(timelock.address);

    /*******************************
     * PNG STAKING & FEE COLLECTOR *
     *******************************/

    // Deploy Staking Rewards (PNG Staking)
    const StakingRewards = await ethers.getContractFactory("StakingRewards");
    const staking = await StakingRewards.deploy(png.address, png.address);
    await staking.deployed();

    // Deploy 2/2 Joint Multisig
    const jointMultisig = await Multisig.deploy([multisig.address, foundation.address], 2, 0);
    await jointMultisig.deployed();

    // Deploy Revenue Distributor (Joint treasury of PNG and FPNG)
    const RevenueDistributor = await ethers.getContractFactory("RevenueDistributor");
    const revenueDistributor = await RevenueDistributor.deploy(
        jointMultisig.address,
        [[multisig.address,8000],[foundation.address,2000]]
    );
    await revenueDistributor.deployed();

    // Deploy Fee Collector
    const FeeCollector = await ethers.getContractFactory("PangolinFeeCollector");
    const feeCollector = await FeeCollector.deploy(
        staking.address,
        router.address,
        chef.address,
        0, // chef pid for dummy PGL
        governor.address,
        nativeToken,
        revenueDistributor.address
    );
    await feeCollector.deployed();
    await feeCollector.transferOwnership(multisig.address);
    console.log("Fee Collector deployed at: " + feeCollector.address);

    // Deploy DummyERC20 for diverting some PNG emissions to PNG staking
    const DummyERC20 = await ethers.getContractFactory("DummyERC20");
    const dummyERC20 = await DummyERC20.deploy(
        "Dummy ERC20",
        "PGL",
        deployer.address,
        100 // arbitrary amount
    );
    await dummyERC20.renounceOwnership();

    // add dummy PGL to minichef with 5 weight (use 500)
    await chef.addPool(500,dummyERC20.address,ethers.constants.AddressZero);

    // deposit dummy PGL for the fee collector
    await dummyERC20.approve(chef.address, 100);
    await chef.deposit(
        0,                   // minichef pid
        100,                 // amount
        feeCollector.address // deposit to address
    );

    // change swap fee recipient to fee collector
    await factory.setFeeTo(feeCollector.address);
    await factory.setFeeToSetter(multisig.address);

    /********************
     * MINICHEFv2 FARMS *
     ********************/

    // Deploy library for getting pairs address (can replace this with JS library to save gas)
    const PangolinLibrary = await ethers.getContractFactory("PangolinLibraryProxy");
    const pangolinLibrary = await PangolinLibrary.deploy();
    await pangolinLibrary.deployed()

    await factory.createPair(png.address,nativeToken);
    var pngPair = await pangolinLibrary.pairFor(factory.address,png.address,nativeToken);

    // add png-native to minichef with 30 weight (use 3000)
    await chef.addPool(3000,pngPair,ethers.constants.AddressZero);

    // create native token paired farms for tokens in INITIAL_FARMS
    for (let i = 0; i < INITIAL_FARMS.length; i++) {
        let tokenA = INITIAL_FARMS[i]["tokenA"];
        let tokenB = INITIAL_FARMS[i]["tokenB"];
        let weight = INITIAL_FARMS[i]["weight"];
        let pair = await pangolinLibrary.pairFor(factory.address,tokenA,tokenB);
        await factory.createPair(tokenA,tokenB);
        await chef.addPool(weight,pair,ethers.constants.AddressZero);
    }

    // transfer minichef ownership from deployer to multisig
    await chef.transferOwnership(multisig.address);

    /***** THE HAPPY END *****/

    console.log("PNG address:                ", png.address);
    console.log("PangolinFactory address:    ", factory.address);
    console.log("PangolinRouter address:     ", router.address);
    console.log("Foundation Multisig address:", foundation.address);
    console.log("Multisig address:           ", multisig.address);
    console.log("MiniChefV2 address:         ", chef.address);
    console.log("TreasuryVester address:     ", vester.address);
    console.log("CommunityTreasury address:  ", treasury.address);
    console.log("Airdrop address:            ", airdrop.address);
    console.log("StakingRewards address:     ", staking.address);
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
