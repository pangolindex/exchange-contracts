// test/PangoChef.js
// Load dependencies
const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const PNG_SUPPLY = ethers.utils.parseUnits("500000000", 18);
const ZERO_ADDRESS = ethers.constants.AddressZero;
const PERIOD_DURATION = 86400;

// Start test block
describe("PangoChef.sol", function () {
  before(async function () {
    // Get all signers
    this.signers = await ethers.getSigners();
    this.admin = this.signers[0];
    this.unauthorized = this.signers[1];

    // Give practically infinite ether to main user.
    await network.provider.send("hardhat_setBalance", [
      this.admin.address,
      "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
    ]);

    // get contract factories
    this.Pangolin = await ethers.getContractFactory("Png");
    this.Factory = await ethers.getContractFactory("PangolinFactory");
    this.Chef = await ethers.getContractFactory("PangoChef");
    this.Wavax = await ethers.getContractFactory("WAVAX");
    this.Pair = await ethers.getContractFactory("PangolinPair");
    this.Router = await ethers.getContractFactory("PangolinRouter");
    this.Rewarder = await ethers.getContractFactory("RewarderViaMultiplierForPangoChef");
  });

  beforeEach(async function () {
    // Deploy wrapped native gas token.
    this.wavax = await this.Wavax.deploy();
    await this.wavax.deployed();
    this.alt_wavax = await this.wavax.connect(this.unauthorized);

    // Deploy PNG ERC20 token for rewards.
    this.png = await this.Pangolin.deploy(PNG_SUPPLY, PNG_SUPPLY, "PNG", "Pangolin");
    await this.png.deployed();
    this.alt_png = await this.png.connect(this.unauthorized);

    // Deploy another ERC20 token.
    this.another_token = await this.Pangolin.deploy(PNG_SUPPLY, PNG_SUPPLY, "PNG", "Pangolin");
    await this.another_token.deployed();
    this.alt_another_token = await this.another_token.connect(this.unauthorized);

    // Deploy factory.
    this.factory = await this.Factory.deploy(ZERO_ADDRESS);
    await this.factory.deployed();

    // Deploy router.
    this.router = await this.Router.deploy(this.factory.address, this.wavax.address);
    await this.router.deployed();
    this.alt_router = await this.router.connect(this.unauthorized);

    // Create PNG-WAVAX pair.
    await this.factory.createPair(this.wavax.address, this.png.address);
    let pgl_address = await this.factory.getPair(this.wavax.address, this.png.address);
    this.pgl = await this.Pair.attach(pgl_address);
    this.alt_pgl = await this.pgl.connect(this.unauthorized);

    // Crete ANOTHER_TOKEN-WAVAX pair
    await this.factory.createPair(this.wavax.address, this.another_token.address);
    let another_pgl_address = await this.factory.getPair(this.wavax.address, this.another_token.address);
    this.another_pgl = await this.Pair.attach(another_pgl_address);
    this.alt_another_pgl = await this.another_pgl.connect(this.unauthorized);

    // Deploy PangoChef.
    this.chef = await this.Chef.deploy(this.png.address, this.admin.address, this.factory.address, this.wavax.address);
    await this.chef.deployed();
    this.alt_chef = await this.chef.connect(this.unauthorized);

    // Approve for first user.
    await this.wavax.approve(this.router.address, ethers.constants.MaxUint256);
    await this.png.approve(this.router.address, ethers.constants.MaxUint256);
    await this.another_token.approve(this.router.address, ethers.constants.MaxUint256);
    await this.wavax.approve(this.chef.address, ethers.constants.MaxUint256);
    await this.png.approve(this.chef.address, ethers.constants.MaxUint256);
    await this.pgl.approve(this.chef.address, ethers.constants.MaxUint256);
    await this.another_pgl.approve(this.chef.address, ethers.constants.MaxUint256);
    await this.another_token.approve(this.chef.address, ethers.constants.MaxUint256);

    // Approve for second user.
    await this.alt_wavax.approve(this.router.address, ethers.constants.MaxUint256);
    await this.alt_png.approve(this.router.address, ethers.constants.MaxUint256);
    await this.alt_another_token.approve(this.router.address, ethers.constants.MaxUint256);
    await this.alt_wavax.approve(this.chef.address, ethers.constants.MaxUint256);
    await this.alt_png.approve(this.chef.address, ethers.constants.MaxUint256);
    await this.alt_pgl.approve(this.chef.address, ethers.constants.MaxUint256);
    await this.alt_another_pgl.approve(this.chef.address, ethers.constants.MaxUint256);
    await this.alt_another_token.approve(this.chef.address, ethers.constants.MaxUint256);

    await this.wavax.deposit({value: ethers.utils.parseEther("1000000000000")});
    await this.png.transfer(this.pgl.address, ethers.utils.parseEther("1000000"));
    await this.wavax.transfer(this.pgl.address, ethers.utils.parseEther("50000"));
    await this.pgl.mint(this.admin.address);
    await this.another_token.transfer(this.another_pgl.address, ethers.utils.parseEther("1000000"));
    await this.wavax.transfer(this.another_pgl.address, ethers.utils.parseEther("50000"));
    await this.another_pgl.mint(this.admin.address);

    // Get token amounts per address.
    this.pgl_amount = (await this.pgl.balanceOf(this.admin.address)).div("2");
    this.png_amount = PNG_SUPPLY.div("2");

    // Transfer tokens to the second user.
    this.pgl.transfer(this.unauthorized.address, this.pgl_amount);
    this.png.transfer(this.unauthorized.address, this.png_amount);
    this.another_token.transfer(this.unauthorized.address, this.png_amount);
  });

  // Test cases

  //////////////////////////////
  //     Constructor
  //////////////////////////////
  describe("Constructor", function () {
    it("arg 1: rewardsToken", async function () {
      expect(await this.chef.rewardsToken()).to.equal(this.png.address);
    });

    it("arg 2: admin", async function () {
      expect(await this.chef.hasRole(
        "0x0000000000000000000000000000000000000000000000000000000000000000",
        this.admin.address
    )).to.equal(true);
    });

    it("arg 3: factory", async function () {
      expect(await this.chef.factory()).to.equal(this.factory.address);
    });

    it("arg 4: wrappedNativeToken", async function () {
      expect(await this.chef.wrappedNativeToken()).to.equal(this.wavax.address);
    });

    it("construction: no null inputs", async function () {
      await expect(this.Chef.deploy(ethers.constants.AddressZero, this.admin.address, this.factory.address, this.wavax.address)).to.be.revertedWith("NullInput");
      await expect(this.Chef.deploy(this.png.address, this.admin.address, this.factory.address, ethers.constants.AddressZero)).to.be.revertedWith("NullInput");
      await expect(this.Chef.deploy(this.png.address, this.admin.address, ethers.constants.AddressZero, this.wavax.address)).to.be.reverted;
      await expect(this.Chef.deploy(this.png.address, ethers.constants.AddressZero, this.factory.address, this.wavax.address)).to.be.revertedWith("NullInput");
    });

  });

  //////////////////////////////
  //     stake
  //////////////////////////////
  describe("stake", function () {
    it("stakes to pool zero: reward added after staking", async function () {
      // We will stake four times, so divide the pgl amount in wallet by 4.
      const amount = this.pgl_amount.div("4");

      // Stake first time, initializing the contract.
      expect(await this.chef.stake("0", amount)).to.emit(this.chef, "Staked");

      // Get last time stamp.
      let blockNumber = await ethers.provider.getBlockNumber();
      let lastUpdate = (await ethers.provider.getBlock(blockNumber)).timestamp;

      expect(await this.chef.lastUpdate()).to.equal(0);

      // Stake again to have a "normalized" gas on next calls.
      expect(await this.chef.stake("0", amount)).to.emit(this.chef, "Staked");

      // Add rewards, and stake the third time.
      expect(await this.chef.addReward(ethers.utils.parseEther("1000000"))).to.emit(this.chef, "RewardAdded")
      expect(await this.chef.stake("0", amount)).to.emit(this.chef, "Staked");

      // Stake one more time, cuz why not.
      expect(await this.chef.stake("0", amount)).to.emit(this.chef, "Staked");
    });

    it("stakes to pool zero: reward added before staking", async function () {
      const amount = this.pgl_amount.div("2");
      expect(await this.chef.addReward(ethers.utils.parseEther("1000000"))).to.emit(this.chef, "RewardAdded")
      expect(await this.chef.stake("0", amount)).to.emit(this.chef, "Staked");
      expect(await this.chef.stake("0", amount)).to.emit(this.chef, "Staked");
    });

    it("stakes to multiple pools: weight set before staking", async function () {
      const amount = this.pgl_amount.div("2");
      expect(await this.chef.addReward(ethers.utils.parseEther("1000000"))).to.emit(this.chef, "RewardAdded")
      expect(await this.chef.stake("0", amount)).to.emit(this.chef, "Staked");
      expect(await this.chef.stake("0", amount)).to.emit(this.chef, "Staked");

      // Initialize second pool, and add weight.
      expect(await this.chef.initializePool(this.another_token.address, "1")).to.emit(this.chef, "PoolInitialized");
      expect(await this.chef.setWeights(["1"], ["500"])).to.emit(this.chef, "WeightSet");

      // Stake to the second pool.
      expect(await this.chef.stake("1", amount)).to.emit(this.chef, "Staked");
      expect(await this.chef.stake("1", amount.div("2"))).to.emit(this.chef, "Staked");
      expect(await this.chef.stake("1", amount.div("2"))).to.emit(this.chef, "Staked");
    });

    it("stakes to multiple pools: weight set after staking", async function () {
      const amount = this.pgl_amount.div("2");
      expect(await this.chef.addReward(ethers.utils.parseEther("1000000"))).to.emit(this.chef, "RewardAdded")
      expect(await this.chef.stake("0", amount)).to.emit(this.chef, "Staked");
      expect(await this.chef.stake("0", amount)).to.emit(this.chef, "Staked");

      // Initialize the second pool.
      expect(await this.chef.initializePool(this.another_token.address, "1")).to.emit(this.chef, "PoolInitialized");

      // Stake to the second pool.
      expect(await this.chef.stake("1", amount)).to.emit(this.chef, "Staked");

      // Add weight to the second pool.
      expect(await this.chef.setWeights(["1"], ["500"])).to.emit(this.chef, "WeightSet");

      // Stake the rest to the second pool.
      expect(await this.chef.stake("1", amount.div("2"))).to.emit(this.chef, "Staked");
      expect(await this.chef.stake("1", amount.div("2"))).to.emit(this.chef, "Staked");
    });

    it("stakes to multiple pools: multiple users", async function () {
      const amount = this.pgl_amount.div("2");

      // Initialize the second pool. And add weight to the second pool.
      expect(await this.chef.initializePool(this.another_token.address, "1")).to.emit(this.chef, "PoolInitialized");
      expect(await this.chef.setWeights(["1"], ["500"])).to.emit(this.chef, "WeightSet");

      // Fund the contract rewards.
      expect(await this.chef.addReward(ethers.utils.parseEther("1000000"))).to.emit(this.chef, "RewardAdded")

      expect(await this.chef.stake("0", amount)).to.emit(this.chef, "Staked");
      await network.provider.send("evm_increaseTime", [3600]);
      expect(await this.chef.stake("0", amount)).to.emit(this.chef, "Staked");
      await network.provider.send("evm_increaseTime", [3600]);
      expect(await this.alt_chef.stake("0", amount)).to.emit(this.chef, "Staked");
      await network.provider.send("evm_increaseTime", [3600]);
      expect(await this.alt_chef.stake("0", amount)).to.emit(this.chef, "Staked");
      await network.provider.send("evm_increaseTime", [3600]);

      // Stake to the second pool.
      expect(await this.chef.stake("1", amount)).to.emit(this.chef, "Staked");
      await network.provider.send("evm_increaseTime", [3600]);
      expect(await this.chef.stake("1", amount)).to.emit(this.chef, "Staked");
      await network.provider.send("evm_increaseTime", [3600]);
      expect(await this.alt_chef.stake("1", amount)).to.emit(this.chef, "Staked");
      await network.provider.send("evm_increaseTime", [3600]);
      expect(await this.alt_chef.stake("1", amount)).to.emit(this.chef, "Staked");
      await network.provider.send("evm_increaseTime", [3600]);
    });

  });

  //////////////////////////////
  //     withdraw
  //////////////////////////////
  describe("withdraw", function () {
    it("withdraws from pool zero: without rewards", async function () {
      const amount = this.pgl_amount.div("2");
      expect(await this.chef.stake("0", amount)).to.emit(this.chef, "Staked");
      expect(await this.chef.stake("0", amount)).to.emit(this.chef, "Staked");
      expect(await this.chef.withdraw("0", amount)).to.emit(this.chef, "Withdrawn");

      // Wait until funding is over to ensure sufficient rewards exist.
      expect(await this.chef.addReward(ethers.utils.parseEther("1000000"))).to.emit(this.chef, "RewardAdded")
      await network.provider.send("evm_increaseTime", [PERIOD_DURATION]);
      expect(await this.chef.withdraw("0", amount)).to.emit(this.chef, "Withdrawn");
    });

    it("withdraws from pool zero: reward added before staking", async function () {
      const amount = this.pgl_amount.div("2");
      expect(await this.chef.addReward(ethers.utils.parseEther("1000000"))).to.emit(this.chef, "RewardAdded")
      expect(await this.chef.stake("0", amount)).to.emit(this.chef, "Staked");
      expect(await this.chef.stake("0", amount)).to.emit(this.chef, "Staked");
      expect(await this.chef.withdraw("0", amount)).to.emit(this.chef, "Withdrawn");

      // Wait until funding is over to ensure sufficient rewards exist.
      await network.provider.send("evm_increaseTime", [PERIOD_DURATION]);
      expect(await this.chef.withdraw("0", amount)).to.emit(this.chef, "Withdrawn");
    });
  });

  //////////////////////////////
  //     harvest
  //////////////////////////////
  describe("harvest", function () {
    it("cannot harvest without rewards", async function () {
      const amount = this.pgl_amount.div("2");
      expect(await this.chef.stake("0", amount)).to.emit(this.chef, "Staked");
      expect(await this.chef.stake("0", amount)).to.emit(this.chef, "Staked");
      await expect(this.chef.harvest("0")).to.be.revertedWith("NoEffect");
    });

    it("harvests from pool zero", async function () {
      const amount = this.pgl_amount.div("2");
      expect(await this.chef.addReward(ethers.utils.parseEther("1000000"))).to.emit(this.chef, "RewardAdded")
      expect(await this.chef.stake("0", amount)).to.emit(this.chef, "Staked");
      expect(await this.chef.stake("0", amount)).to.emit(this.chef, "Staked");
      expect(await this.chef.harvest("0")).to.emit(this.chef, "Withdrawn");

      // Wait until funding is over to ensure sufficient rewards exist.
      await network.provider.send("evm_increaseTime", [PERIOD_DURATION]);
      expect(await this.chef.harvest("0")).to.emit(this.chef, "Withdrawn");
      expect(await this.chef.withdraw("0", this.pgl_amount)).to.emit(this.chef, "Withdrawn");
    });
  });

  //////////////////////////////
  //     compound
  //////////////////////////////
  describe("compound", function () {
    it("compounds pool zero using AVAX", async function () {
      // Fund the contract.
      expect(await this.chef.addReward(ethers.utils.parseEther("1000000"))).to.emit(this.chef, "RewardAdded")

      // Stake.
      expect(await this.chef.stake("0", this.pgl_amount)).to.emit(this.chef, "Staked");

      // Wait a bit before compounding.
      await network.provider.send("evm_increaseTime", [3600]);

      // Compound with practically unlimited slippage.
      const maxPairAmount = ethers.utils.parseEther("10000000000000");
      const slippage = { minPairAmount: 0, maxPairAmount: maxPairAmount };
      expect(await this.chef.compound("0", slippage, {value: maxPairAmount})).to.emit(this.chef, "Staked");
    });

    it("compounds pool zero using WAVAX", async function () {
      // Fund the contract.
      expect(await this.chef.addReward(ethers.utils.parseEther("1000000"))).to.emit(this.chef, "RewardAdded")

      // Stake.
      expect(await this.chef.stake("0", this.pgl_amount)).to.emit(this.chef, "Staked");

      // Wait a bit before compounding.
      await network.provider.send("evm_increaseTime", [3600]);

      // Compound with practically unlimited slippage.
      const maxPairAmount = ethers.utils.parseEther("10000000000000");
      const slippage = { minPairAmount: 0, maxPairAmount: maxPairAmount };
      expect(await this.chef.compound("0", slippage, {value: "0"})).to.emit(this.chef, "Staked");
    });

    it("compounds another pool using WAVAX", async function () {
      // Fund the contract.
      expect(await this.chef.addReward(ethers.utils.parseEther("1000000"))).to.emit(this.chef, "RewardAdded")

      // Initialize the second pool. And add weight to the second pool.
      expect(await this.chef.initializePool(this.pgl.address, "1")).to.emit(this.chef, "PoolInitialized");
      expect(await this.chef.setWeights(["1"], ["500"])).to.emit(this.chef, "WeightSet");

      // Stake.
      expect(await this.chef.stake("1", this.pgl_amount)).to.emit(this.chef, "Staked");

      // Wait a bit before compounding.
      await network.provider.send("evm_increaseTime", [3600]);

      // Compound with practically unlimited slippage.
      const maxPairAmount = ethers.utils.parseEther("10000000000000");
      const slippage = { minPairAmount: 0, maxPairAmount: maxPairAmount };
      expect(await this.chef.compound("1", slippage, {value: "0"})).to.emit(this.chef, "Staked");
    });
  });

  //////////////////////////////
  //     compoundToPoolZero
  //////////////////////////////
  describe("compoundTo & locking mechanism invariant tests", function () {
    it("compounds to pool zero using AVAX", async function () {
      // Fund the contract.
      expect(await this.chef.addReward(ethers.utils.parseEther("1000000"))).to.emit(this.chef, "RewardAdded")

      // Initialize the second pool. And add weight to the second pool.
      expect(await this.chef.initializePool(this.another_pgl.address, "1")).to.emit(this.chef, "PoolInitialized");
      expect(await this.chef.setWeights(["1"], ["500"])).to.emit(this.chef, "WeightSet");

      // Stake to the second pool.
      expect(await this.chef.stake("1", this.pgl_amount)).to.emit(this.chef, "Staked");

      // Wait a bit before compounding.
      await network.provider.send("evm_increaseTime", [3600]);

      // Compound with practically unlimited slippage.
      const maxPairAmount = ethers.utils.parseEther("10000000000000");
      const slippage = { minPairAmount: 0, maxPairAmount: maxPairAmount };
      expect(await this.chef.compoundTo("1", "0", slippage, {value: maxPairAmount})).to.emit(this.chef, "Staked");

      // Compound twice to check there is not double lock.
      await network.provider.send("evm_increaseTime", [3600]);
      expect(await this.chef.compoundTo("1", "0", slippage, {value: maxPairAmount})).to.emit(this.chef, "Staked");

      // check lock count
      expect((await this.chef.getUser("0", this.admin.address)).lockCount).to.equal("1");
      expect((await this.chef.getUser("1", this.admin.address)).lockCount).to.equal("0");

      const lockedPoolsOfPool0Before = await this.chef.getLockedPools("0", this.admin.address);
      expect(lockedPoolsOfPool0Before.length).to.equal(0);

      const lockedPoolsOfPool1Before = await this.chef.getLockedPools("1", this.admin.address);
      expect(lockedPoolsOfPool1Before.length).to.equal(1);
      expect(lockedPoolsOfPool1Before[0]).to.equal("0");

      // cannot withdraw locked pool
      await expect(this.chef.withdraw("0", this.pgl_amount)).to.be.revertedWith("Locked");

      // can withdraw pool one
      await this.chef.withdraw("1", this.pgl_amount);

      // can withdraw pool zero after unlock
      expect((await this.chef.getUser("0", this.admin.address)).lockCount).to.equal("0");
      expect((await this.chef.getUser("1", this.admin.address)).lockCount).to.equal("0");

      const lockedPoolsOfPool0After = await this.chef.getLockedPools("0", this.admin.address);
      expect(lockedPoolsOfPool0After.length).to.equal(0);

      const lockedPoolsOfPool1After = await this.chef.getLockedPools("1", this.admin.address);
      expect(lockedPoolsOfPool1After.length).to.equal(0);

      await this.chef.withdraw("0", "1");
    });

    it("compounds to pool zero using WAVAX", async function () {
      // Fund the contract.
      expect(await this.chef.addReward(ethers.utils.parseEther("1000000"))).to.emit(this.chef, "RewardAdded")

      // Initialize the second pool. And add weight to the second pool.
      expect(await this.chef.initializePool(this.another_pgl.address, "1")).to.emit(this.chef, "PoolInitialized");
      expect(await this.chef.setWeights(["1"], ["500"])).to.emit(this.chef, "WeightSet");

      // Stake to the second pool.
      expect(await this.chef.stake("1", this.pgl_amount)).to.emit(this.chef, "Staked");

      // Wait a bit before compounding.
      await network.provider.send("evm_increaseTime", [3600]);

      // Compound with practically unlimited slippage.
      const maxPairAmount = ethers.utils.parseEther("10000000000000");
      const slippage = { minPairAmount: 0, maxPairAmount: maxPairAmount };
      expect(await this.chef.compoundTo("1", "0", slippage, {value: "0"})).to.emit(this.chef, "Staked");

      // check lock count
      expect((await this.chef.getUser("0", this.admin.address)).lockCount).to.equal("1");
      expect((await this.chef.getUser("1", this.admin.address)).lockCount).to.equal("0");

      const lockedPoolsOfPool0 = await this.chef.getLockedPools("0", this.admin.address);
      expect(lockedPoolsOfPool0.length).to.equal(0);

      const lockedPoolsOfPool1 = await this.chef.getLockedPools("1", this.admin.address);
      expect(lockedPoolsOfPool1.length).to.equal(1);
      expect(lockedPoolsOfPool1[0]).to.equal("0");

      // cannot withdraw locked pool
      await expect(this.chef.withdraw("0", this.pgl_amount)).to.be.revertedWith("Locked");

      // can withdraw pool one
      await this.chef.withdraw("1", this.pgl_amount);

      // can withdraw pool zero after unlock
      expect((await this.chef.getUser("0", this.admin.address)).lockCount).to.equal("0");
      expect((await this.chef.getUser("1", this.admin.address)).lockCount).to.equal("0");

      const lockedPoolsOfPool0After = await this.chef.getLockedPools("0", this.admin.address);
      expect(lockedPoolsOfPool0After.length).to.equal(0);

      const lockedPoolsOfPool1After = await this.chef.getLockedPools("1", this.admin.address);
      expect(lockedPoolsOfPool1After.length).to.equal(0);

      await this.chef.withdraw("0", "1");
    });

    it("compounds from two pools to pool zero", async function () {
      // Fund the contract.
      expect(await this.chef.addReward(ethers.utils.parseEther("1000000"))).to.emit(this.chef, "RewardAdded")

      // Initialize the second & third pool. And add weight to the second pool.
      expect(await this.chef.initializePool(this.another_pgl.address, "1")).to.emit(this.chef, "PoolInitialized");
      expect(await this.chef.initializePool(this.another_pgl.address, "1")).to.emit(this.chef, "PoolInitialized");
      expect(await this.chef.setWeights(["1", "2"], ["500", "500"])).to.emit(this.chef, "WeightSet");

      // Stake to the second & third pool.
      expect(await this.chef.stake("1", this.pgl_amount)).to.emit(this.chef, "Staked");
      expect(await this.chef.stake("2", this.pgl_amount)).to.emit(this.chef, "Staked");

      // Wait a bit before compounding.
      await network.provider.send("evm_increaseTime", [3600]);

      // Compound with practically unlimited slippage.
      const maxPairAmount = ethers.utils.parseEther("10000000000000");
      const slippage = { minPairAmount: 0, maxPairAmount: maxPairAmount };
      expect(await this.chef.compoundTo("1", "0", slippage, {value: "0"})).to.emit(this.chef, "Staked");
      expect(await this.chef.compoundTo("2", "0", slippage, {value: "0"})).to.emit(this.chef, "Staked");

      // check lock count
      expect((await this.chef.getUser("0", this.admin.address)).lockCount).to.equal("2");
      expect((await this.chef.getUser("1", this.admin.address)).lockCount).to.equal("0");
      expect((await this.chef.getUser("2", this.admin.address)).lockCount).to.equal("0");

      const lockedPoolsOfPool0Before = await this.chef.getLockedPools("0", this.admin.address);
      expect(lockedPoolsOfPool0Before.length).to.equal(0);

      const lockedPoolsOfPool1Before = await this.chef.getLockedPools("1", this.admin.address);
      expect(lockedPoolsOfPool1Before.length).to.equal(1);
      expect(lockedPoolsOfPool1Before[0]).to.equal("0");

      const lockedPoolsOfPool2Before = await this.chef.getLockedPools("2", this.admin.address);
      expect(lockedPoolsOfPool2Before.length).to.equal(1);
      expect(lockedPoolsOfPool2Before[0]).to.equal("0");

      // cannot withdraw locked pool
      await expect(this.chef.withdraw("0", this.pgl_amount)).to.be.revertedWith("Locked");

      // can withdraw other pools
      await this.chef.withdraw("1", this.pgl_amount);
      await this.chef.withdraw("2", this.pgl_amount);

      // can withdraw pool zero after unlock
      expect((await this.chef.getUser("0", this.admin.address)).lockCount).to.equal("0");
      expect((await this.chef.getUser("1", this.admin.address)).lockCount).to.equal("0");
      expect((await this.chef.getUser("2", this.admin.address)).lockCount).to.equal("0");

      const lockedPoolsOfPool0After = await this.chef.getLockedPools("0", this.admin.address);
      expect(lockedPoolsOfPool0After.length).to.equal(0);
      const lockedPoolsOfPool1After = await this.chef.getLockedPools("1", this.admin.address);
      expect(lockedPoolsOfPool1After.length).to.equal(0);
      const lockedPoolsOfPool2After = await this.chef.getLockedPools("2", this.admin.address);
      expect(lockedPoolsOfPool2After.length).to.equal(0);

      await this.chef.withdraw("0", "1");
    });

    it("compounds from one pool to two pools", async function () {
      // Fund the contract.
      expect(await this.chef.addReward(ethers.utils.parseEther("1000000"))).to.emit(this.chef, "RewardAdded")

      // Initialize the second & third pool. And add weight to the second pool.
      expect(await this.chef.initializePool(this.pgl.address, "1")).to.emit(this.chef, "PoolInitialized");
      expect(await this.chef.initializePool(this.another_pgl.address, "1")).to.emit(this.chef, "PoolInitialized");
      expect(await this.chef.setWeights(["1", "2"], ["500", "500"])).to.emit(this.chef, "WeightSet");

      // Stake to the second & third pool.
      expect(await this.chef.stake("1", this.pgl_amount)).to.emit(this.chef, "Staked");
      expect(await this.chef.stake("2", this.pgl_amount)).to.emit(this.chef, "Staked");

      // Wait a bit before compounding.
      await network.provider.send("evm_increaseTime", [3600]);

      // Compound with practically unlimited slippage.
      const maxPairAmount = ethers.utils.parseEther("10000000000000");
      const slippage = { minPairAmount: 0, maxPairAmount: maxPairAmount };
      expect(await this.chef.compoundTo("2", "0", slippage, {value: "0"})).to.emit(this.chef, "Staked");

      // Wait a bit before compounding.
      await network.provider.send("evm_increaseTime", [3600]);
      expect(await this.chef.compoundTo("2", "1", slippage, {value: "0"})).to.emit(this.chef, "Staked");

      // check lock count
      expect((await this.chef.getUser("0", this.admin.address)).lockCount).to.equal("1");
      expect((await this.chef.getUser("1", this.admin.address)).lockCount).to.equal("1");
      expect((await this.chef.getUser("2", this.admin.address)).lockCount).to.equal("0");

      const lockedPoolsOfPool0 = await this.chef.getLockedPools("0", this.admin.address);
      expect(lockedPoolsOfPool0.length).to.equal(0);

      const lockedPoolsOfPool1 = await this.chef.getLockedPools("1", this.admin.address);
      expect(lockedPoolsOfPool1.length).to.equal(0);

      const lockedPoolsOfPool2 = await this.chef.getLockedPools("2", this.admin.address);
      expect(lockedPoolsOfPool2.length).to.equal(2);
      expect(lockedPoolsOfPool2[0]).to.equal("0");
      expect(lockedPoolsOfPool2[1]).to.equal("1");

      // cannot withdraw locked pools
      await expect(this.chef.withdraw("0", this.pgl_amount)).to.be.revertedWith("Locked");
      await expect(this.chef.withdraw("1", this.pgl_amount)).to.be.revertedWith("Locked");

      // can withdraw other pools
      await this.chef.withdraw("2", this.pgl_amount);

      // can withdraw pools after unlock
      expect((await this.chef.getUser("0", this.admin.address)).lockCount).to.equal("0");
      expect((await this.chef.getUser("1", this.admin.address)).lockCount).to.equal("0");
      expect((await this.chef.getUser("2", this.admin.address)).lockCount).to.equal("0");

      const lockedPoolsOfPool0After = await this.chef.getLockedPools("0", this.admin.address);
      expect(lockedPoolsOfPool0After.length).to.equal(0);
      const lockedPoolsOfPool1After = await this.chef.getLockedPools("1", this.admin.address);
      expect(lockedPoolsOfPool1After.length).to.equal(0);
      const lockedPoolsOfPool2After = await this.chef.getLockedPools("2", this.admin.address);
      expect(lockedPoolsOfPool2After.length).to.equal(0);

      await this.chef.withdraw("0", "1");
      await this.chef.withdraw("1", this.pgl_amount);
    });
  });

  //////////////////////////////
  //     stakeTo
  //////////////////////////////
  describe("stakeTo", function () {
    it("stakes to pool zero for someone else: reward added after staking", async function () {
      const amount = this.pgl_amount.div("4");
      expect(await this.chef.stakeTo("0", this.unauthorized.address, amount)).to.emit(this.chef, "Staked");
      expect(await this.chef.stakeTo("0", this.unauthorized.address, amount)).to.emit(this.chef, "Staked");
      expect(await this.chef.addReward(ethers.utils.parseEther("1000000"))).to.emit(this.chef, "RewardAdded")
      expect(await this.chef.stakeTo("0", this.unauthorized.address, amount)).to.emit(this.chef, "Staked");
      expect(await this.chef.stakeTo("0", this.unauthorized.address, amount)).to.emit(this.chef, "Staked");
    });

    it("stakes to pool zero for someone else:: reward added before staking", async function () {
      const amount = this.pgl_amount.div("2");
      expect(await this.chef.addReward(ethers.utils.parseEther("1000000"))).to.emit(this.chef, "RewardAdded")
      expect(await this.chef.stakeTo("0", this.unauthorized.address, amount)).to.emit(this.chef, "Staked");
      expect(await this.chef.stakeTo("0", this.unauthorized.address, amount)).to.emit(this.chef, "Staked");
    });
  });


  //////////////////////////////
  //     claim
  //////////////////////////////
  describe("claim", function () {
    it("claims from alt pool: does not revert without rewards", async function () {
      // Initialize the second pool. And add weight to the second pool.
      expect(await this.chef.initializePool(this.admin.address, "2")).to.emit(this.chef, "PoolInitialized");
      expect(await this.chef.setWeights(["1"], ["500"])).to.emit(this.chef, "WeightSet");

      // Try claiming without rewards.
      expect(await this.chef.claim("1")).to.emit(this.chef, "Withdrawn");

      // Add rewards and pass time.
      expect(await this.chef.addReward(ethers.utils.parseEther("1000000"))).to.emit(this.chef, "RewardAdded")
      await network.provider.send("evm_increaseTime", [3600]);

      // Try claiming with rewards.
      expect(await this.chef.claim("1")).to.emit(this.chef, "Withdrawn");
    });

    it("non-recipient cannot claim", async function () {
      // Initialize the second pool. And add weight to the second pool.
      expect(await this.chef.initializePool(this.admin.address, "2")).to.emit(this.chef, "PoolInitialized");
      expect(await this.chef.setWeights(["1"], ["500"])).to.emit(this.chef, "WeightSet");

      // Add rewards and pass time.
      expect(await this.chef.addReward(ethers.utils.parseEther("1000000"))).to.emit(this.chef, "RewardAdded")
      await network.provider.send("evm_increaseTime", [3600]);

      // Try claiming with rewards with unauthorized user.
      await expect(this.alt_chef.claim("1")).to.be.revertedWith("UnprivilegedCaller");
    });

    it("cannot claim from non-relayer pools", async function () {
      // Try claiming from non-existant pool.
      await expect(this.chef.claim("1")).to.be.revertedWith("InvalidType");

      // Try claiming from erc20 pool.
      await expect(this.chef.claim("0")).to.be.revertedWith("InvalidType");
    });
  });

  //////////////////////////////
  //     emergencyExit
  //////////////////////////////
  describe("emergencyExit", function () {
    it("level1", async function () {
      const amount = this.pgl_amount.div("4");
      expect(await this.chef.stake("0", amount)).to.emit(this.chef, "Staked");
      expect(await this.chef.stake("0", amount)).to.emit(this.chef, "Staked");

      // Add rewards and pass time.
      expect(await this.chef.addReward(ethers.utils.parseEther("1000000"))).to.emit(this.chef, "RewardAdded")
      await network.provider.send("evm_increaseTime", [3600]);

      // Try claiming with rewards.
      expect(await this.chef.emergencyExitLevel1("0")).to.emit(this.chef, "Withdrawn");
    });

    it("level2", async function () {
      const amount = this.pgl_amount.div("4");
      expect(await this.chef.stake("0", amount)).to.emit(this.chef, "Staked");
      expect(await this.chef.stake("0", amount)).to.emit(this.chef, "Staked");

      // Add rewards and pass time.
      expect(await this.chef.addReward(ethers.utils.parseEther("1000000"))).to.emit(this.chef, "RewardAdded")
      await network.provider.send("evm_increaseTime", [3600]);

      const confirmation = ethers.utils.solidityKeccak256(["string", "address"], ["I am ready to lose everything in this pool. Let me go.", this.admin.address]);

      // Try claiming with rewards.
      await this.chef.emergencyExitLevel2("0", confirmation);
    });

    it("exits when rewarder is set", async function () {
      const amount = this.pgl_amount.div("4");
      expect(await this.chef.stake("0", amount)).to.emit(this.chef, "Staked");
      expect(await this.chef.stake("0", amount)).to.emit(this.chef, "Staked");

      // Add rewards and pass time.
      expect(await this.chef.addReward(ethers.utils.parseEther("1000000"))).to.emit(this.chef, "RewardAdded")
      await network.provider.send("evm_increaseTime", [3600]);

      this.rewarder = await this.Rewarder.deploy([ this.another_token.address ], [ ethers.utils.parseEther("1") ], '18', this.chef.address);
      await this.rewarder.deployed();
      await this.another_token.transfer(this.rewarder.address, ethers.utils.parseEther("50000"));
      expect(await this.chef.setRewarder("0", this.rewarder.address)).to.emit(this.chef, "RewarderSet");

      // Try claiming with rewards.
      await this.chef.emergencyExitLevel1("0");
    });

    it("exits when EOA rewarder is set", async function () {
      const amount = this.pgl_amount.div("4");
      expect(await this.chef.stake("0", amount)).to.emit(this.chef, "Staked");
      expect(await this.chef.stake("0", amount)).to.emit(this.chef, "Staked");

      // Add rewards and pass time.
      expect(await this.chef.addReward(ethers.utils.parseEther("1000000"))).to.emit(this.chef, "RewardAdded")
      await network.provider.send("evm_increaseTime", [3600]);

      expect(await this.chef.setRewarder("0", this.admin.address)).to.emit(this.chef, "RewarderSet");

      // Try claiming with rewards.
      await this.chef.emergencyExitLevel1("0");
    });
  });

  //////////////////////////////
  //     setRewarder
  //////////////////////////////
  describe("setRewarder", function () {
    it("POOL_MANAGER sets rewarder back and forth", async function () {
      expect(await this.chef.setRewarder("0", this.admin.address)).to.emit(this.chef, "RewarderSet");
      expect((await this.chef.pools("0")).rewarder).to.equal(this.admin.address);

      expect(await this.chef.setRewarder("0", ethers.constants.AddressZero)).to.emit(this.chef, "RewarderSet");
      expect((await this.chef.pools("0")).rewarder).to.equal(ethers.constants.AddressZero);
    });

    it("unauthorized cannot set rewarder", async function () {
      await expect(this.alt_chef.setRewarder("0", this.admin.address)).to.be.reverted;
    });

    it("cannot set rewarder for non-erc20 pools", async function () {
      // Pool type 0 (non-existent pool).
      await expect(this.chef.setRewarder("1", this.admin.address)).to.be.revertedWith("InvalidType");

      // Pool type 2 (relayer pool).
      expect(await this.chef.initializePool(this.admin.address, "2")).to.emit(this.chef, "PoolInitialized");
      await expect(this.chef.setRewarder("1", this.admin.address)).to.be.revertedWith("InvalidType");
    });
  });

  //////////////////////////////
  //     setPeriodDuration
  //////////////////////////////
  describe("setPeriodDuration", function () {
    it("change period duration", async function () {
      // Before distribution.
      let newPeriodDuration = "100000";
      expect(await this.chef.setPeriodDuration(newPeriodDuration)).to.emit(this.chef, "PeriodDurationUpdated");
      expect(await this.chef.periodDuration()).to.equal(newPeriodDuration);

      expect(await this.chef.addReward(ethers.utils.parseEther("1000000"))).to.emit(this.chef, "RewardAdded")
      await ethers.provider.send("evm_increaseTime", [Number(newPeriodDuration)]);

      // After distribution.
      newPeriodDuration = "200000";
      expect(await this.chef.setPeriodDuration(newPeriodDuration)).to.emit(this.chef, "PeriodDurationUpdated");
      expect(await this.chef.periodDuration()).to.equal(newPeriodDuration);
    });

    it("unauthorized cannot change period duration", async function () {
      await expect(this.alt_chef.setPeriodDuration("100000")).to.be.reverted;
    });

    it("cannot change period duration during ongoing period", async function () {
      expect(await this.chef.addReward(ethers.utils.parseEther("1000000"))).to.emit(this.chef, "RewardAdded")
      await expect(this.chef.setPeriodDuration("100000")).to.be.revertedWith("TooEarly");
    });

    it("cannot change period duration below min limit", async function () {
      await expect(this.chef.setPeriodDuration("65536")).to.be.revertedWith("OutOfBounds");
    });

    it("cannot change period duration above max limit", async function () {
      await expect(this.chef.setPeriodDuration("4294967296")).to.be.revertedWith("OutOfBounds");
    });

  });

  //////////////////////////////
  //     endPeriod
  //////////////////////////////
  describe("endPeriod", function () {
    it("end period", async function () {
      expect(await this.chef.addReward(ethers.utils.parseEther("1000000"))).to.emit(this.chef, "RewardAdded")
      expect(await this.chef.endPeriod()).to.emit(this.chef, "PeriodEnded");

      expect(await this.chef.addReward(ethers.utils.parseEther("1000000"))).to.emit(this.chef, "RewardAdded")
      await ethers.provider.send("evm_increaseTime", [3600]);
      expect(await this.chef.endPeriod()).to.emit(this.chef, "PeriodEnded");
    });

    it("unauthorized cannot end period", async function () {
      await expect(this.alt_chef.endPeriod()).to.be.reverted;
    });

    it("cannot end period before or after period", async function () {
      await expect(this.chef.endPeriod()).to.be.revertedWith("TooLate");

      expect(await this.chef.addReward(ethers.utils.parseEther("1000000"))).to.emit(this.chef, "RewardAdded")
      await ethers.provider.send("evm_increaseTime", [86400]);

      await expect(this.chef.endPeriod()).to.be.revertedWith("TooLate");
    });

  });

});
