// test/TeamAllocationVester.js
// Load dependencies
const { expect } = require("chai");
const { ethers } = require("hardhat");
const { BigNumber } = require("ethers");
const chance = require("chance").Chance();

const ZERO_ADDRESS = ethers.constants.AddressZero;

const ONE_DAY = BigNumber.from("86400");
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
  for (let i = 0; i < arr.length; i++) {
    sum = sum.add(arr[i]);
  }
  return sum;
}

// Start test block
describe("TeamAllocationVester.sol", function () {
  before(async function () {
    // get signers
    [this.admin, this.unauthorized] = await ethers.getSigners();

    // get contract factories
    this.Png = await ethers.getContractFactory("Png");
    this.Team = await ethers.getContractFactory("TeamAllocationVester");
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
    this.team = await this.Team.deploy(this.png.address);
    await this.team.deployed();
  });

  // Test cases

  //////////////////////////////
  //     Constructor
  //////////////////////////////
  describe("Constructor", function () {
    it("arg 1: allocationToken", async function () {
      expect(await this.team.png()).to.equal(this.png.address);
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
        await this.png.transfer(this.team.address, totalAlloc.sub("1"))
      ).to.emit(this.png, "Transfer");
      await expect(
        this.team.setAllocations(members, allocations, durations)
      ).to.be.revertedWith("low balance");
    });

    it("revert: recipient is zero address", async function () {
      var [members, allocations, durations] = generateRecipients(1);

      members[0] = ZERO_ADDRESS;

      expect(await this.png.transfer(this.team.address, TOTAL_SUPPLY)).to.emit(
        this.png,
        "Transfer"
      );
      await expect(
        this.team.setAllocations(members, allocations, durations)
      ).to.be.revertedWith("bad recipient");
    });

    it("revert: vesting duration is less than eight weeks", async function () {
      var [members, allocations, durations] = generateRecipients(1);

      durations[0] = 4838399;

      expect(await this.png.transfer(this.team.address, TOTAL_SUPPLY)).to.emit(
        this.png,
        "Transfer"
      );
      await expect(
        this.team.setAllocations(members, allocations, durations)
      ).to.be.revertedWith("short vesting duration");
    });

    it("revert: zero recipients", async function () {
      await expect(this.team.setAllocations([], [], [])).to.be.revertedWith(
        "empty array"
      );
    });

    it("revert: unauthorized", async function () {
      var [members, allocations, durations] = generateRecipients(1);

      expect(await this.png.transfer(this.team.address, TOTAL_SUPPLY)).to.emit(
        this.png,
        "Transfer"
      );
      team = await this.team.connect(this.unauthorized);
      await expect(
        team.setAllocations(members, allocations, durations)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("revert: varying-length array arguments - 1", async function () {
      var [members, allocations, durations] = generateRecipients(1);

      durations.pop();

      await expect(
        this.team.setAllocations(members, allocations, durations)
      ).to.be.revertedWith("varying-length arrays");
    });

    it("revert: varying-length array arguments - 2", async function () {
      var [members, allocations, durations] = generateRecipients(1);

      allocations.pop();

      await expect(
        this.team.setAllocations(members, allocations, durations)
      ).to.be.revertedWith("varying-length arrays");
    });

    it("revert: low balance when adding new members", async function () {
      var [members, allocations, durations] = generateRecipients(10);
      var totalAlloc = arraySum(allocations);

      expect(await this.png.transfer(this.team.address, totalAlloc)).to.emit(
        this.png,
        "Transfer"
      );
      expect(
        await this.team.setAllocations(members, allocations, durations)
      ).to.emit(this.team, "MembersChanged");

      [members, allocations, durations] = generateRecipients(10);
      totalAlloc = arraySum(allocations);

      expect(
        await this.png.transfer(this.team.address, totalAlloc.sub("1"))
      ).to.emit(this.png, "Transfer");
      await expect(
        this.team.setAllocations(members, allocations, durations)
      ).to.be.revertedWith("low balance");
    });

    it("success: one recipient", async function () {
      var [members, allocations, durations] = generateRecipients(1);
      var totalAlloc = arraySum(allocations);

      expect(await this.png.transfer(this.team.address, totalAlloc)).to.emit(
        this.png,
        "Transfer"
      );
      expect(
        await this.team.setAllocations(members, allocations, durations)
      ).to.emit(this.team, "MembersChanged");
    });

    it("success: forty recipients", async function () {
      var [members, allocations, durations] = generateRecipients(40);
      var totalAlloc = arraySum(allocations);

      expect(await this.png.transfer(this.team.address, totalAlloc)).to.emit(
        this.png,
        "Transfer"
      );
      expect(
        await this.team.setAllocations(members, allocations, durations)
      ).to.emit(this.team, "MembersChanged");
    });

    it("success: change previous allocations", async function () {
      expect(await this.png.transfer(this.team.address, TOTAL_SUPPLY)).to.emit(
        this.png,
        "Transfer"
      );

      var [members, allocations, durations] = generateRecipients(10);
      expect(
        await this.team.setAllocations(members, allocations, durations)
      ).to.emit(this.team, "MembersChanged");

      [, allocations, durations] = generateRecipients(10);
      expect(
        await this.team.setAllocations(members, allocations, durations)
      ).to.emit(this.team, "MembersChanged");
    });

    it("success: add new members after initial members", async function () {
      var [members, allocations, durations] = generateRecipients(10);
      var totalAlloc = arraySum(allocations);

      expect(await this.png.transfer(this.team.address, totalAlloc)).to.emit(
        this.png,
        "Transfer"
      );
      expect(
        await this.team.setAllocations(members, allocations, durations)
      ).to.emit(this.team, "MembersChanged");

      [members, allocations, durations] = generateRecipients(10);
      totalAlloc = arraySum(allocations);

      expect(await this.png.transfer(this.team.address, totalAlloc)).to.emit(
        this.png,
        "Transfer"
      );
      expect(
        await this.team.setAllocations(members, allocations, durations)
      ).to.emit(this.team, "MembersChanged");
    });

    it("success: remove previous allocations", async function () {
      expect(await this.png.transfer(this.team.address, TOTAL_SUPPLY)).to.emit(
        this.png,
        "Transfer"
      );

      var [members, allocations, durations] = generateRecipients(10);
      expect(
        await this.team.setAllocations(members, allocations, durations)
      ).to.emit(this.team, "MembersChanged");

      for (let i = 0; i < 10; i++) allocations[i] = BigNumber.from("0");
      expect(
        await this.team.setAllocations(members, allocations, durations)
      ).to.emit(this.team, "MembersChanged");
    });
  });

  //////////////////////////////
  //     withdraw
  //////////////////////////////
  describe("withdraw", function () {
    it("revert: insufficient png balance", async function () {
      var [members, allocations, durations] = generateRecipients(1);
      var totalAlloc = arraySum(allocations);

      expect(await this.png.transfer(this.team.address, totalAlloc)).to.emit(
        this.png,
        "Transfer"
      );
      expect(
        await this.team.setAllocations(members, allocations, durations)
      ).to.emit(this.team, "MembersChanged");
      await expect(this.team.withdraw("1")).to.be.revertedWith("low balance");
    });
    it("revert: unauthorized", async function () {
      expect(await this.png.transfer(this.team.address, TOTAL_SUPPLY)).to.emit(
        this.png,
        "Transfer"
      );
      team = await this.team.connect(this.unauthorized);
      await expect(team.withdraw(TOTAL_SUPPLY)).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });
    it("success: sufficient balance", async function () {
      var [members, allocations, durations] = generateRecipients(1);
      var totalAlloc = arraySum(allocations);

      expect(
        await this.png.transfer(this.team.address, totalAlloc.add("1"))
      ).to.emit(this.png, "Transfer");
      expect(
        await this.team.setAllocations(members, allocations, durations)
      ).to.emit(this.team, "MembersChanged");
      expect(await this.team.withdraw("1")).to.emit(this.png, "Transfer");
    });
  });

  //////////////////////////////
  //     harvest
  //////////////////////////////
  describe("harvest", function () {
    it("revert: nothing to harvest", async function () {
      await expect(this.team.harvest()).to.be.revertedWith(
        "no pending harvest"
      );
    });
    it("success: has allocation", async function () {
      var [, allocations, durations] = generateRecipients(1);

      expect(await this.png.transfer(this.team.address, TOTAL_SUPPLY)).to.emit(
        this.png,
        "Transfer"
      );
      expect(
        await this.team.setAllocations(
          [this.admin.address],
          allocations,
          durations
        )
      ).to.emit(this.team, "MembersChanged");
      expect(await this.team.harvest()).to.emit(
        this.png,
        "Transfer"
      );
    });
  });

  //////////////////////////////
  //     reserved
  //////////////////////////////
  describe("reserved", function () {
    it("expect: nothing is reserved at first", async function () {
      expect(await this.team.reserved()).to.equal("0");
    });
  });

  //////////////////////////////
  //     members
  //////////////////////////////
  describe("members", function () {
    it("expect: updates on first allocation", async function () {
      var [members, allocations, durations] = generateRecipients(1);

      expect(await this.png.transfer(this.team.address, allocations[0])).to.emit(
        this.png,
        "Transfer"
      );
      expect(
        await this.team.setAllocations(members, allocations, durations)
      ).to.emit(this.team, "MembersChanged");

      var blockNumber = await ethers.provider.getBlockNumber();
      var blockTime = (await ethers.provider.getBlock(blockNumber)).timestamp;

      member = await this.team.members(members[0]);

      expect(member.lastUpdate).to.equal(blockTime);
      expect(member.reserved).to.equal(allocations[0]);
      expect(member.rate).to.equal(allocations[0].div(durations[0]));

    });

    it.skip("expect: updates after harvest", async function () {
      var [members, allocations, durations] = generateRecipients(1);

      expect(await this.png.transfer(this.team.address, allocations[0])).to.emit(
        this.png,
        "Transfer"
      );
      expect(
        await this.team.setAllocations(members, allocations, durations)
      ).to.emit(this.team, "MembersChanged");

      var blockNumber = await ethers.provider.getBlockNumber();
      var blockTime = (await ethers.provider.getBlock(blockNumber)).timestamp;

      member = await this.team.members(members[0]);

      expect(member.lastUpdate).to.equal(blockTime);
      expect(member.reserved).to.equal(allocations[0]);
      expect(member.rate).to.equal(allocations[0].div(durations[0]));

    });
  });

  //////////////////////////////
  //     getMembers
  //////////////////////////////
  describe("getMembers", function () {
    it("expect: no members", async function () {
      var members = await this.team.getMembers();
      expect(members.length).to.equal(0);
    });

    it("expect: one member", async function () {
      var [members, allocations, durations] = generateRecipients(1);

      expect(await this.png.transfer(this.team.address, TOTAL_SUPPLY)).to.emit(
        this.png,
        "Transfer"
      );
      expect(
        await this.team.setAllocations(members, allocations, durations)
      ).to.emit(this.team, "MembersChanged");

      var actualMembers = await this.team.getMembers();
      expect(actualMembers.length).to.equal(members.length);
      expect(actualMembers[0]).to.equal(members[0]);
    });

    it("expect: forty members", async function () {
      var [members, allocations, durations] = generateRecipients(40);

      expect(await this.png.transfer(this.team.address, TOTAL_SUPPLY)).to.emit(
        this.png,
        "Transfer"
      );
      expect(
        await this.team.setAllocations(members, allocations, durations)
      ).to.emit(this.team, "MembersChanged");

      var actualMembers = await this.team.getMembers();
      expect(actualMembers.length).to.equal(members.length);
      for (let i; i < 40; i++) expect(actualMembers[i]).to.equal(members[i]);
    });

    it("expect: change in previous allocations", async function () {
      expect(await this.png.transfer(this.team.address, TOTAL_SUPPLY)).to.emit(
        this.png,
        "Transfer"
      );

      var [members, allocations, durations] = generateRecipients(10);
      expect(
        await this.team.setAllocations(members, allocations, durations)
      ).to.emit(this.team, "MembersChanged");

      var actualMembers = await this.team.getMembers();
      expect(actualMembers.length).to.equal(members.length);
      for (let i; i < 10; i++) expect(actualMembers[i]).to.equal(members[i]);

      [, allocations, durations] = generateRecipients(10);
      expect(
        await this.team.setAllocations(members, allocations, durations)
      ).to.emit(this.team, "MembersChanged");

      actualMembers = await this.team.getMembers();
      expect(actualMembers.length).to.equal(members.length);
      for (let i; i < 10; i++) expect(actualMembers[i]).to.equal(members[i]);
    });

    it("expect: increase members after addition", async function () {
      var [members, allocations, durations] = generateRecipients(10);
      var totalAlloc = arraySum(allocations);

      expect(await this.png.transfer(this.team.address, totalAlloc)).to.emit(
        this.png,
        "Transfer"
      );
      expect(
        await this.team.setAllocations(members, allocations, durations)
      ).to.emit(this.team, "MembersChanged");

      var actualMembers = await this.team.getMembers();
      expect(actualMembers.length).to.equal(members.length);
      for (let i; i < 10; i++) expect(actualMembers[i]).to.equal(members[i]);

      [newMembers, allocations, durations] = generateRecipients(10);
      members = members.concat(newMembers);
      totalAlloc = arraySum(allocations);

      expect(await this.png.transfer(this.team.address, totalAlloc)).to.emit(
        this.png,
        "Transfer"
      );
      expect(
        await this.team.setAllocations(newMembers, allocations, durations)
      ).to.emit(this.team, "MembersChanged");

      var actualMembers = await this.team.getMembers();
      expect(actualMembers.length).to.equal(members.length);
      for (let i; i < 10; i++) expect(actualMembers[i]).to.equal(members[i]);
    });
  });
});
