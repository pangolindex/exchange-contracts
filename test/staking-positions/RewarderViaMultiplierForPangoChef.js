// Load dependencies
const { expect } = require("chai");
const { ethers, network } = require("hardhat");

const PNG_SUPPLY = ethers.utils.parseUnits("500000000", 18);
const ZERO_ADDRESS = ethers.constants.AddressZero;

// Start test block
describe("RewarderViaMultiplierForPangoChef.sol", function () {
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

    // Create ANOTHER_TOKEN-WAVAX pair.
    await this.factory.createPair(this.another_token.address, this.wavax.address);
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

    // Mint main PGL
    await this.wavax.deposit({value: ethers.utils.parseEther("1000000000000")});
    await this.png.transfer(this.pgl.address, ethers.utils.parseEther("1000000"));
    await this.wavax.transfer(this.pgl.address, ethers.utils.parseEther("50000"));
    await this.pgl.mint(this.admin.address);

    // Mint second PGL
    await this.another_token.transfer(this.another_pgl.address, ethers.utils.parseEther("1000000"));
    await this.wavax.transfer(this.another_pgl.address, ethers.utils.parseEther("50000"));
    await this.another_pgl.mint(this.admin.address);

    // Get token amounts per address.
    this.pgl_amount = (await this.pgl.balanceOf(this.admin.address)).div("2");
    this.png_amount = PNG_SUPPLY.div("2");

    // Transfer tokens to the second user.
    this.pgl.transfer(this.unauthorized.address, this.pgl_amount);
    this.another_pgl.transfer(this.unauthorized.address, this.pgl_amount);
    this.png.transfer(this.unauthorized.address, this.png_amount);
    this.another_token.transfer(this.unauthorized.address, this.png_amount);

    // Initialize second pool, and add weight.
    expect(await this.chef.initializePool(this.pgl.address, "1")).to.emit(this.chef, "PoolInitialized");
    expect(await this.chef.initializePool(this.pgl.address, "1")).to.emit(this.chef, "PoolInitialized");
    expect(await this.chef.initializePool(this.another_pgl.address, "1")).to.emit(this.chef, "PoolInitialized");
    expect(await this.chef.setWeights(["0", "1", "2", "3"], ["500", "500", "500", "500"])).to.emit(this.chef, "WeightSet");
    expect(await this.chef.addReward(ethers.utils.parseEther("10000"))).to.emit(this.chef, "RewardAdded")

    this.amount = this.pgl_amount.div("10");
    this.pool0Rewarder = await this.Rewarder.deploy([ this.another_token.address ], [ ethers.utils.parseEther("1") ], '18', this.chef.address);
    await this.pool0Rewarder.deployed();
    await this.another_token.transfer(this.pool0Rewarder.address, this.amount);

    this.pool1Rewarder = await this.Rewarder.deploy([ this.another_token.address ], [ ethers.utils.parseEther("1") ], '18', this.chef.address);
    await this.pool1Rewarder.deployed();
    await this.another_token.transfer(this.pool1Rewarder.address, this.amount);

    this.pool2Rewarder = await this.Rewarder.deploy([ this.another_token.address ], [ ethers.utils.parseEther("1") ], '18', this.chef.address);
    await this.pool2Rewarder.deployed();
    await this.another_token.transfer(this.pool2Rewarder.address, this.amount);

    this.pool3Rewarder = await this.Rewarder.deploy([ this.another_token.address ], [ ethers.utils.parseEther("1") ], '18', this.chef.address);
    await this.pool3Rewarder.deployed();
    await this.another_token.transfer(this.pool3Rewarder.address, this.amount);

    // have stake in pool0 initially
    expect(await this.chef.stake("0", this.amount)).to.emit(this.chef, "Staked");
    expect(await this.chef.stake("1", this.amount)).to.emit(this.chef, "Staked");
    // allow rewards to accumulate then add rewarder
    await network.provider.send("evm_increaseTime", [1000]);
    await this.chef.setRewarder(0, this.pool0Rewarder.address);
    await this.chef.setRewarder(1, this.pool1Rewarder.address);
    await this.chef.setRewarder(2, this.pool2Rewarder.address);
    await this.chef.setRewarder(3, this.pool3Rewarder.address);
    await network.provider.send("evm_increaseTime", [1000]);
    // have stake in pool2 after the rewarders are set
    expect(await this.chef.stake("2", this.amount)).to.emit(this.chef, "Staked");
    expect(await this.chef.stake("3", this.amount)).to.emit(this.chef, "Staked");
  });

  // Test cases

  it("staking does not give out secondary rewards in any circumstance", async function () {
    const initialBalance = await this.another_token.balanceOf(this.admin.address);

    expect(await this.chef.stake("1", this.amount)).to.emit(this.chef, "Staked");
    await network.provider.send("evm_increaseTime", [1000]);
    expect(await this.chef.stake("1", this.amount)).to.emit(this.chef, "Staked");

    expect(await this.chef.stake("2", this.amount)).to.emit(this.chef, "Staked");
    await network.provider.send("evm_increaseTime", [1000]);
    expect(await this.chef.stake("2", this.amount)).to.emit(this.chef, "Staked");

    const finalBalance = await this.another_token.balanceOf(this.admin.address);

    expect(initialBalance).to.equal(finalBalance);
  });

  it("compound does not give out secondary rewards in any circumstance", async function () {
    const initialBalance = await this.another_token.balanceOf(this.admin.address);

    expect(await this.chef.compound("1", { minPairAmount: "0", maxPairAmount: this.amount }, { value: this.amount } )).to.emit(this.chef, "Staked");
    await network.provider.send("evm_increaseTime", [1000]);
    expect(await this.chef.compound("1", { minPairAmount: "0", maxPairAmount: this.amount }, { value: this.amount } )).to.emit(this.chef, "Staked");

    expect(await this.chef.compound("2", { minPairAmount: "0", maxPairAmount: this.amount }, { value: this.amount } )).to.emit(this.chef, "Staked");
    await network.provider.send("evm_increaseTime", [1000]);
    expect(await this.chef.compound("2", { minPairAmount: "0", maxPairAmount: this.amount }, { value: this.amount } )).to.emit(this.chef, "Staked");

    const finalBalance = await this.another_token.balanceOf(this.admin.address);

    expect(initialBalance).to.equal(finalBalance);
  });

  it("compoundTo does not give out secondary rewards in any circumstance", async function () {
    const initialBalance = await this.another_token.balanceOf(this.admin.address);

    expect(await this.chef.compoundTo("3", "0", { minPairAmount: "0", maxPairAmount: this.amount }, { value: this.amount } )).to.emit(this.chef, "Staked");
    await network.provider.send("evm_increaseTime", [1000]);
    expect(await this.chef.compoundTo("3", "0", { minPairAmount: "0", maxPairAmount: this.amount }, { value: this.amount } )).to.emit(this.chef, "Staked");

    //expect(await this.chef.compoundTo("2", "0", { minPairAmount: "0", maxPairAmount: this.amount }, { value: this.amount } )).to.emit(this.chef, "Staked");
    //await network.provider.send("evm_increaseTime", [1000]);
    //expect(await this.chef.compoundTo("2", "0", { minPairAmount: "0", maxPairAmount: this.amount }, { value: this.amount } )).to.emit(this.chef, "Staked");

    const finalBalance = await this.another_token.balanceOf(this.admin.address);

    expect(initialBalance).to.equal(finalBalance);
  });

  it("withdraw gives out secondary rewards in all circumstances", async function () {
    let previousBalance = await this.another_token.balanceOf(this.admin.address);
    let balance = previousBalance;

    expect(await this.chef.withdraw("1", this.amount.div('4'))).to.emit(this.chef, "Withdrawn");
    balance = await this.another_token.balanceOf(this.admin.address);
    expect(balance).to.be.above(previousBalance);
    previousBalance = balance;
    await network.provider.send("evm_increaseTime", [1000]);
    expect(await this.chef.withdraw("1", this.amount.div('4'))).to.emit(this.chef, "Withdrawn");
    balance = await this.another_token.balanceOf(this.admin.address);
    expect(balance).to.be.above(previousBalance);
    previousBalance = balance;
    await network.provider.send("evm_increaseTime", [1000]);
    expect(await this.chef.withdraw("1", this.amount.div('4'))).to.emit(this.chef, "Withdrawn");
    balance = await this.another_token.balanceOf(this.admin.address);
    expect(balance).to.be.above(previousBalance);
    previousBalance = balance;
    await network.provider.send("evm_increaseTime", [1000]);
    expect(await this.chef.withdraw("1", this.amount.div('4'))).to.emit(this.chef, "Withdrawn");
    balance = await this.another_token.balanceOf(this.admin.address);
    expect(balance).to.be.above(previousBalance);
    previousBalance = balance;

    expect(await this.chef.withdraw("2", this.amount.div('4'))).to.emit(this.chef, "Withdrawn");
    balance = await this.another_token.balanceOf(this.admin.address);
    expect(balance).to.be.above(previousBalance);
    previousBalance = balance;
    await network.provider.send("evm_increaseTime", [1000]);
    expect(await this.chef.withdraw("2", this.amount.div('4'))).to.emit(this.chef, "Withdrawn");
    balance = await this.another_token.balanceOf(this.admin.address);
    expect(balance).to.be.above(previousBalance);
    previousBalance = balance;
    await network.provider.send("evm_increaseTime", [1000]);
    expect(await this.chef.withdraw("2", this.amount.div('4'))).to.emit(this.chef, "Withdrawn");
    balance = await this.another_token.balanceOf(this.admin.address);
    expect(balance).to.be.above(previousBalance);
    previousBalance = balance;
    await network.provider.send("evm_increaseTime", [1000]);
    expect(await this.chef.withdraw("2", this.amount.div('4'))).to.emit(this.chef, "Withdrawn");
    balance = await this.another_token.balanceOf(this.admin.address);
    expect(balance).to.be.above(previousBalance);
  });

  it("withdraw all gives out secondary rewards in all circumstances", async function () {
    let previousBalance = await this.another_token.balanceOf(this.admin.address);
    let balance = previousBalance;

    expect(await this.chef.withdraw("1", this.amount)).to.emit(this.chef, "Withdrawn");
    balance = await this.another_token.balanceOf(this.admin.address);
    expect(balance).to.be.above(previousBalance);
    previousBalance = balance;
    await network.provider.send("evm_increaseTime", [1000]);

    expect(await this.chef.withdraw("2", this.amount)).to.emit(this.chef, "Withdrawn");
    balance = await this.another_token.balanceOf(this.admin.address);
    expect(balance).to.be.above(previousBalance);
  });

  it("harvest gives out secondary rewards in all circumstances", async function () {
    let previousBalance = await this.another_token.balanceOf(this.admin.address);
    let balance = previousBalance;

    expect(await this.chef.harvest("1")).to.emit(this.chef, "Withdrawn");
    balance = await this.another_token.balanceOf(this.admin.address);
    expect(balance).to.be.above(previousBalance);
    previousBalance = balance;
    await network.provider.send("evm_increaseTime", [1000]);
    expect(await this.chef.harvest("1")).to.emit(this.chef, "Withdrawn");
    balance = await this.another_token.balanceOf(this.admin.address);
    expect(balance).to.be.above(previousBalance);
    previousBalance = balance;
    await network.provider.send("evm_increaseTime", [1000]);
    expect(await this.chef.harvest("1")).to.emit(this.chef, "Withdrawn");
    balance = await this.another_token.balanceOf(this.admin.address);
    expect(balance).to.be.above(previousBalance);
    previousBalance = balance;
    await network.provider.send("evm_increaseTime", [1000]);
    expect(await this.chef.harvest("1")).to.emit(this.chef, "Withdrawn");
    balance = await this.another_token.balanceOf(this.admin.address);
    expect(balance).to.be.above(previousBalance);
    previousBalance = balance;

    expect(await this.chef.harvest("1")).to.emit(this.chef, "Withdrawn");
    balance = await this.another_token.balanceOf(this.admin.address);
    expect(balance).to.be.above(previousBalance);
    previousBalance = balance;
    await network.provider.send("evm_increaseTime", [1000]);
    expect(await this.chef.harvest("1")).to.emit(this.chef, "Withdrawn");
    balance = await this.another_token.balanceOf(this.admin.address);
    expect(balance).to.be.above(previousBalance);
    previousBalance = balance;
    await network.provider.send("evm_increaseTime", [1000]);
    expect(await this.chef.harvest("1")).to.emit(this.chef, "Withdrawn");
    balance = await this.another_token.balanceOf(this.admin.address);
    expect(balance).to.be.above(previousBalance);
    previousBalance = balance;
    await network.provider.send("evm_increaseTime", [1000]);
    expect(await this.chef.harvest("1")).to.emit(this.chef, "Withdrawn");
    balance = await this.another_token.balanceOf(this.admin.address);
    expect(balance).to.be.above(previousBalance);
  });

  it("stake before compoundTo does not trick the contract", async function () {
    expect(await this.chef.stake("3", this.amount.div("2"))).to.emit(this.chef, "Staked");
    expect(await this.chef.withdraw("3", this.amount.div("4"))).to.emit(this.chef, "Withdrawn");
    await network.provider.send("evm_increaseTime", [50000]);

    const previousBalance = await this.another_token.balanceOf(this.admin.address);

    expect(await this.chef.stake("3", this.amount.div("4"))).to.emit(this.chef, "Staked");
    expect(await this.chef.compoundTo("3", "0", { minPairAmount: "0", maxPairAmount: this.amount }, { value: this.amount } )).to.emit(this.chef, "Staked");

    const balance = await this.another_token.balanceOf(this.admin.address);
    expect(balance).to.equal(previousBalance);
  });

});
