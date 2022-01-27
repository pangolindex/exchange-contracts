const { expect } = require("chai");
const { ethers } = require("hardhat");
const { BigNumber } = require("ethers");
const chance = require("chance").Chance();

function generateRecipients(recipientsLength) {
  let recipients = [];
  let totalAlloc = 0;
  let denominator = 10000;

  //let recipientsLength = chance.integer({ min: 1, max: 20 });
  for (let i = 0; i < recipientsLength; i++) {
    let account = ethers.Wallet.createRandom();
    let alloc;
    if (i === recipientsLength - 1) {
      alloc = denominator - totalAlloc;
    } else {
      alloc = chance.integer({
        min: 1,
        max: denominator - totalAlloc - (recipientsLength - i - 1)
      });
    }
    totalAlloc += alloc;
    recipients.push(
      {
        account: account.address,
        allocation: alloc
      }
    )
  };

  return recipients;

};


describe("RevenueDistributor.sol", function () {
  before(async function () {
    this.denominator = BigNumber.from("10000");

    // Get addresses that might send transactions
    [ this.admin, this.unprivileged ] = await ethers.getSigners();

    // Deploy WAVAX
    let WAVAX = await ethers.getContractFactory("WAVAX");
    this.wavax = await WAVAX.deploy();
    await this.wavax.deployed();

    // Deploy Dummy ERC20
    let Token = await ethers.getContractFactory("DummyERC20");
    this.token = await Token.deploy(
      "TestERC20",        // name
      "TEST",             // symbol
      this.admin.address, // initialAccount
      0                   // amount
    );
    await this.token.deployed();

  });

  beforeEach(async function () {
    this.recipients = generateRecipients(2);

    // Deploy Distributor
    this.Distributor = await ethers.getContractFactory("RevenueDistributor");
    this.distributor = await this.Distributor.deploy(
      this.admin.address, // admin
      this.recipients
    );
    await this.distributor.deployed();

    this.distributor1 = await this.distributor.connect(this.admin);
    this.distributor2 = await this.distributor.connect(this.unprivileged);

  });

  describe("Access Control", function () {
    it("unpriviledged cannot change admin", async function() {
      let distributor = await this.distributor.connect(this.unprivileged);
      await expect(distributor.setAdmin(this.unprivileged.address))
        .to.be.revertedWith("sender is not admin");

    });

    it("unpriviledged cannot change recipients", async function() {
      let distributor = await this.distributor.connect(this.unprivileged);
      await expect(distributor.setRecipients(
        [{ account: this.unprivileged.address, allocation: this.denominator }]
      )).to.be.revertedWith("sender is not admin");
    });

  });

  describe("Input Sanitization", function () {
    it("cannot set zero recipients", async function () {
      let recipients = generateRecipients(0);
      await expect(this.distributor.setRecipients(recipients))
        .to.be.revertedWith("invalid recipient number");

    });

    it("cannot set more than twenty recipients", async function () {
      let recipients = generateRecipients(21);
      await expect(this.distributor.setRecipients(recipients))
        .to.be.revertedWith("invalid recipient number");

    });

    it("cannot make zero address a recipient", async function () {
      let recipients = generateRecipients(4);
      recipients[2].account = ethers.constants.AddressZero;
      await expect(this.distributor.setRecipients(recipients))
        .to.be.revertedWith("invalid recipient address");

    });

    it("cannot have zero allocation for a recipient", async function () {
      let recipients = generateRecipients(4);
      recipients[2].allocation = 0;
      await expect(this.distributor.setRecipients(recipients))
        .to.be.revertedWith("invalid recipient allocation");

    });

    it("cannot have total alloc greater than denominator", async function () {
      let recipients = generateRecipients(4);
      recipients[2].allocation = recipients[2].allocation + 1;
      await expect(this.distributor.setRecipients(recipients))
        .to.be.revertedWith("total allocations do not equal to denominator");

    });

    it("cannot have total alloc less than denominator", async function () {
      let recipients = generateRecipients(4);
      for (let i = 0; i < 4; i++) {
        if (recipients[i].allocation > 1) {
          recipients[i].allocation = recipients[i].allocation - 1;
          break;
        }
      }
      await expect(this.distributor.setRecipients(recipients))
        .to.be.revertedWith("total allocations do not equal to denominator");

    });

    it("cannot set admin to zero address", async function () {
      await expect(this.distributor.setAdmin(ethers.constants.AddressZero))
        .to.be.revertedWith("invalid new admin");

    });

  });

  describe("Other Basic Checks", function () {
    it("cannot distribute zero", async function () {
      await expect(this.distributor.distributeToken(this.token.address))
        .to.be.revertedWith("cannot distribute zero");

    });

  });

  describe("Distribution Scenarios", function () {
    for (let i = 1; i <= 20; i++) {

      describe("distributes tokens to " + i + " recipients", function () {

        before(async function() {
          this.recipients = generateRecipients(i);
          this.amount = BigNumber.from(chance.integer({ min: 0 }));
          this.totalBalance = 0;

        });

        beforeEach(async function() {
          await expect(this.distributor.setRecipients(this.recipients))
            .to.emit(this.distributor, "RecipientsChanged");
          await this.token.mint(this.distributor.address, this.amount);
          await expect(this.distributor.distributeToken(this.token.address))
            .to.emit(this.distributor, "TokenDistributed");

        });

        it("allocates correct amount", async function() {
          for (let x = 0; x < i; x++) {
            let account = this.recipients[x].account;
            let allocation = this.recipients[x].allocation;
            let recipientBalance = await this.token.balanceOf(account);
            if (x === i - 1) {
              expect(this.amount.sub(this.totalBalance))
                .to.equal(recipientBalance);
            } else {
              expect(recipientBalance).to.equal(
                this.amount
                  .mul(allocation)
                  .div(this.denominator)
              );
            }
            this.totalBalance = recipientBalance.add(this.totalBalance);
          }
          expect(this.totalBalance).to.equal(this.amount);

        });

        after(async function() {
          let distributorBalance =
            await this.token.balanceOf(this.distributor.address);
          expect(distributorBalance).to.equal(0);
        });

      });

    }

  });


});
