// test/AllocationVester.js
// Load dependencies
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { BigNumber } = require("ethers");
const chance = require("chance").Chance();

const ZERO_ADDRESS = ethers.constants.AddressZero;

const ONE_DAY = BigNumber.from("86400");
//const PRECISION = ONE_DAY.mul("365").mul("10000");
const EIGHT_WEEKS = 4838400;
const TWO_YEARS = 63115200;

const TOTAL_SUPPLY = ethers.utils.parseUnits("230000000", 18);

function generateRecipients(recipientsLength) {
  let recipients = [];
  let allocations = [];
  let durations = [];

  for (let i = 0; i < recipientsLength; i++) {
    let alloc = chance.integer({ min: 1000, max: 1000000 });

    recipients.push(ethers.Wallet.createRandom().address);
    allocations.push(ethers.utils.parseUnits(alloc.toString()));
    durations.push(chance.integer({ min: EIGHT_WEEKS, max: TWO_YEARS }));
  }

  return [recipients, allocations, durations];
}

function arraySum(arr) {
  let sum = BigNumber.from("0");
  for (const value of arr) {
    sum = sum.add(value);
  }
  return sum;
}

// Start test block
describe("AllocationVester.sol", function () {
  before(async function () {
    // get signers
    [this.admin, this.unauthorized] = await ethers.getSigners();

    // get contract factories
    this.Png = await ethers.getContractFactory("Png");
    this.Vester = await ethers.getContractFactory("AllocationVester");
  });

  beforeEach(async function () {
    // deploy PNG and send TOTAL_SUPPLY to admin
    this.png = await this.Png.deploy(
      TOTAL_SUPPLY,
      TOTAL_SUPPLY,
      "PNG",
      "Pangolin"
    );
    await this.png.deployed();

    // deploy vesting contract
    this.vester = await this.Vester.deploy(this.png.address);
    await this.vester.deployed();
  });

  // Test cases

  //////////////////////////////
  //     Constructor
  //////////////////////////////
  describe("Constructor", function () {
    it("arg 1: distributionToken", async function () {
      expect(await this.vester.token()).to.equal(this.png.address);
    });
  });

  //////////////////////////////
  //     setAllocations
  //////////////////////////////
  describe("setAllocations", function () {
    it("revert: insufficient png balance for allocation", async function () {
      var [members, allocations, durations] = generateRecipients(1);
      var totalAlloc = arraySum(allocations);

      expect(
        await this.png.transfer(this.vester.address, totalAlloc.sub("1"))
      ).to.emit(this.png, "Transfer");
      await expect(
        this.vester.setAllocations(members, allocations, durations)
      ).to.be.revertedWith("low balance");
    });

    it("revert: recipient is zero address", async function () {
      var [members, allocations, durations] = generateRecipients(1);

      members[0] = ZERO_ADDRESS;

      expect(await this.png.transfer(this.vester.address, TOTAL_SUPPLY)).to.emit(
        this.png,
        "Transfer"
      );
      await expect(
        this.vester.setAllocations(members, allocations, durations)
      ).to.be.revertedWith("bad recipient");
    });

    it("revert: vesting duration is less than eight weeks", async function () {
      var [members, allocations, durations] = generateRecipients(1);

      durations[0] = 4838399;

      expect(await this.png.transfer(this.vester.address, TOTAL_SUPPLY)).to.emit(
        this.png,
        "Transfer"
      );
      await expect(
        this.vester.setAllocations(members, allocations, durations)
      ).to.be.revertedWith("short vesting duration");
    });

    it("revert: zero recipients", async function () {
      await expect(this.vester.setAllocations([], [], [])).to.be.revertedWith(
        "empty array"
      );
    });

    it("revert: unauthorized", async function () {
      var [members, allocations, durations] = generateRecipients(1);

      expect(await this.png.transfer(this.vester.address, TOTAL_SUPPLY)).to.emit(
        this.png,
        "Transfer"
      );
      const vester = await this.vester.connect(this.unauthorized);
      await expect(
        vester.setAllocations(members, allocations, durations)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("revert: varying-length array arguments - 1", async function () {
      var [members, allocations, durations] = generateRecipients(1);

      durations.pop();

      await expect(
        this.vester.setAllocations(members, allocations, durations)
      ).to.be.revertedWith("varying-length arrays");
    });

    it("revert: varying-length array arguments - 2", async function () {
      var [members, allocations, durations] = generateRecipients(1);

      allocations.pop();

      await expect(
        this.vester.setAllocations(members, allocations, durations)
      ).to.be.revertedWith("varying-length arrays");
    });

    it("revert: low balance when adding new members", async function () {
      var [members, allocations, durations] = generateRecipients(10);
      var totalAlloc = arraySum(allocations);

      expect(await this.png.transfer(this.vester.address, totalAlloc)).to.emit(
        this.png,
        "Transfer"
      );
      expect(
        await this.vester.setAllocations(members, allocations, durations)
      ).to.emit(this.vester, "AllocationSet");

      [members, allocations, durations] = generateRecipients(10);
      totalAlloc = arraySum(allocations);

      expect(
        await this.png.transfer(this.vester.address, totalAlloc.sub("1"))
      ).to.emit(this.png, "Transfer");
      await expect(
        this.vester.setAllocations(members, allocations, durations)
      ).to.be.revertedWith("low balance");
    });

    it("success: one recipient", async function () {
      var [members, allocations, durations] = generateRecipients(1);
      var totalAlloc = arraySum(allocations);

      expect(await this.png.transfer(this.vester.address, totalAlloc)).to.emit(
        this.png,
        "Transfer"
      );
      expect(
        await this.vester.setAllocations(members, allocations, durations)
      ).to.emit(this.vester, "AllocationSet");
    });

    it("success: forty recipients", async function () {
      var [members, allocations, durations] = generateRecipients(40);
      var totalAlloc = arraySum(allocations);

      expect(await this.png.transfer(this.vester.address, totalAlloc)).to.emit(
        this.png,
        "Transfer"
      );
      expect(
        await this.vester.setAllocations(members, allocations, durations)
      ).to.emit(this.vester, "AllocationSet");
    });

    it("success: change previous allocations", async function () {
      expect(await this.png.transfer(this.vester.address, TOTAL_SUPPLY)).to.emit(
        this.png,
        "Transfer"
      );

      var [members, allocations, durations] = generateRecipients(10);
      expect(
        await this.vester.setAllocations(members, allocations, durations)
      ).to.emit(this.vester, "AllocationSet");

      [, allocations, durations] = generateRecipients(10);
      expect(
        await this.vester.setAllocations(members, allocations, durations)
      ).to.emit(this.vester, "AllocationSet");
    });

    it("success: add new members after initial members", async function () {
      var [members, allocations, durations] = generateRecipients(10);
      var totalAlloc = arraySum(allocations);

      expect(await this.png.transfer(this.vester.address, totalAlloc)).to.emit(
        this.png,
        "Transfer"
      );
      expect(
        await this.vester.setAllocations(members, allocations, durations)
      ).to.emit(this.vester, "AllocationSet");

      [members, allocations, durations] = generateRecipients(10);
      totalAlloc = arraySum(allocations);

      expect(await this.png.transfer(this.vester.address, totalAlloc)).to.emit(
        this.png,
        "Transfer"
      );
      expect(
        await this.vester.setAllocations(members, allocations, durations)
      ).to.emit(this.vester, "AllocationSet");
    });

    it("success: remove previous allocations", async function () {
      expect(await this.png.transfer(this.vester.address, TOTAL_SUPPLY)).to.emit(
        this.png,
        "Transfer"
      );

      var [members, allocations, durations] = generateRecipients(10);
      expect(
        await this.vester.setAllocations(members, allocations, durations)
      ).to.emit(this.vester, "AllocationSet");

      for (let i = 0; i < 10; i++) allocations[i] = BigNumber.from("0");
      expect(
        await this.vester.setAllocations(members, allocations, durations)
      ).to.emit(this.vester, "AllocationSet");
    });
  });

  //////////////////////////////
  //     withdraw
  //////////////////////////////
  describe("withdraw", function () {
    it("revert: insufficient png balance", async function () {
      var [members, allocations, durations] = generateRecipients(1);
      var totalAlloc = arraySum(allocations);

      expect(await this.png.transfer(this.vester.address, totalAlloc)).to.emit(
        this.png,
        "Transfer"
      );
      expect(
        await this.vester.setAllocations(members, allocations, durations)
      ).to.emit(this.vester, "AllocationSet");
      await expect(this.vester.withdraw("1")).to.be.revertedWith("low balance");
    });
    it("revert: unauthorized", async function () {
      expect(await this.png.transfer(this.vester.address, TOTAL_SUPPLY)).to.emit(
        this.png,
        "Transfer"
      );
      const vester = await this.vester.connect(this.unauthorized);
      await expect(vester.withdraw(TOTAL_SUPPLY)).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });
    it("success: sufficient balance", async function () {
      var [members, allocations, durations] = generateRecipients(1);
      var totalAlloc = arraySum(allocations);

      expect(
        await this.png.transfer(this.vester.address, totalAlloc.add("1"))
      ).to.emit(this.png, "Transfer");
      expect(
        await this.vester.setAllocations(members, allocations, durations)
      ).to.emit(this.vester, "AllocationSet");
      expect(await this.vester.withdraw("1")).to.emit(this.png, "Transfer");
    });
  });

  //////////////////////////////
  //     harvest
  //////////////////////////////
  describe("harvest", function () {
    it("revert: nothing to harvest", async function () {
      await expect(this.vester.harvest()).to.be.revertedWith(
        "no pending harvest"
      );
    });
    it("success: has allocation", async function () {
      var [, allocations, durations] = generateRecipients(1);

      expect(await this.png.transfer(this.vester.address, TOTAL_SUPPLY)).to.emit(
        this.png,
        "Transfer"
      );
      expect(
        await this.vester.setAllocations(
          [this.admin.address],
          allocations,
          durations
        )
      ).to.emit(this.vester, "AllocationSet");
      expect(await this.vester.harvest()).to.emit(
        this.png,
        "Transfer"
      );
    });
  });

  //////////////////////////////
  //     reserve
  //////////////////////////////
  describe("reserve", function () {
    it("expect: nothing is reserved at first", async function () {
      expect(await this.vester.reserve()).to.equal("0");
    });
  });

  //////////////////////////////
  //     members
  //////////////////////////////
  describe("members", function () {
    it("expect: updates on first allocation", async function () {
      var [members, allocations, durations] = generateRecipients(1);

      expect(await this.png.transfer(this.vester.address, allocations[0])).to.emit(
        this.png,
        "Transfer"
      );
      expect(
        await this.vester.setAllocations(members, allocations, durations)
      ).to.emit(this.vester, "AllocationSet");

      var blockNumber = await ethers.provider.getBlockNumber();
      var blockTime = (await ethers.provider.getBlock(blockNumber)).timestamp;

      var member = await this.vester.members(members[0]);

      expect(member.lastUpdate).to.equal(blockTime);
      expect(member.reserve).to.equal(allocations[0]);
      expect(member.rate).to.equal(allocations[0].div(durations[0]));

    });
  });

  //////////////////////////////
  //     getMembers
  //////////////////////////////
  describe("getMembers", function () {
    it("expect: no members", async function () {
      var members = await this.vester.getMembers();
      expect(members.length).to.equal(0);
    });

    it("expect: one member", async function () {
      var [members, allocations, durations] = generateRecipients(1);

      expect(await this.png.transfer(this.vester.address, TOTAL_SUPPLY)).to.emit(
        this.png,
        "Transfer"
      );
      expect(
        await this.vester.setAllocations(members, allocations, durations)
      ).to.emit(this.vester, "AllocationSet");

      var actualMembers = await this.vester.getMembers();
      expect(actualMembers.length).to.equal(members.length);
      expect(actualMembers[0]).to.equal(members[0]);
    });

    it("expect: forty members", async function () {
      var [members, allocations, durations] = generateRecipients(40);

      expect(await this.png.transfer(this.vester.address, TOTAL_SUPPLY)).to.emit(
        this.png,
        "Transfer"
      );
      expect(
        await this.vester.setAllocations(members, allocations, durations)
      ).to.emit(this.vester, "AllocationSet");

      var actualMembers = await this.vester.getMembers();
      expect(actualMembers.length).to.equal(members.length);
      for (let i; i < 40; i++) expect(actualMembers[i]).to.equal(members[i]);
    });

    it("expect: change in previous allocations", async function () {
      expect(await this.png.transfer(this.vester.address, TOTAL_SUPPLY)).to.emit(
        this.png,
        "Transfer"
      );

      var [members, allocations, durations] = generateRecipients(10);
      expect(
        await this.vester.setAllocations(members, allocations, durations)
      ).to.emit(this.vester, "AllocationSet");

      var actualMembers = await this.vester.getMembers();
      expect(actualMembers.length).to.equal(members.length);
      for (let i; i < 10; i++) expect(actualMembers[i]).to.equal(members[i]);

      [, allocations, durations] = generateRecipients(10);
      expect(
        await this.vester.setAllocations(members, allocations, durations)
      ).to.emit(this.vester, "AllocationSet");

      actualMembers = await this.vester.getMembers();
      expect(actualMembers.length).to.equal(members.length);
      for (let i; i < 10; i++) expect(actualMembers[i]).to.equal(members[i]);
    });

    it("expect: remove member after all harvested", async function () {
      expect(await this.png.transfer(this.vester.address, TOTAL_SUPPLY)).to.emit(
        this.png,
        "Transfer"
      );
      expect(
        await this.vester.setAllocations(
          [this.admin.address],
          [TOTAL_SUPPLY],
          [TWO_YEARS]
        )
      ).to.emit(this.vester, "AllocationSet");
      await network.provider.send("evm_increaseTime", [TWO_YEARS+1]);
      expect(await this.vester.harvest()).to.emit(
        this.png,
        "Transfer"
      );
      var actualMembers = await this.vester.getMembers();
      expect(actualMembers.length).to.equal(0);
    });

    it("expect: increase members after addition", async function () {
      var [members, allocations, durations] = generateRecipients(10);
      var totalAlloc = arraySum(allocations);

      expect(await this.png.transfer(this.vester.address, totalAlloc)).to.emit(
        this.png,
        "Transfer"
      );
      expect(
        await this.vester.setAllocations(members, allocations, durations)
      ).to.emit(this.vester, "AllocationSet");

      var actualMembers = await this.vester.getMembers();
      expect(actualMembers.length).to.equal(members.length);
      for (let i; i < 10; i++) expect(actualMembers[i]).to.equal(members[i]);

      var newMembers;
      [newMembers, allocations, durations] = generateRecipients(10);
      members = members.concat(newMembers);
      totalAlloc = arraySum(allocations);

      expect(await this.png.transfer(this.vester.address, totalAlloc)).to.emit(
        this.png,
        "Transfer"
      );
      expect(
        await this.vester.setAllocations(newMembers, allocations, durations)
      ).to.emit(this.vester, "AllocationSet");

      actualMembers = await this.vester.getMembers();
      expect(actualMembers.length).to.equal(members.length);
      for (let i; i < 10; i++) expect(actualMembers[i]).to.equal(members[i]);
    });
  });
});
