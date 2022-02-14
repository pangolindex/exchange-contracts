// test/Airdrop.js
// Load dependencies
const { expect } = require('chai');
const { BigNumber } = require('ethers');
const { ethers } = require('hardhat');

const UNPRIVILEGED_ADDRESS = ethers.Wallet.createRandom().address;
const TREASURY = ethers.Wallet.createRandom().address;

const AIRDROP_SUPPLY = ethers.utils.parseUnits("11500000", 18);
const TOTAL_SUPPLY = ethers.utils.parseUnits("230000000", 18);
const ONE_TOKEN = ethers.utils.parseUnits("1", 18);

// Start test block
describe('Airdrop', function () {
    before(async function () {
        [ this.admin, ] = await ethers.getSigners();
        this.Airdrop = await ethers.getContractFactory("Airdrop");
        this.PNG = await ethers.getContractFactory("Png");
        this.MockContract = await ethers.getContractFactory("MockContract");
    });

    beforeEach(async function () {
        this.png = await this.PNG.deploy(TOTAL_SUPPLY, this.admin.address, "PNG", "Pangolin");
        await this.png.deployed();
        this.airdrop = await this.Airdrop.deploy(AIRDROP_SUPPLY, this.png.address, this.admin.address, TREASURY);
        await this.airdrop.deployed();

    });

    // Test cases

    //////////////////////////////
    //       Constructor
    //////////////////////////////
    describe("Constructor", function () {
        it('airdrop supply', async function () {
            expect((await this.airdrop.airdropSupply())).to.equal(AIRDROP_SUPPLY);
        });
        it('png address', async function () {
            expect((await this.airdrop.png())).to.equal(this.png.address);
        });
        it('owner address', async function () {
            expect((await this.airdrop.owner())).to.equal(this.admin.address);
        });
        it('remainderDestination address', async function () {
            expect((await this.airdrop.remainderDestination())).to.equal(TREASURY);
        });
        it('claiming default', async function () {
            expect((await this.airdrop.claimingAllowed())).to.be.false;
        });
        it('totalAllocated default', async function () {
            expect((await this.airdrop.totalAllocated())).to.equal(0);
        });
    });

    //////////////////////////////
    //  setRemainderDestination
    //////////////////////////////
    describe("setRemainderDestination", function () {
        it('set remainder successfully', async function () {
            expect((await this.airdrop.remainderDestination())).to.not.equal(UNPRIVILEGED_ADDRESS);
            await this.airdrop.setRemainderDestination(UNPRIVILEGED_ADDRESS);
            expect((await this.airdrop.remainderDestination())).to.equal(UNPRIVILEGED_ADDRESS);
        });

        it('set remainder unsuccessfully', async function () {
            [ , altAddr] = await ethers.getSigners();
            altContract = await this.airdrop.connect(altAddr);
            await expect(altContract.setRemainderDestination(altAddr.getAddress())).to.be.revertedWith(
                "Airdrop::setRemainderDestination: unauthorized");
        });
    });

    //////////////////////////////
    //     setOwner
    //////////////////////////////
    describe("setOwner", function () {
        it('set owner successfully', async function () {
            expect((await this.airdrop.owner())).to.not.equal(UNPRIVILEGED_ADDRESS);
            await this.airdrop.setOwner(UNPRIVILEGED_ADDRESS);
            expect((await this.airdrop.owner())).to.equal(UNPRIVILEGED_ADDRESS);
        });

        it('set owner unsuccessfully', async function () {
            [ , altAddr] = await ethers.getSigners();
            altContract = await this.airdrop.connect(altAddr);
            await expect(altContract.setOwner(altAddr.getAddress())).to.be.revertedWith(
                "Airdrop::setOwner: unauthorized");
        });
    });

    //////////////////////////////
    //     setWhitelister
    //////////////////////////////
    describe("setWhitelister", function () {
        it('set whitelister successfully', async function () {
            expect((await this.airdrop.whitelister())).to.not.equal(UNPRIVILEGED_ADDRESS);
            await this.airdrop.setWhitelister(UNPRIVILEGED_ADDRESS);
            expect((await this.airdrop.whitelister())).to.equal(UNPRIVILEGED_ADDRESS);
        });

        it('set whitelister unsuccessfully', async function () {
            [ , altAddr] = await ethers.getSigners();
            altContract = await this.airdrop.connect(altAddr);
            await expect(altContract.setWhitelister(altAddr.getAddress())).to.be.revertedWith(
                "Airdrop::setWhitelister: unauthorized");
        });
    });

    //////////////////////////////
    //     setAirdropSupply
    //////////////////////////////
    describe("setAirdropSupply", function () {
        it('set airdropSupply successfully', async function () {
            const newAirdropSupply = AIRDROP_SUPPLY.add(500000);
            expect((await this.airdrop.airdropSupply())).to.equal(AIRDROP_SUPPLY);

            await this.airdrop.setAirdropSupply(newAirdropSupply);
            expect((await this.airdrop.airdropSupply())).to.equal(newAirdropSupply);
        });

        it('unauthorized call', async function () {
            const newAirdropSupply = AIRDROP_SUPPLY.add(500000);

            [ , altAddr] = await ethers.getSigners();
            altContract = await this.airdrop.connect(altAddr);
            await expect(altContract.setAirdropSupply(newAirdropSupply)).to.be.revertedWith(
                "Airdrop::setAirdropSupply: unauthorized");
        });

        it('less airdrop amount than already allocated', async function () {
            expect(await this.airdrop.withdrawAmount(UNPRIVILEGED_ADDRESS)).to.equal(0);
            await this.airdrop.whitelistAddresses([UNPRIVILEGED_ADDRESS], [AIRDROP_SUPPLY]);

            expect((await this.airdrop.airdropSupply())).to.equal(AIRDROP_SUPPLY);

            expect(await this.airdrop.withdrawAmount(UNPRIVILEGED_ADDRESS)).to.equal(AIRDROP_SUPPLY);
            await expect(this.airdrop.setAirdropSupply(AIRDROP_SUPPLY.sub(1))).to.be.revertedWith(
                "Airdrop::setAirdropSupply: supply less than total allocated");
        });

        it('claiming in session', async function () {
            expect((await this.airdrop.claimingAllowed())).to.be.false;
            await this.png.transfer(this.airdrop.address, AIRDROP_SUPPLY);

            expect(await this.png.balanceOf(this.airdrop.address)).to.equal(AIRDROP_SUPPLY);
            await this.airdrop.allowClaiming();

            expect((await this.airdrop.claimingAllowed())).to.be.true;

            const newAirdropSupply = AIRDROP_SUPPLY.add(500000);
            expect((await this.airdrop.airdropSupply())).to.equal(AIRDROP_SUPPLY);
            await expect(this.airdrop.setAirdropSupply(newAirdropSupply)).to.be.revertedWith(
                "Airdrop::setAirdropSupply: claiming in session");
        });

    });

    //////////////////////////////
    //     allowClaiming
    //////////////////////////////
    describe("allowClaiming", function () {
        it('set claiming successfully', async function () {
            expect((await this.airdrop.claimingAllowed())).to.be.false;
            await this.png.transfer(this.airdrop.address, AIRDROP_SUPPLY);
            expect(await this.png.balanceOf(this.airdrop.address)).to.equal(AIRDROP_SUPPLY);
            await this.airdrop.allowClaiming();
            expect((await this.airdrop.claimingAllowed())).to.be.true;
        });

        it('ClaimingAllowed emitted', async function () {
            expect((await this.airdrop.claimingAllowed())).to.be.false;
            await this.png.transfer(this.airdrop.address, AIRDROP_SUPPLY);
            expect(await this.png.balanceOf(this.airdrop.address)).to.equal(AIRDROP_SUPPLY);

            await expect(this.airdrop.allowClaiming()).to.emit(this.airdrop, 'ClaimingAllowed')
        });

        it('set claiming insufficient PNG', async function () {
            expect((await this.airdrop.claimingAllowed())).to.be.false;
            await expect(this.airdrop.allowClaiming()).to.be.revertedWith(
                'Airdrop::allowClaiming: incorrect PNG supply');
        });

        it('set claiming unathorized', async function () {
            expect((await this.airdrop.claimingAllowed())).to.be.false;
            await this.png.transfer(this.airdrop.address, AIRDROP_SUPPLY);
            expect(await this.png.balanceOf(this.airdrop.address)).to.equal(AIRDROP_SUPPLY);

            [ , altAddr] = await ethers.getSigners();
            altContract = await this.airdrop.connect(altAddr);
            await expect(altContract.allowClaiming()).to.be.revertedWith(
                'Airdrop::allowClaiming: unauthorized');
        });

        it('set claiming unathorized and insufficient PNG', async function () {
            expect((await this.airdrop.claimingAllowed())).to.be.false;
            [ , altAddr] = await ethers.getSigners();
            altContract = await this.airdrop.connect(altAddr);
            await expect(altContract.allowClaiming()).to.be.revertedWith(
                'Airdrop::allowClaiming: incorrect PNG supply');
        });
    });

    //////////////////////////////
    //       endClaiming
    //////////////////////////////
    describe("endClaiming", function () {
        it('end claiming successfully', async function () {
            // allow claiming
            expect((await this.airdrop.claimingAllowed())).to.be.false;
            await this.png.transfer(this.airdrop.address, AIRDROP_SUPPLY);
            expect(await this.png.balanceOf(this.airdrop.address)).to.equal(AIRDROP_SUPPLY);
            await this.airdrop.allowClaiming();
            expect((await this.airdrop.claimingAllowed())).to.be.true;

            // end claiming
            expect(await this.png.balanceOf(TREASURY)).to.equal(0);
            await this.airdrop.endClaiming();
            expect((await this.airdrop.claimingAllowed())).to.be.false;
            expect(await this.png.balanceOf(TREASURY)).to.equal(AIRDROP_SUPPLY);
            expect(await this.png.balanceOf(this.airdrop.address)).to.equal(0);
        });

        it('claiming not started', async function () {
            // end claiming
            expect((await this.airdrop.claimingAllowed())).to.be.false;
            await expect(this.airdrop.endClaiming()).to.be.revertedWith("Airdrop::endClaiming: Claiming not started");
        });

        it('ClaimingOver emitted', async function () {
            // allow claiming
            expect((await this.airdrop.claimingAllowed())).to.be.false;
            await this.png.transfer(this.airdrop.address, AIRDROP_SUPPLY);
            expect(await this.png.balanceOf(this.airdrop.address)).to.equal(AIRDROP_SUPPLY);
            await this.airdrop.allowClaiming();
            expect((await this.airdrop.claimingAllowed())).to.be.true;

            await expect(this.airdrop.endClaiming()).to.emit(this.airdrop, 'ClaimingOver')
        });

        it('end claiming with some claimed PNG', async function () {
            // whitelist address
            [ , altAddr] = await ethers.getSigners();
            altContract = await this.airdrop.connect(altAddr);
            const pngOut = ONE_TOKEN.mul(100)
            await this.airdrop.whitelistAddresses([altAddr.getAddress()], [pngOut]);

            // enable claiming
            expect((await this.airdrop.claimingAllowed())).to.be.false;
            await this.png.transfer(this.airdrop.address, AIRDROP_SUPPLY);
            expect(await this.png.balanceOf(this.airdrop.address)).to.equal(AIRDROP_SUPPLY);
            await this.airdrop.allowClaiming();
            expect((await this.airdrop.claimingAllowed())).to.be.true;

            // claim
            await altContract.claim();

            // end claiming
            expect(await this.png.balanceOf(TREASURY)).to.equal(0);
            await this.airdrop.endClaiming();
            expect((await this.airdrop.claimingAllowed())).to.be.false;
            expect(await this.png.balanceOf(TREASURY)).to.equal(AIRDROP_SUPPLY.sub(pngOut));
            expect(await this.png.balanceOf(this.airdrop.address)).to.equal(0);
        });

        it('end claiming with all claimed PNG', async function () {
            // whitelist address
            [ , altAddr] = await ethers.getSigners();
            altContract = await this.airdrop.connect(altAddr);
            const pngOut = AIRDROP_SUPPLY;
            await this.airdrop.whitelistAddresses([altAddr.getAddress()], [pngOut]);

            // enable claiming
            expect((await this.airdrop.claimingAllowed())).to.be.false;
            await this.png.transfer(this.airdrop.address, AIRDROP_SUPPLY);
            expect(await this.png.balanceOf(this.airdrop.address)).to.equal(AIRDROP_SUPPLY);
            await this.airdrop.allowClaiming();
            expect((await this.airdrop.claimingAllowed())).to.be.true;

            // claim
            await altContract.claim();

            // end claiming
            expect(await this.png.balanceOf(TREASURY)).to.equal(0);
            await this.airdrop.endClaiming();
            expect((await this.airdrop.claimingAllowed())).to.be.false;
            expect(await this.png.balanceOf(TREASURY)).to.equal(0);
            expect(await this.png.balanceOf(this.airdrop.address)).to.equal(0);
        });

        it('end claiming unauthorized', async function () {
            // allow claiming
            expect((await this.airdrop.claimingAllowed())).to.be.false;
            await this.png.transfer(this.airdrop.address, AIRDROP_SUPPLY);
            expect(await this.png.balanceOf(this.airdrop.address)).to.equal(AIRDROP_SUPPLY);
            await this.airdrop.allowClaiming();
            expect((await this.airdrop.claimingAllowed())).to.be.true;

            // end claiming
            [ , altAddr] = await ethers.getSigners();
            altContract = await this.airdrop.connect(altAddr);
            await expect(altContract.endClaiming()).to.be.revertedWith(
                'Airdrop::endClaiming: unauthorized');
        });
    });

    //////////////////////////////
    //          claim
    //////////////////////////////
    describe("claim", function () {
        it('successful claim', async function () {
            // Check balance starts at 0
            [ , altAddr] = await ethers.getSigners();
            altContract = await this.airdrop.connect(altAddr);
            expect(await this.png.balanceOf(altAddr.getAddress())).to.equal(0);

            // Whitelist address
            const pngOut = ethers.BigNumber.from('100');
            await this.airdrop.whitelistAddresses([altAddr.getAddress()], [pngOut]);
            expect(await this.airdrop.withdrawAmount(altAddr.getAddress())).to.equal(pngOut);

            // Enable claiming
            await this.png.transfer(this.airdrop.address, AIRDROP_SUPPLY);
            await this.airdrop.allowClaiming();
            expect((await this.airdrop.claimingAllowed())).to.be.true;

            // Claim
            await altContract.claim();

            // Check balance has increased
            expect(await this.png.balanceOf(altAddr.getAddress())).to.equal(pngOut);
        });

        it('event emitted', async function () {
            // Check balance starts at 0
            [ , altAddr] = await ethers.getSigners();
            altContract = await this.airdrop.connect(altAddr);
            expect(await this.png.balanceOf(altAddr.getAddress())).to.equal(0);

            // Whitelist address
            const pngOut = ethers.BigNumber.from('100');
            await this.airdrop.whitelistAddresses([altAddr.getAddress()], [pngOut]);
            expect(await this.airdrop.withdrawAmount(altAddr.getAddress())).to.equal(pngOut);

            // Enable claiming
            await this.png.transfer(this.airdrop.address, AIRDROP_SUPPLY);
            await this.airdrop.allowClaiming();
            expect((await this.airdrop.claimingAllowed())).to.be.true;

            // Claim
            await expect(altContract.claim()).to.emit(altContract, "PngClaimed").withArgs(altAddr.address, pngOut);

            // Check balance has increased
            expect(await this.png.balanceOf(altAddr.getAddress())).to.equal(pngOut);
        });

        it('claiming not enabled', async function () {
            // Check balance starts at 0
            [ , altAddr] = await ethers.getSigners();
            altContract = await this.airdrop.connect(altAddr);
            expect(await this.png.balanceOf(altAddr.getAddress())).to.equal(0);

            // Whitelist address
            const pngOut = ethers.BigNumber.from('100');
            await this.airdrop.whitelistAddresses([altAddr.getAddress()], [pngOut]);
            expect(await this.airdrop.withdrawAmount(altAddr.getAddress())).to.equal(pngOut);

            // Claim
            await expect(altContract.claim()).to.be.revertedWith(
                'Airdrop::claim: Claiming is not allowed');
        });

        it('PNG already claimed', async function () {
            // Check balance starts at 0
            [ , altAddr] = await ethers.getSigners();
            altContract = await this.airdrop.connect(altAddr);
            expect(await this.png.balanceOf(altAddr.getAddress())).to.equal(0);

            // Whitelist address
            const pngOut = ethers.BigNumber.from('100');
            await this.airdrop.whitelistAddresses([altAddr.getAddress()], [pngOut]);
            expect(await this.airdrop.withdrawAmount(altAddr.getAddress())).to.equal(pngOut);

            // Enable claiming
            await this.png.transfer(this.airdrop.address, AIRDROP_SUPPLY);
            await this.airdrop.allowClaiming();
            expect((await this.airdrop.claimingAllowed())).to.be.true;

            // Claim
            await altContract.claim();

            // Check balance has increased
            expect(await this.png.balanceOf(altAddr.getAddress())).to.equal(pngOut);

            // Try to claim again
            await expect(altContract.claim()).to.be.revertedWith(
                'Airdrop::claim: No PNG to claim');
        });

        it('Nothing to claim', async function () {
            // Check balance starts at 0
            [ , altAddr] = await ethers.getSigners();
            altContract = await this.airdrop.connect(altAddr);
            expect(await this.png.balanceOf(altAddr.getAddress())).to.equal(0);

            // Whitelist address
            const pngOut = ethers.BigNumber.from('0');

            // Enable claiming
            await this.png.transfer(this.airdrop.address, AIRDROP_SUPPLY);
            await this.airdrop.allowClaiming();
            expect((await this.airdrop.claimingAllowed())).to.be.true;

            // Attempt claim
            await expect(altContract.claim()).to.be.revertedWith(
                'Airdrop::claim: No PNG to claim');
        });

        it('Nothing to claim but balances present', async function () {
            // Check balance starts at 0
            [ , altAddr] = await ethers.getSigners();
            altContract = await this.airdrop.connect(altAddr);
            expect(await this.png.balanceOf(altAddr.getAddress())).to.equal(0);

            // Whitelist address
            const pngOut = ethers.BigNumber.from('0');

            // Enable claiming
            await this.png.transfer(this.airdrop.address, AIRDROP_SUPPLY);
            await this.airdrop.allowClaiming();
            expect((await this.airdrop.claimingAllowed())).to.be.true;

            // Attempt claim
            await expect(altContract.claim()).to.be.revertedWith(
                'Airdrop::claim: No PNG to claim');
        });

        it('Multiple successful claims', async function () {
            [ , altAddr, addr3] = await ethers.getSigners();
            altContract = await this.airdrop.connect(altAddr);
            altContract2 = await this.airdrop.connect(addr3);

            // Whitelist address
            const pngOut = ethers.BigNumber.from('100');
            await this.airdrop.whitelistAddresses([altAddr.getAddress()], [pngOut]);
            expect(await this.airdrop.withdrawAmount(altAddr.getAddress())).to.equal(pngOut);
            await this.airdrop.whitelistAddresses([addr3.getAddress()], [pngOut]);
            expect(await this.airdrop.withdrawAmount(addr3.getAddress())).to.equal(pngOut);

            // Enable claiming
            await this.png.transfer(this.airdrop.address, AIRDROP_SUPPLY);
            await this.airdrop.allowClaiming();
            expect((await this.airdrop.claimingAllowed())).to.be.true;

            // Check balance starts at 0

            expect(await this.png.balanceOf(altAddr.getAddress())).to.equal(0);
            expect(await this.png.balanceOf(addr3.getAddress())).to.equal(0);

            // Claim
            await altContract.claim();
            await altContract2.claim();


            // Check balance has increased
            expect(await this.png.balanceOf(altAddr.getAddress())).to.equal(pngOut);
            expect(await this.png.balanceOf(addr3.getAddress())).to.equal(pngOut);
        });
    });

    //////////////////////////////
    //    whitelistAddresses
    //////////////////////////////
    describe("whitelistAddresses", function () {
        it('Add single address', async function () {
            const pngOut = ethers.BigNumber.from('100');

            expect(await this.airdrop.withdrawAmount(UNPRIVILEGED_ADDRESS)).to.equal(0);

            await this.airdrop.whitelistAddresses([UNPRIVILEGED_ADDRESS], [pngOut]);

            expect(await this.airdrop.withdrawAmount(UNPRIVILEGED_ADDRESS)).to.equal(pngOut);
        });

        it('Add single address with whitelister', async function () {
            const pngOut = ethers.BigNumber.from('100');

            [ , altAddr] = await ethers.getSigners();
            altContract = await this.airdrop.connect(altAddr);

            await this.airdrop.setWhitelister(altAddr.address);
            expect((await this.airdrop.whitelister())).to.equal(altAddr.address);

            expect(await altContract.withdrawAmount(UNPRIVILEGED_ADDRESS)).to.equal(0);

            await altContract.whitelistAddresses([UNPRIVILEGED_ADDRESS], [pngOut]);

            expect(await this.airdrop.withdrawAmount(UNPRIVILEGED_ADDRESS)).to.equal(pngOut);
        });

        it('Add multiple addresses', async function () {
            const pngOut = ethers.BigNumber.from('100');
            const pngOut2 = ethers.BigNumber.from('543');

            expect(await this.airdrop.withdrawAmount(UNPRIVILEGED_ADDRESS)).to.equal(0);

            expect(await this.airdrop.withdrawAmount(this.admin.address)).to.equal(0);

            await this.airdrop.whitelistAddresses([UNPRIVILEGED_ADDRESS, this.admin.address],
                [pngOut, pngOut2]);

            expect(await this.airdrop.withdrawAmount(UNPRIVILEGED_ADDRESS)).to.equal(pngOut);

            expect(await this.airdrop.withdrawAmount(this.admin.address)).to.equal(pngOut2);
        });

        it('Add multiple addresses with whitelister', async function () {
            const pngOut = ethers.BigNumber.from('100');
            const pngOut2 = ethers.BigNumber.from('543');

            [ , altAddr] = await ethers.getSigners();
            altContract = await this.airdrop.connect(altAddr);

            await this.airdrop.setWhitelister(altAddr.address);
            expect((await this.airdrop.whitelister())).to.equal(altAddr.address);

            expect(await this.airdrop.withdrawAmount(UNPRIVILEGED_ADDRESS)).to.equal(0);

            expect(await this.airdrop.withdrawAmount(this.admin.address)).to.equal(0);

            await altContract.whitelistAddresses([UNPRIVILEGED_ADDRESS, this.admin.address],
                [pngOut, pngOut2]);

            expect(await this.airdrop.withdrawAmount(UNPRIVILEGED_ADDRESS)).to.equal(pngOut);

            expect(await this.airdrop.withdrawAmount(this.admin.address)).to.equal(pngOut2);
        });

        it('Exceeds PNG supply cummulatively', async function () {
            const pngOut = AIRDROP_SUPPLY;

            await expect(this.airdrop.whitelistAddresses([UNPRIVILEGED_ADDRESS, this.admin.address],
                [pngOut, pngOut])).to.be.revertedWith(
                'Airdrop::whitelistAddresses: Exceeds PNG allocation'
            );
        });

        it('Unauthorized call', async function () {
            const pngOut = ethers.BigNumber.from('100');

            [ , altAddr] = await ethers.getSigners();
            altContract = await this.airdrop.connect(altAddr);

            await expect(altContract.whitelistAddresses([UNPRIVILEGED_ADDRESS], [pngOut])).to.be.revertedWith(
                'Airdrop::whitelistAddresses: unauthorized'
            );
        });

        it('Add address twice to override', async function () {
            const pngOut = ethers.BigNumber.from('2000');
            const totalAlloc = await this.airdrop.totalAllocated();

            expect(await this.airdrop.withdrawAmount(UNPRIVILEGED_ADDRESS)).to.equal(0);

            await this.airdrop.whitelistAddresses([UNPRIVILEGED_ADDRESS], [pngOut]);

            expect(await this.airdrop.withdrawAmount(UNPRIVILEGED_ADDRESS)).to.equal(pngOut);
            expect(await this.airdrop.totalAllocated()).to.equal(totalAlloc.add(pngOut));

            await this.airdrop.whitelistAddresses([UNPRIVILEGED_ADDRESS], ['0']);

            expect(await this.airdrop.withdrawAmount(UNPRIVILEGED_ADDRESS)).to.equal(0);
            expect(await this.airdrop.totalAllocated()).to.equal(totalAlloc);

        });

        it('Incorrect addr length', async function () {
            const pngOut = ethers.BigNumber.from('2000');

            await expect(this.airdrop.whitelistAddresses([UNPRIVILEGED_ADDRESS],
                [pngOut, pngOut])).to.be.revertedWith(
                'Airdrop::whitelistAddresses: incorrect array length'
            );
        });

        it('Incorrect png length', async function () {
            const pngOut = ethers.BigNumber.from('2000');

            await expect(this.airdrop.whitelistAddresses([UNPRIVILEGED_ADDRESS, this.admin.address],
                [pngOut])).to.be.revertedWith(
                'Airdrop::whitelistAddresses: incorrect array length'
            );
        });

    });

    //////////////////////////////
    //       End-to-End
    //////////////////////////////
    describe("End-to-End", function () {
        it('Single claim', async function () {
            // Check balance starts at 0
            [ , altAddr] = await ethers.getSigners();
            altContract = await this.airdrop.connect(altAddr);
            expect(await this.png.balanceOf(altAddr.getAddress())).to.equal(0);

            // Whitelist address
            const pngOut = ethers.BigNumber.from('100');
            await this.airdrop.whitelistAddresses([altAddr.getAddress()], [pngOut]);
            expect(await this.airdrop.withdrawAmount(altAddr.getAddress())).to.equal(pngOut);

            // Enable claiming
            await this.png.transfer(this.airdrop.address, AIRDROP_SUPPLY);
            await this.airdrop.allowClaiming();
            expect((await this.airdrop.claimingAllowed())).to.be.true;

            // Claim
            await altContract.claim();

            // Check balance has increased
            expect(await this.png.balanceOf(altAddr.getAddress())).to.equal(pngOut);

            // End claiming
            expect(await this.png.balanceOf(TREASURY)).to.equal(0);
            await this.airdrop.endClaiming();
            expect((await this.airdrop.claimingAllowed())).to.be.false;
            expect(await this.png.balanceOf(TREASURY)).to.equal(AIRDROP_SUPPLY.sub(pngOut));
            expect(await this.png.balanceOf(this.airdrop.address)).to.equal(0);
        });

        it('Multiple claims', async function () {
            // Check balance starts at 0
            [ , altAddr, addr3] = await ethers.getSigners();
            altContract = await this.airdrop.connect(altAddr);
            altContract2 = await this.airdrop.connect(addr3);
            expect(await this.png.balanceOf(altAddr.getAddress())).to.equal(0);
            expect(await this.png.balanceOf(addr3.getAddress())).to.equal(0);

            // Whitelist address
            const pngOut = ethers.BigNumber.from('100');
            const pngOut2 = ethers.BigNumber.from('4326543');

            await this.airdrop.whitelistAddresses([altAddr.getAddress(), addr3.getAddress()], [pngOut, pngOut2]);
            expect(await this.airdrop.withdrawAmount(altAddr.getAddress())).to.equal(pngOut);
            expect(await this.airdrop.withdrawAmount(addr3.getAddress())).to.equal(pngOut2);

            // Enable claiming
            await this.png.transfer(this.airdrop.address, AIRDROP_SUPPLY);
            await this.airdrop.allowClaiming();
            expect((await this.airdrop.claimingAllowed())).to.be.true;

            // Claim
            await altContract.claim();
            await altContract2.claim();

            // Check balance has increased
            expect(await this.png.balanceOf(altAddr.getAddress())).to.equal(pngOut);
            expect(await this.png.balanceOf(addr3.getAddress())).to.equal(pngOut2);

            // End claiming
            expect(await this.png.balanceOf(TREASURY)).to.equal(0);
            await this.airdrop.endClaiming();
            expect((await this.airdrop.claimingAllowed())).to.be.false;
            expect(await this.png.balanceOf(TREASURY)).to.equal(AIRDROP_SUPPLY.sub(pngOut).sub(pngOut2));
            expect(await this.png.balanceOf(this.airdrop.address)).to.equal(0);
        });
    });
});
