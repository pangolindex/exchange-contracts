// test/TreasuryVester.js
// Load dependencies
const { expect } = require('chai');
const { BigNumber } = require('ethers');
const { ethers } = require('hardhat');

const OWNER_ADDRESS = ethers.utils.getAddress("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");
const COMMUNITY_TREASURY = ethers.utils.getAddress("0x4750c43867ef5f89869132eccf19b9b6c4286e1a");
const LP_MANAGER = ethers.utils.getAddress("0x4750c43867ef5f89869132eccf19b9b6c4286e1a");
const UNPRIVILEGED_ADDRESS = ethers.utils.getAddress("0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65");

const TOTAL_AMOUNT = ethers.BigNumber.from("511100000000000000000000000");
const STARTING_AMOUNT = BigNumber.from('175034246575342000000000');
const HALVING = 1460;
const INTERVAL = 86400;

const oneToken = BigNumber.from("1000000000000000000");

// Start test block
describe('StakingRewards', function () {
    before(async function () {
        this.PNG = await ethers.getContractFactory("Png");
        this.LpManager = await ethers.getContractFactory("LiquidityPoolManagerV2");
        this.LpManager2 = await ethers.getContractFactory("LiquidityPoolManagerV2");

        this.MockLpToken = await ethers.getContractFactory("contracts/MockContract.sol:MockContract");
        this.MockPair = await ethers.getContractFactory("contracts/MockContract.sol:MockContract");
        this.MockWavax = await ethers.getContractFactory("contracts/MockContract.sol:MockContract");
        this.MockTreasuryVester = await ethers.getContractFactory("contracts/MockContract.sol:MockContract");

        [ , this.addr2, this.addr3] = await ethers.getSigners();

        this.LpToken = await ethers.getContractFactory("Png");

        // ABIs for mocks
        this.WAVAX = await ethers.getContractFactory("WAVAX");
        this.wavax = await this.WAVAX.deploy();
        await this.wavax.deployed();

        this.TreasuryVester = await ethers.getContractFactory("TreasuryVester");

        this.StakingRewards = await ethers.getContractFactory("StakingRewards");

    });

    beforeEach(async function () {
        this.mockLpToken = await this.MockLpToken.deploy();
        await this.mockLpToken.deployed();

        this.mockPair = await this.MockPair.deploy();
        await this.mockPair.deployed();

        this.mockWavax = await this.MockWavax.deploy();
        await this.mockWavax.deployed();

        this.mockTreasuryVester = await this.MockTreasuryVester.deploy();
        await this.mockTreasuryVester.deployed();

        this.png = await this.PNG.deploy(OWNER_ADDRESS);
        await this.png.deployed();

        this.lpManager = await this.LpManager.deploy(this.mockWavax.address, this.png.address,
                                                     this.mockTreasuryVester.address);
        await this.lpManager.deployed();

        this.lpToken = await this.LpToken.deploy(OWNER_ADDRESS);
        await this.lpToken.deployed();


        this.treasury = await this.TreasuryVester.deploy(this.png.address);
        await this.treasury.deployed();

        this.lpManagerTreasury = await this.LpManager2.deploy(this.mockWavax.address, this.png.address,
            this.treasury.address);
        await this.lpManagerTreasury.deployed()

        this.stakingRewards = await this.StakingRewards.deploy(this.png.address, this.lpToken.address);
        await this.stakingRewards.deployed();

        this.stake2 = await this.stakingRewards.connect(this.addr2);
        this.stake3 = await this.stakingRewards.connect(this.addr3);

        this.altLpToken2 = await this.lpToken.connect(this.addr2);
        this.altLpToken3 = await this.lpToken.connect(this.addr3);
    });

    // Test cases

    //////////////////////////////
    //       Constructor
    //////////////////////////////
    describe("Constructor", function () {
        it('Start vesting successfully', async function () {

        });
    });

    //////////////////////////////
    //      startVesting
    //////////////////////////////
    describe("startVesting", function () {
        it('Start vesting successfully', async function () {
            stakeAmount = oneToken.mul(100);
            allowAmount = oneToken.mul(100);
            vestAmount = oneToken.mul(1000);
            actualAmount = BigNumber.from('999999999999999993600');
            await this.lpToken.transfer(this.addr2.address, allowAmount);
            await this.altLpToken2.approve(this.stakingRewards.address, allowAmount);
            await this.stake2.stake(stakeAmount);
            await this.png.transfer(this.stakingRewards.address, vestAmount);

            await this.stakingRewards.notifyRewardAmount(vestAmount);
            expect(await this.stakingRewards.earned(OWNER_ADDRESS)).to.equal(0);

            const periodFinish = await this.stakingRewards.periodFinish();

            await ethers.provider.send("evm_setNextBlockTimestamp", [periodFinish.toNumber()]);

            await this.stake2.getReward();
            expect(await this.png.balanceOf(this.addr2.address)).to.equal(actualAmount);

        });

        it('Two stakers, same time', async function () {
            stakeAmount = oneToken.mul(100);
            allowAmount = oneToken.mul(100);
            vestAmount = oneToken.mul(1000);
            actualAmount = BigNumber.from('499999999999999996800');

            // Move LP Tokens to addresses
            await this.lpToken.transfer(this.addr2.address, allowAmount);
            await this.lpToken.transfer(this.addr3.address, allowAmount);

            // Approve tokens for spending by the staker
            await this.altLpToken2.approve(this.stakingRewards.address, allowAmount);
            await this.altLpToken3.approve(this.stakingRewards.address, allowAmount);

            // Stake tokens
            await this.stake2.stake(stakeAmount);
            await this.stake3.stake(stakeAmount);

            // Transfer PNG for vesting
            await this.png.transfer(this.stakingRewards.address, vestAmount);

            // Call notify to get the staking contract of rewards
            await this.stakingRewards.notifyRewardAmount(vestAmount);

            // Set timestamp to finish the staking period
            const periodFinish = await this.stakingRewards.periodFinish();
            await ethers.provider.send("evm_setNextBlockTimestamp", [periodFinish.toNumber()]);

            // Claim rewards
            await this.stake2.getReward();
            await this.stake3.getReward();
            expect(await this.png.balanceOf(this.addr2.address)).to.equal(actualAmount);
            expect(await this.png.balanceOf(this.addr3.address)).to.equal(actualAmount);

        });

        it('Two stakers, different times', async function () {
            stakeAmount = oneToken.mul(100);
            allowAmount = oneToken.mul(100);
            vestAmount = oneToken.mul(1000);

            // First staker will have 100% of profits for half the interval, then they will split the
            // profits 50/50 for the second half. Leads to 75/25 split.
            largerAmount = BigNumber.from('749999999999999995200');
            smallerAmount = BigNumber.from('249999999999999998400');

            // Move LP Tokens to addresses
            await this.lpToken.transfer(this.addr2.address, allowAmount);
            await this.lpToken.transfer(this.addr3.address, allowAmount);

            // Approve tokens for spending by the staker
            await this.altLpToken2.approve(this.stakingRewards.address, allowAmount);
            await this.altLpToken3.approve(this.stakingRewards.address, allowAmount);

            // Stake first token
            await this.stake2.stake(stakeAmount);

            // Transfer PNG for vesting
            await this.png.transfer(this.stakingRewards.address, vestAmount);

            // Call notify to get the staking contract of rewards
            await this.stakingRewards.notifyRewardAmount(vestAmount);

            // Set timestamp to middle of the staking period
            const periodFinish = (await this.stakingRewards.periodFinish()).toNumber();
            const periodMiddle = periodFinish - (INTERVAL / 2)
            await ethers.provider.send("evm_setNextBlockTimestamp", [periodMiddle]);

            // Stake the second amount
            await this.stake3.stake(stakeAmount);

            // Set timestamp to finish the staking period
            await ethers.provider.send("evm_setNextBlockTimestamp", [periodFinish]);

            // Claim rewards
            await this.stake2.getReward();
            await this.stake3.getReward();
            expect(await this.png.balanceOf(this.addr2.address)).to.equal(largerAmount);
            expect(await this.png.balanceOf(this.addr3.address)).to.equal(smallerAmount);
        });

        it('Stake over multiple periods', async function () {
            stakeAmount = oneToken.mul(100);
            allowAmount = oneToken.mul(100);
            vestAmount = oneToken.mul(1000);

            // First staker will have 100% of profits for half the interval, then they will split the
            // profits 50/50 for the second half and the second interval.
            largerAmount = BigNumber.from('1249999999999999992000');
            smallerAmount = BigNumber.from('749999999999999995200');

            // Move LP Tokens to addresses
            await this.lpToken.transfer(this.addr2.address, allowAmount);
            await this.lpToken.transfer(this.addr3.address, allowAmount);

            // Approve tokens for spending by the staker
            await this.altLpToken2.approve(this.stakingRewards.address, allowAmount);
            await this.altLpToken3.approve(this.stakingRewards.address, allowAmount);

            // Stake first token
            await this.stake2.stake(stakeAmount);

            // Transfer PNG for vesting
            await this.png.transfer(this.stakingRewards.address, vestAmount);

            // Call notify to get the staking contract of rewards
            await this.stakingRewards.notifyRewardAmount(vestAmount);

            // Set timestamp to middle of the staking period
            var periodFinish = (await this.stakingRewards.periodFinish()).toNumber();
            const periodMiddle = periodFinish - (INTERVAL / 2)
            await ethers.provider.send("evm_setNextBlockTimestamp", [periodMiddle]);

            // Stake the second amount
            await this.stake3.stake(stakeAmount);

            // Set timestamp to finish the staking period
            await ethers.provider.send("evm_setNextBlockTimestamp", [periodFinish]);

            // Transfer PNG for vesting
            await this.png.transfer(this.stakingRewards.address, vestAmount);

            // Call notify to get the staking contract of rewards
            await this.stakingRewards.notifyRewardAmount(vestAmount);

            // Move the clock to the end of the period
            periodFinish = (await this.stakingRewards.periodFinish()).toNumber();
            await ethers.provider.send("evm_setNextBlockTimestamp", [periodFinish]);

            // Claim rewards
            await this.stake2.getReward();
            await this.stake3.getReward();
            expect(await this.png.balanceOf(this.addr2.address)).to.equal(largerAmount);
            expect(await this.png.balanceOf(this.addr3.address)).to.equal(smallerAmount);
        });

        it('Early withdraw', async function () {
            stakeAmount = oneToken.mul(100);
            allowAmount = oneToken.mul(100);
            vestAmount = oneToken.mul(1000);

            actualAmount = BigNumber.from('499999999999999996800');

            // Move LP Tokens to addresses
            await this.lpToken.transfer(this.addr2.address, allowAmount);

            // Approve tokens for spending by the staker
            await this.altLpToken2.approve(this.stakingRewards.address, allowAmount);

            // Stake first token
            await this.stake2.stake(stakeAmount);

            // Transfer PNG for vesting
            await this.png.transfer(this.stakingRewards.address, vestAmount);

            // Call notify to get the staking contract of rewards
            await this.stakingRewards.notifyRewardAmount(vestAmount);

            // Set timestamp to middle of the staking period
            var periodFinish = (await this.stakingRewards.periodFinish()).toNumber();
            const periodMiddle = periodFinish - (INTERVAL / 2)
            await ethers.provider.send("evm_setNextBlockTimestamp", [periodMiddle]);

            // Get rewards for half the period
            await this.stake2.getReward();
            expect(await this.png.balanceOf(this.addr2.address)).to.equal(actualAmount);

        });

        it('Early withdraw, the whole second period', async function () {
            stakeAmount = oneToken.mul(100);
            allowAmount = oneToken.mul(1000);
            vestAmount = oneToken.mul(1000);

            smallerAmount = BigNumber.from('499999999999999996800');
            largerAmount = BigNumber.from('1499988425925925916300');

            // Move LP Tokens to addresses
            await this.lpToken.transfer(this.addr2.address, allowAmount);

            // Approve tokens for spending by the staker
            await this.altLpToken2.approve(this.stakingRewards.address, allowAmount);

            // Stake first token
            await this.stake2.stake(stakeAmount);

            // Transfer PNG for vesting
            await this.png.transfer(this.stakingRewards.address, vestAmount);

            // Call notify to get the staking contract of rewards
            await this.stakingRewards.notifyRewardAmount(vestAmount);

            // Set timestamp to middle of the staking period
            var periodFinish = (await this.stakingRewards.periodFinish()).toNumber();
            const periodMiddle = periodFinish - (INTERVAL / 2)
            await ethers.provider.send("evm_setNextBlockTimestamp", [periodMiddle]);

            // Get rewards for half the period and exit
            await this.stake2.exit();
            expect(await this.png.balanceOf(this.addr2.address)).to.equal(smallerAmount);

            // Set timestamp to finish the staking period
            await ethers.provider.send("evm_setNextBlockTimestamp", [periodFinish]);

            // Transfer PNG for vesting
            await this.png.transfer(this.stakingRewards.address, vestAmount);

            // Call notify to get the staking contract of rewards
            await this.stakingRewards.notifyRewardAmount(vestAmount);

            // Stake again
            await this.stake2.stake(stakeAmount);

            // Move the clock to the end of the period
            periodFinish = (await this.stakingRewards.periodFinish()).toNumber();
            await ethers.provider.send("evm_setNextBlockTimestamp", [periodFinish]);

            // Claim rewards
            await this.stake2.getReward();
            expect(await this.png.balanceOf(this.addr2.address)).to.equal(largerAmount);
        });

        it('New money comes before period over', async function () {
            stakeAmount = oneToken.mul(100);
            allowAmount = oneToken.mul(1000);
            vestAmount = oneToken.mul(1000);

            smallerAmount = BigNumber.from('1249988426059885071900');
            largerAmount = BigNumber.from('1999999999999999913900');

            // Move LP Tokens to addresses
            await this.lpToken.transfer(this.addr2.address, allowAmount);

            // Approve tokens for spending by the staker
            await this.altLpToken2.approve(this.stakingRewards.address, allowAmount);

            // Stake first token
            await this.stake2.stake(stakeAmount);

            // Transfer PNG for vesting
            await this.png.transfer(this.stakingRewards.address, vestAmount);

            // Call notify to get the staking contract of rewards
            await this.stakingRewards.notifyRewardAmount(vestAmount);

            // Set timestamp to middle of the staking period
            var periodFinish = (await this.stakingRewards.periodFinish()).toNumber();
            const periodMiddle = periodFinish - (INTERVAL / 2)
            await ethers.provider.send("evm_setNextBlockTimestamp", [periodMiddle]);

            // Notify again with next period's rewards
            await this.png.transfer(this.stakingRewards.address, vestAmount);
            await this.stakingRewards.notifyRewardAmount(vestAmount);

            // Set timestamp to finish the first staking period
            await ethers.provider.send("evm_setNextBlockTimestamp", [periodFinish]);

            // Get first period's rewards
            await this.stake2.getReward();
            expect(await this.png.balanceOf(this.addr2.address)).to.equal(smallerAmount);

            // Move the clock to the end of the second period
            periodFinish = (await this.stakingRewards.periodFinish()).toNumber();
            await ethers.provider.send("evm_setNextBlockTimestamp", [periodFinish]);

            // Get second period's rewards
            await this.stake2.getReward();
            expect(await this.png.balanceOf(this.addr2.address)).to.equal(largerAmount);
        });


    });

    //////////////////////////////
    //       setowner
    //////////////////////////////
    describe("setowner", function () {
        it('Transfer owner successfully', async function () {
            expect((await this.stakingRewards.owner())).to.not.equal(UNPRIVILEGED_ADDRESS);
            await this.stakingRewards.transferOwnership(UNPRIVILEGED_ADDRESS);
            expect((await this.stakingRewards.owner())).to.equal(UNPRIVILEGED_ADDRESS);
        });

        it('Transfer owner unsuccessfully', async function () {
            await expect(this.stake2.transferOwnership(UNPRIVILEGED_ADDRESS)).to.be.revertedWith(
                "Ownable: caller is not the owner");
        });

        it('Renounce owner successfully', async function () {
            expect((await this.stakingRewards.owner())).to.not.equal(ethers.constants.AddressZero);
            await this.stakingRewards.renounceOwnership();
            expect((await this.stakingRewards.owner())).to.equal(ethers.constants.AddressZero);
        });

        it('Renounce owner unsuccessfully', async function () {
            await expect(this.stake2.renounceOwnership()).to.be.revertedWith(
                "Ownable: caller is not the owner");
        });
    });



});
