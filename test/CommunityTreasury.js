// test/CommunityTreasury.js
// Load dependencies
const { expect } = require('chai');
const { BigNumber } = require('ethers');
const { ethers } = require('hardhat');

const OWNER_ADDRESS = ethers.utils.getAddress("0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266");

const oneToken = BigNumber.from("1000000000000000000");


// Start test block
describe('CommunityTreasury', function () {
    before(async function () {
        [this.addr1, this.addr2] = await ethers.getSigners();

        this.PNG = await ethers.getContractFactory("Png");
        this.Community = await ethers.getContractFactory('CommunityTreasury')

    });

    beforeEach(async function () {
        // PNG
        this.png = await this.PNG.deploy(OWNER_ADDRESS);
        await this.png.deployed();

        // Community Treasury
        this.community = await this.Community.deploy(this.png.address);
        await this.community.deployed();
        this.communityHandle2 = await this.community.connect(this.addr2);

    });

    // Test cases

    //////////////////////////////
    //       Constructor
    //////////////////////////////
    describe("Constructor", function () {
        it('PNG', async function () {
            expect(await this.community.png()).to.equal(this.png.address);
        });

    });

    //////////////////////////////
    //       Transfer
    //////////////////////////////
    describe("Transfer", function () {
        it('Owner can transfer', async function () {
            const transferAmount = oneToken.mul(100);
            await this.png.transfer(this.community.address, transferAmount);
            expect(await this.png.balanceOf(this.community.address)).to.equal(transferAmount);
            expect(await this.png.balanceOf(this.addr2.address)).to.equal(0);

            await this.community.transfer(this.addr2.address, transferAmount);
            expect(await this.png.balanceOf(this.addr2.address)).to.equal(transferAmount);
        });

        it('Nonowner cannot transfer', async function () {
            const transferAmount = oneToken.mul(100);
            await this.png.transfer(this.community.address, transferAmount);
            expect(await this.png.balanceOf(this.community.address)).to.equal(transferAmount);
            expect(await this.png.balanceOf(this.addr2.address)).to.equal(0);

            await expect(this.communityHandle2.transfer(this.addr2.address, transferAmount)).to.be.revertedWith(
                "Ownable: caller is not the owner"
            );
        });

        it('No balance to transfer', async function () {
            const transferAmount = oneToken.mul(100);
            expect(await this.png.balanceOf(this.community.address)).to.equal(0);

            await expect(this.community.transfer(this.addr2.address, transferAmount)).to.be.revertedWith(
                'Png::_transferTokens: transfer amount exceeds balance'
            );
        });
    });

    //////////////////////////////
    //       setowner
    //////////////////////////////
    describe("setowner", function () {
        it('Transfer owner successfully', async function () {
            expect((await this.community.owner())).to.not.equal(this.addr2.address);
            await this.community.transferOwnership(this.addr2.address);
            expect((await this.community.owner())).to.equal(this.addr2.address);
        });

        it('Transfer owner unsuccessfully', async function () {
            await expect(this.communityHandle2.transferOwnership(this.addr2.address)).to.be.revertedWith(
                "Ownable: caller is not the owner");
        });

        it('Renounce owner successfully', async function () {
            expect((await this.community.owner())).to.not.equal(ethers.constants.AddressZero);
            await this.community.renounceOwnership();
            expect((await this.community.owner())).to.equal(ethers.constants.AddressZero);
        });

        it('Renounce owner unsuccessfully', async function () {
            await expect(this.communityHandle2.renounceOwnership()).to.be.revertedWith(
                "Ownable: caller is not the owner");
        });
    });

    //////////////////////////////
    //       Balance
    //////////////////////////////
    describe("Transfer", function () {
        it('View Balance successfully', async function () {
            const transferAmount = oneToken.mul(100);
            expect(await this.community.balance()).to.equal(0);
            await this.png.transfer(this.community.address, transferAmount);
            expect(await this.community.balance()).to.equal(transferAmount);
        });
    });
});
