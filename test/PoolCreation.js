const { expect } = require('chai');
const { BigNumber } = require('ethers');
const { ethers } = require('hardhat');

const ZERO_ADDRESS = ethers.constants.AddressZero;
const AIRDROP_SUPPLY = ethers.utils.parseUnits("11500000", 18);
const TOTAL_SUPPLY = ethers.utils.parseUnits("230000000", 18);
const POOL_AMOUNT = ethers.utils.parseUnits("10000", 18);
const APPROVE_AMOUNT = ethers.utils.parseUnits("999999", 18);

describe('PoolCreation', function () {

    before(async function () {
        [ this.admin, this.unprivileged ] = await ethers.getSigners();
        this.PangolinFactory = await ethers.getContractFactory("PangolinFactory");
        this.PangolinRouter = await ethers.getContractFactory("PangolinRouter");
        this.PNG = await ethers.getContractFactory("Png");
        this.WAVAX = await ethers.getContractFactory("Png");
        this.NATERC20 = await ethers.getContractFactory("Png");
        this.JBXERC20 = await ethers.getContractFactory("Png");
    });

    beforeEach(async function () {
        // deploy some Tokens for test
        this.png = await this.PNG.deploy(TOTAL_SUPPLY, AIRDROP_SUPPLY, "PNG", "Pangolin");
        await this.png.deployed();
        this.wavax = await this.WAVAX.deploy(TOTAL_SUPPLY, AIRDROP_SUPPLY, "WAVAX", "Wrapped Avax");
        await this.wavax.deployed();
        this.naterc20 = await this.NATERC20.deploy(TOTAL_SUPPLY, AIRDROP_SUPPLY, "NAT", "NATERC20");
        await this.naterc20.deployed();
        this.jbxerc20 = await this.JBXERC20.deploy(TOTAL_SUPPLY, AIRDROP_SUPPLY, "JBX", "JBXERC20");
        await this.jbxerc20.deployed();
        //Deploy Factory
        this.factory = await this.PangolinFactory.deploy(this.admin.address);
        await this.factory.deployed();
        //Deploy Router
        this.router = await this.PangolinRouter.deploy(this.factory.address, this.wavax.address);
        await this.router.deployed();
        //Deadline parameter
        this.deadline = Math.floor(Date.now()/1000) + 1000000;
        this.png.approve(this.router.address, APPROVE_AMOUNT);
        this.wavax.approve(this.router.address, APPROVE_AMOUNT);
        this.naterc20.approve(this.router.address, APPROVE_AMOUNT);
        this.jbxerc20.approve(this.router.address, APPROVE_AMOUNT);
    });

    describe("PoolCreation with AddLiquidity", function () {
        it("Router Variable", async function() {
            expect(await this.router.factory()).to.equal(this.factory.address);
            expect(await this.router.WAVAX()).to.equal(this.wavax.address);
        });
        it("Create Pair", async function() {
            await expect(this.factory.createPair(this.png.address, this.wavax.address)).to.emit(this.factory, "PairCreated");
        });
        it("Create same pair 2 times", async function() {
            await expect(this.factory.createPair(this.png.address, this.wavax.address)).to.emit(this.factory, "PairCreated");
            await expect(this.factory.createPair(this.png.address, this.wavax.address)).to.be.revertedWith("Pangolin: PAIR_EXISTS");
        });
        it("Create some pairs", async function() {
            await expect(this.factory.createPair(this.png.address, this.wavax.address)).to.emit(this.factory, "PairCreated");
            await expect(this.factory.createPair(this.jbxerc20.address, this.wavax.address)).to.emit(this.factory, "PairCreated");
            await expect(this.factory.createPair(this.naterc20.address, this.wavax.address)).to.emit(this.factory, "PairCreated");
            await expect(this.factory.createPair(this.jbxerc20.address, this.png.address)).to.emit(this.factory, "PairCreated");
            await expect(this.factory.createPair(this.naterc20.address, this.png.address)).to.emit(this.factory, "PairCreated");
        });
        it("Create Pair with Zero address", async function() {
            await expect(this.factory.createPair(this.naterc20.address, ZERO_ADDRESS)).to.be.revertedWith("Pangolin: ZERO_ADDRESS");
        });
        it("Create Pair and AddLiquidity", async function() {
            await expect(this.factory.createPair(this.png.address, this.wavax.address)).to.emit(this.factory, "PairCreated");
            await expect(this.router.addLiquidity(
                this.png.address,
                this.wavax.address,
                POOL_AMOUNT,
                POOL_AMOUNT,
                0,
                0,
                this.admin.address,
                this.deadline
            )).to.emit(this.png, "Transfer");
        });
        it("Create a pair with adding Liquidity", async function() {
            await expect(this.router.addLiquidity(
                this.png.address,
                this.wavax.address,
                POOL_AMOUNT,
                POOL_AMOUNT,
                0,
                0,
                this.admin.address,
                this.deadline
            )).to.emit(this.factory, "PairCreated");
        });
        it("Create some pairs with adding Liquidity", async function() {
            await expect(this.router.addLiquidity(
                this.png.address,
                this.wavax.address,
                POOL_AMOUNT,
                POOL_AMOUNT,
                0,
                0,
                this.admin.address,
                this.deadline
            )).to.emit(this.factory, "PairCreated");
            await expect(this.router.addLiquidity(
                this.jbxerc20.address,
                this.png.address,
                POOL_AMOUNT,
                POOL_AMOUNT,
                0,
                0,
                this.admin.address,
                this.deadline
            )).to.emit(this.jbxerc20, "Transfer");
            await expect(this.router.addLiquidity(
                this.naterc20.address,
                this.png.address,
                POOL_AMOUNT,
                POOL_AMOUNT,
                0,
                0,
                this.admin.address,
                this.deadline
            )).to.emit(this.naterc20, "Transfer");
        });
    });
});
