const { ethers } = require('hardhat');
const { FOUNDATION_MULTISIG } = require("../constants/shared.js");
const {
    PNG_SYMBOL,
    PNG_NAME,
    TOTAL_SUPPLY,
    MULTISIG,
    USE_GNOSIS_SAFE,
    PROPOSAL_THRESHOLD,
    WRAPPED_NATIVE_TOKEN,
    INITIAL_FARMS,
    AIRDROP_AMOUNT,
    VESTER_ALLOCATIONS,
    REVENUE_DISTRIBUTION,
    TIMELOCK_DELAY,
    PNG_STAKING_ALLOCATION,
    WETH_PNG_FARM_ALLOCATION
} = require( `../constants/${network.name}.js`);
if (USE_GNOSIS_SAFE) {
    var { EthersAdapter, SafeFactory } = require('@gnosis.pm/safe-core-sdk');
}

function delay(timeout) {
	return new Promise(resolve => {
		setTimeout(resolve, timeout);
	});
};

async function main() {

    let tx;

    const [deployer] = await ethers.getSigners();
    console.log("Deploying contracts with the account:",deployer.address);

    const initBalance = await deployer.getBalance();
    console.log("Account balance:", initBalance.toString());

    console.log("\n===================\n DEPLOYMENT CONFIG \n===================");
    if (USE_GNOSIS_SAFE) {
        console.log("✅ Using Gnosis Safe for multisig accounts.");
    } else {
        console.log("Using legacy multisig instead of Gnosis Safe.");
    }
    console.log("Using Timelock + Multisig instead of full governance.");
    if (WRAPPED_NATIVE_TOKEN === undefined || WRAPPED_NATIVE_TOKEN == "") {
        console.log("⚠️  No wrapped token contract is defined.");
    } else {
        console.log("✅ An existing wrapped token contract is defined.");
    }
    if (INITIAL_FARMS.length === 0 || INITIAL_FARMS === undefined) {
        console.log("⚠️  No initial farm is defined.");
    }

    // dirty hack to circumvent duplicate nonce submission error
    var txCount = await ethers.provider.getTransactionCount(deployer.address);
    async function confirmTransactionCount() {
        let remainingTries = 50
        let newTxCount;
        while (remainingTries--) {
            try {
                newTxCount = await ethers.provider.getTransactionCount(deployer.address);
                if (newTxCount != ( txCount + 1)) {
                    console.log(`⚠️  Wrong tx count. Rechecking in 10 secs`);
                    await delay(30000);
                    continue;
                };
                txCount++;
            } catch (err) {
                console.log(err);
                process.exit(0);
            };
            break;
        };
    };


    console.log("\n============\n DEPLOYMENT \n============");

    // Deploy WAVAX if not defined
    if (WRAPPED_NATIVE_TOKEN === undefined) {
        const WAVAX = await ethers.getContractFactory("WAVAX");
        const wavax = await WAVAX.deploy();
        await wavax.deployed();
        await confirmTransactionCount();
        var nativeToken = wavax.address;
        console.log("Deployed new wrapped token contract to", nativeToken);
    } else {
        var nativeToken = WRAPPED_NATIVE_TOKEN;
        console.log("Using existing wrapped token contract at", nativeToken);
    }

    /**************
     * GOVERNANCE *
     **************/

    // Deploy PNG
    const PNG = await ethers.getContractFactory("Png");
    const png = await PNG.deploy(
        ethers.utils.parseUnits(TOTAL_SUPPLY.toString(), 18),
        deployer.address, // PNG receiver
        PNG_SYMBOL,
        PNG_NAME
    );
    await png.deployed()
    await confirmTransactionCount();
    console.log("PNG token deployed at: " + png.address);

    // Deploy this chain’s multisig
    if (USE_GNOSIS_SAFE) {
        const ethAdapter = new EthersAdapter({
          ethers,
          signer: deployer
        });
        var Multisig = await SafeFactory.create({ ethAdapter });
        var multisig = await Multisig.deploySafe(MULTISIG);
        await confirmTransactionCount();
        multisig.address = multisig.getAddress();
    } else {
        var Multisig = await ethers.getContractFactory("MultiSigWalletWithDailyLimit");
        var multisig = await Multisig.deploy(MULTISIG.owners, MULTISIG.threshold, 0);
        await multisig.deployed();
        await confirmTransactionCount();
    }
    console.log("Multisig deployed at: " + multisig.address);

    // Deploy foundation multisig
    if (USE_GNOSIS_SAFE) {
        var foundation = await Multisig.deploySafe(FOUNDATION_MULTISIG);
        await confirmTransactionCount();
        foundation.address = foundation.getAddress();
    } else {
        var foundation = await Multisig.deploy(
            FOUNDATION_MULTISIG.owners,
            FOUNDATION_MULTISIG.threshold,
            0
        );
        await foundation.deployed();
        await confirmTransactionCount();
    }
    console.log("Foundation multisig deployed at: " + foundation.address);

    // Deploy Timelock
    const Timelock = await ethers.getContractFactory("Timelock");
    const timelock = await Timelock.deploy(TIMELOCK_DELAY); // sets msg.sender as temporary admin
    await timelock.deployed();
    await confirmTransactionCount();
    console.log("Timelock deployed at: " + timelock.address);

    // Deploy Governor
    //const Governor = await ethers.getContractFactory("GovernorAlpha");
    //const governor = await Governor.deploy(
    //  timelock.address,
    //  png.address,
    //  multisig.address,
    //  ethers.utils.parseUnits(PROPOSAL_THRESHOLD.toString(), 18)
    //);
    //await governor.deployed();
    // await confirmTransactionCount();

    // Transfer timelock administrator to governor
    //tx = await timelock.initiate(governor.address);
    tx = await timelock.initiate(multisig.address);
    await tx.wait();
    await confirmTransactionCount();
    console.log("Transferred timelock administrator to multisig.");

    /*****************
     * AMM CONTRACTS *
     *****************/

    // Deploy LP Factory
    const PangolinFactory = await ethers.getContractFactory(
        "contracts/pangolin-core/PangolinFactory.sol:PangolinFactory"
    );
    const factory = await PangolinFactory.deploy(deployer.address);
    await factory.deployed();
    await confirmTransactionCount();
    console.log("Pangolin Factory deployed at: " + factory.address);

    // Deploy Router
    const PangolinRouter = await ethers.getContractFactory("PangolinRouter");
    const router = await PangolinRouter.deploy(factory.address, nativeToken);
    await router.deployed();
    await confirmTransactionCount();
    console.log("Pangolin Router deployed at: " + router.address);

    /**********************
     * TOKEN DISTRIBUTION *
     **********************/

    // Deploy MiniChefV2
    const MiniChef = await ethers.getContractFactory(
        "contracts/dex/MiniChefV2.sol:MiniChefV2"
    );
    const chef = await MiniChef.deploy(png.address, deployer.address);
    await chef.deployed();
    await confirmTransactionCount();
    console.log("MiniChefV2 deployed at: " + chef.address);

    // Deploy CommunityTreasury
    const CommunityTreasury = await ethers.getContractFactory('CommunityTreasury');
    const treasury = await CommunityTreasury.deploy(png.address);
    await treasury.deployed();
    await confirmTransactionCount();
    console.log("Community Treasury address is: " + treasury.address);
    tx = await treasury.transferOwnership(timelock.address);
    await tx.wait();
    await confirmTransactionCount();
    console.log("Community Treasury ownership was transferred to timelock");

    // Deploy Airdrop
    const Airdrop = await ethers.getContractFactory("Airdrop");
    const airdrop = await Airdrop.deploy(
        ethers.utils.parseUnits(AIRDROP_AMOUNT.toString(), 18),
        png.address,
        multisig.address,
        treasury.address
    );
    await airdrop.deployed();
    await confirmTransactionCount();
    console.log("Airdrop address is: " + airdrop.address);

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
        ethers.utils.parseUnits((TOTAL_SUPPLY - AIRDROP_AMOUNT).toString(), 18),
        vesterAllocations,
        multisig.address
    );
    await vester.deployed();
    await confirmTransactionCount();
    console.log("Treasury Vester deployed at: " + vester.address);

    // Transfer PNG to 5% airdrop and 95% treasury vester
    tx = await png.transfer(
        airdrop.address,
        ethers.utils.parseUnits(AIRDROP_AMOUNT.toString(), 18)
    );
    await tx.wait();
    await confirmTransactionCount();
    console.log(AIRDROP_AMOUNT, PNG_SYMBOL, "was transferred to Airdrop address");
    tx = await png.transfer(
        vester.address,
        ethers.utils.parseUnits((TOTAL_SUPPLY - AIRDROP_AMOUNT).toString(), 18)
    );
    await tx.wait();
    await confirmTransactionCount();
    console.log(
        (TOTAL_SUPPLY - AIRDROP_AMOUNT),
        PNG_SYMBOL,
        "was transferred to Treasury Vester"
    );

    // Start vesting and transfer ownership to timelock
    //tx = await vester.startVesting();
    //await tx.wait();
    //await confirmTransactionCount();
    tx = await vester.setAdmin(timelock.address);
    await tx.wait();
    await confirmTransactionCount();
    console.log("TreasuryVester ownership was transferred to Timelock");

    /*******************************
     * PNG STAKING & FEE COLLECTOR *
     *******************************/

    // Deploy Staking Rewards (PNG Staking)
    const StakingRewards = await ethers.getContractFactory("StakingRewards");
    const staking = await StakingRewards.deploy(png.address, png.address);
    await staking.deployed();
    await confirmTransactionCount();
    console.log("PNG Staking address is: " + staking.address)

    // Deploy 2/2 Joint Multisig
    if (USE_GNOSIS_SAFE) {
        var jointMultisig = await Multisig.deploySafe({
            owners: [
                multisig.address,
                foundation.address
            ],
            threshold: 2
        });
        await confirmTransactionCount();
        jointMultisig.address = jointMultisig.getAddress();
    } else {
        var jointMultisig = await Multisig.deploy(
            [multisig.address, foundation.address], 2, 0
        );
        await jointMultisig.deployed();
        await confirmTransactionCount();
    }
    console.log("Joint multisig deployed at: " + jointMultisig.address)

    // Deploy Revenue Distributor (Joint treasury of PNG and FPNG)
    var revenueDistribution = [];
    for (let i = 0; i < REVENUE_DISTRIBUTION.length; i++) {
        revenueDistribution.push([
            eval(REVENUE_DISTRIBUTION[i].recipient + '.address'),
            REVENUE_DISTRIBUTION[i].allocation
        ]);
    };
    const RevenueDistributor = await ethers.getContractFactory("RevenueDistributor");
    const revenueDistributor = await RevenueDistributor.deploy(
        jointMultisig.address,
        revenueDistribution
    );
    await revenueDistributor.deployed();
    await confirmTransactionCount();
    console.log("Revenue Distributor deployed at: " + revenueDistributor.address)

    // Deploy Fee Collector
    const FeeCollector = await ethers.getContractFactory("PangolinFeeCollector");
    const feeCollector = await FeeCollector.deploy(
        staking.address,
        router.address,
        chef.address,
        0, // chef pid for dummy PGL
        timelock.address,
        nativeToken,
        revenueDistributor.address
    );
    await feeCollector.deployed();
    await confirmTransactionCount();
    tx = await feeCollector.transferOwnership(multisig.address);
    await tx.wait();
    await confirmTransactionCount();
    console.log("Fee Collector deployed at: " + feeCollector.address);

    // Deploy DummyERC20 for diverting some PNG emissions to PNG staking
    const DummyERC20 = await ethers.getContractFactory("DummyERC20");
    const dummyERC20 = await DummyERC20.deploy(
        "Dummy ERC20",
        "PGL",
        deployer.address,
        100 // arbitrary amount
    );
    await dummyERC20.deployed();
    await confirmTransactionCount();
    tx = await dummyERC20.renounceOwnership();
    await tx.wait();
    await confirmTransactionCount();
    console.log("Dummy PGL for Fee Collector deployed at: " + dummyERC20.address);

    // add dummy PGL to minichef
    tx = await chef.addPool(
        PNG_STAKING_ALLOCATION,
        dummyERC20.address,
        ethers.constants.AddressZero
    );
    await tx.wait();
    await confirmTransactionCount();
    console.log("Added minichef pool 0 for the fee collector");

    // deposit dummy PGL for the fee collector
    tx = await dummyERC20.approve(chef.address, 100);
    await tx.wait();
    await confirmTransactionCount();
    tx = await chef.deposit(
        0,                   // minichef pid
        100,                 // amount
        feeCollector.address // deposit to address
    );
    await tx.wait();
    await confirmTransactionCount();
    console.log("Deposited Dummy PGL to mini chef in the name of fee collector");

    // change swap fee recipient to fee collector
    tx = await factory.setFeeTo(feeCollector.address);
    await tx.wait();
    await confirmTransactionCount();
    console.log("Set Fee Collector as swap fee recipient");
    tx = await factory.setFeeToSetter(multisig.address);
    await tx.wait();
    await confirmTransactionCount();
    console.log("Transferred Pangolin Factory administrator to multisig");

    /********************
     * MINICHEFv2 FARMS *
     ********************/

    // Deploy library for getting pairs address (can replace this with JS library to save gas)
    const PangolinLibrary = await ethers.getContractFactory("PangolinLibraryProxy");
    const pangolinLibrary = await PangolinLibrary.deploy();
    await pangolinLibrary.deployed();
    await confirmTransactionCount();

    tx = await factory.createPair(png.address,nativeToken);
    await tx.wait();
    await confirmTransactionCount();
    var pngPair = await pangolinLibrary.pairFor(factory.address,png.address,nativeToken);

    // add png-native to minichef
    tx = await chef.addPool(
        WETH_PNG_FARM_ALLOCATION,
        pngPair,
        ethers.constants.AddressZero
    );
    await tx.wait();
    await confirmTransactionCount();

    // create native token paired farms for tokens in INITIAL_FARMS
    for (let i = 0; i < INITIAL_FARMS.length; i++) {
        let tokenA = INITIAL_FARMS[i]["tokenA"];
        let tokenB = INITIAL_FARMS[i]["tokenB"];
        let weight = INITIAL_FARMS[i]["weight"];
        let pair = await pangolinLibrary.pairFor(factory.address,tokenA,tokenB);
        tx = await factory.createPair(tokenA,tokenB);
        await tx.wait();
        await confirmTransactionCount();
        tx = await chef.addPool(weight,pair,ethers.constants.AddressZero);
        await tx.wait();
        await confirmTransactionCount();
    }
    const pools = await chef.poolInfos();

    // transfer minichef ownership from deployer to multisig
    tx = await chef.transferOwnership(multisig.address);
    await tx.wait();
    await confirmTransactionCount();
    console.log("Deployed farms and transferred MiniChefV2 to multisig.");

    /***** THE HAPPY END *****/

    console.log("\n===============\n ALL ADDRESSES \n===============");
    console.log("PNG address:                ", png.address);
    console.log("WAVAX address:              ", nativeToken);
    console.log("PangolinFactory address:    ", factory.address);
    console.log("PangolinRouter address:     ", router.address);
    console.log("Foundation Multisig address:", foundation.address);
    console.log("Multisig address:           ", multisig.address);
    console.log("JointMultisig address:      ", jointMultisig.address);
    console.log("CommunityTreasury address:  ", treasury.address);
    console.log("Airdrop address:            ", airdrop.address);
    console.log("PNG Staking address:        ", staking.address);
    console.log("Fee Collector address:      ", feeCollector.address);
    console.log("Dummy PGL address:          ", dummyERC20.address);
    console.log("RevenueDistributor address: ", revenueDistributor.address);
    for (let i = 0; i < REVENUE_DISTRIBUTION.length; i++) {
        console.log("                             " +
            REVENUE_DISTRIBUTION[i].recipient + ": " +
            (REVENUE_DISTRIBUTION[i].allocation / 100 ) + "%");
    };
    console.log("Timelock address:           ", timelock.address);
    //console.log("GovernorAlpha address:      ", governor.address);
    console.log("MiniChefV2 address:         ", chef.address);
    for (let i = 0; i < pools.length; i++) {
        console.log("                             " +
            "pool " + i + ": " +  pools[i].allocPoint / 100  + "x weight");
    };
    console.log("TreasuryVester address:     ", vester.address);
    for (let i = 0; i < VESTER_ALLOCATIONS.length; i++) {
        console.log("                             " +
            VESTER_ALLOCATIONS[i].recipient +
            ": " + ( VESTER_ALLOCATIONS[i].allocation / 100 ) + "%");
    };

    const endBalance = await deployer.getBalance();
    console.log("\nDeploy cost: ", initBalance.sub(endBalance).toString())
}

main()
    .then(() => process.exit(0))
    .catch(error => {
        console.error(error);
        process.exit(1);
    });
