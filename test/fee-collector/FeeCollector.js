const { smock } = require('@defi-wonderland/smock');
const { ethers, network } = require('hardhat');
const chai = require('chai');
const { expect } = chai;

const MINUTE = 60;
const HOUR = MINUTE * 60;
const DAY = HOUR * 24;
const WEEK = DAY * 7;

// Start test block
describe('FeeCollector', function () {

    const TREASURY_ADDRESS = '0x66c048d27aFB5EE59E4C07101A483654246A4eda';
    const GOVERNOR_ADDRESS = '0xEB5c91bE6Dbfd30cf616127C2EA823C64e4b1ff8';

    const HARVEST_ROLE = keccak256('HARVEST_ROLE');
    const PAUSE_ROLE = keccak256('PAUSE_ROLE');
    const RECOVERY_ROLE = keccak256('RECOVERY_ROLE');
    const GOVERNOR_ROLE = keccak256('GOVERNOR_ROLE');

    let OWNER, addr1, addr2, addr3, governorSigner;
    let FeeCollector, MiniChefV2, StakingRewards, PangolinPair, PNG;
    let feeCollector, _miniChefV2, stakingRewards;
    let _lp0, _lp1;
    let _wavax, _png, _tokenA, _tokenB, _tokenC;


    before(async function () {
        [ OWNER, addr1, addr2, addr3 ] = await ethers.getSigners();

        await network.provider.request({
            method: 'hardhat_impersonateAccount',
            params: [GOVERNOR_ADDRESS]
        });
        governorSigner = await ethers.provider.getSigner(GOVERNOR_ADDRESS);

        // Ensure governor has gas to send txs
        await OWNER.sendTransaction({
            to: GOVERNOR_ADDRESS,
            value: ethers.utils.parseEther('10'),
        });

        FeeCollector = await ethers.getContractFactory('FeeCollector');
        MiniChefV2 = await ethers.getContractFactory('MiniChefV2');
        StakingRewards = await ethers.getContractFactory('StakingRewards');
        PangolinPair = await ethers.getContractFactory('PangolinPair');
        PNG = await ethers.getContractFactory('Png');

        _miniChefV2 = await smock.fake(MiniChefV2);

        _wavax = await smock.fake(PNG);
        _png = await smock.fake(PNG);
        _tokenA = await smock.fake(PNG);
        _tokenB = await smock.fake(PNG);
        _tokenC = await smock.fake(PNG);

        _lp0 = await smock.fake(PangolinPair);
        _lp1 = await smock.fake(PangolinPair);
    });

    beforeEach(async function () {
        stakingRewards = await StakingRewards.deploy(
            _png.address,
            _png.address,
        );
        await stakingRewards.deployed();

        feeCollector = await FeeCollector.deploy(
            _wavax.address,
            ethers.constants.AddressZero, // will be mocked out
            '0x40231f6b438bce0797c9ada29b718a87ea0a5cea3fe9a771abdd76bd41a3e545', // init pair hash
            stakingRewards.address,
            _miniChefV2.address,
            0, // chef pid for dummy PGL
            TREASURY_ADDRESS, // “treasury” fees
            GOVERNOR_ADDRESS, // timelock
            OWNER.address, // admin
        );
        await feeCollector.deployed();
    });

    // Test cases

    describe('Permissions', async function() {
        let userWithRole, userWithoutRole;

        describe('HARVEST_ROLE', async function() {
            beforeEach(async function() {
                userWithRole = addr1;
                await feeCollector.connect(OWNER).grantRole(HARVEST_ROLE, userWithRole.address);
                userWithoutRole = addr2;
                await feeCollector.connect(OWNER).revokeRole(HARVEST_ROLE, userWithoutRole.address);
            });
            it('Admin can grant rule', async function() {
                const userGrantee = userWithoutRole;
                await expect(feeCollector.connect(OWNER).grantRole(
                    HARVEST_ROLE,
                    userGrantee.address,
                )).not.to.be.reverted;
                expect(await feeCollector.hasRole(HARVEST_ROLE, userGrantee.address)).to.be.true;
            });
            it('User with role cannot grant role', async function() {
                const userGrantee = userWithoutRole;
                await expect(feeCollector.connect(userWithRole).grantRole(
                    HARVEST_ROLE,
                    userGrantee.address,
                )).to.be.reverted;
                expect(await feeCollector.hasRole(HARVEST_ROLE, userGrantee.address)).to.be.false;
            });
        });
        describe('PAUSE_ROLE', async function() {
            beforeEach(async function() {
                userWithRole = addr1;
                await feeCollector.connect(OWNER).grantRole(PAUSE_ROLE, userWithRole.address);
                userWithoutRole = addr2;
                await feeCollector.connect(OWNER).revokeRole(PAUSE_ROLE, userWithoutRole.address);
            });
            it('Admin can grant rule', async function() {
                const userGrantee = userWithoutRole;
                await expect(feeCollector.connect(OWNER).grantRole(
                    PAUSE_ROLE,
                    userGrantee.address,
                )).not.to.be.reverted;
                expect(await feeCollector.hasRole(PAUSE_ROLE, userGrantee.address)).to.be.true;
            });
            it('User with role cannot grant role', async function() {
                const userGrantee = userWithoutRole;
                await expect(feeCollector.connect(userWithRole).grantRole(
                    PAUSE_ROLE,
                    userGrantee.address,
                )).to.be.reverted;
                expect(await feeCollector.hasRole(PAUSE_ROLE, userGrantee.address)).to.be.false;
            });
        });
        describe('RECOVERY_ROLE', async function() {
            beforeEach(async function() {
                userWithRole = addr1;
                await feeCollector.connect(OWNER).grantRole(RECOVERY_ROLE, userWithRole.address);
                userWithoutRole = addr2;
                await feeCollector.connect(OWNER).revokeRole(RECOVERY_ROLE, userWithoutRole.address);
            });
            it('Is granted by default to admin', async function() {
                expect(await feeCollector.hasRole(RECOVERY_ROLE, OWNER.address)).to.be.true;
            });
            it('Admin (without role) cannot grant rule', async function() {
                await feeCollector.connect(OWNER).revokeRole(RECOVERY_ROLE, OWNER.address);
                await expect(feeCollector.connect(OWNER).grantRole(
                    RECOVERY_ROLE,
                    userWithoutRole.address,
                )).to.be.reverted;
                expect(await feeCollector.hasRole(RECOVERY_ROLE, userWithoutRole.address)).to.be.false;
            });
            it('User with role can grant role', async function() {
                await expect(feeCollector.connect(userWithRole).grantRole(
                    RECOVERY_ROLE,
                    userWithoutRole.address,
                )).not.to.be.reverted;
                expect(await feeCollector.hasRole(RECOVERY_ROLE, userWithoutRole.address)).to.be.true;
            });
        });
        describe('GOVERNOR_ROLE', async function() {
            beforeEach(async function() {
                userWithRole = addr1;
                await feeCollector.connect(governorSigner).grantRole(GOVERNOR_ROLE, userWithRole.address);
                userWithoutRole = addr2;
                await feeCollector.connect(governorSigner).revokeRole(GOVERNOR_ROLE, userWithoutRole.address);
            });
            it('User with role can set treasury fee', async function() {
                await expect(feeCollector.connect(userWithRole).setTreasuryFee(
                    '20', // 0.2% in bips
                )).not.to.be.reverted;
                expect(await feeCollector.treasuryFee()).to.equal('20');
            });
            it('User without role cannot set treasury fee', async function() {
                await expect(feeCollector.connect(userWithoutRole).setTreasuryFee(
                    '20', // 0.2% in bips
                )).to.be.reverted;
                expect(await feeCollector.treasuryFee()).not.to.equal('20');
            });
            it('Admin (without role) cannot grant rule', async function() {
                await expect(feeCollector.connect(OWNER).grantRole(
                    GOVERNOR_ROLE,
                    userWithoutRole.address,
                )).to.be.reverted;
                expect(await feeCollector.hasRole(GOVERNOR_ROLE, userWithoutRole.address)).to.be.false;
            });
            it('User with role can grant role', async function() {
                await expect(feeCollector.connect(userWithRole).grantRole(
                    GOVERNOR_ROLE,
                    userWithoutRole.address,
                )).not.to.be.reverted;
                expect(await feeCollector.hasRole(GOVERNOR_ROLE, userWithoutRole.address)).to.be.true;
            });
        });
    });

    describe('Pausing', async function() {
        let userWithPauseRole, userWithoutPauseRole;
        let userWithHarvestRole;

        beforeEach(async function() {
            userWithPauseRole = addr1;
            await feeCollector.connect(OWNER).grantRole(PAUSE_ROLE, userWithPauseRole.address);
            userWithoutPauseRole = addr2;
            await feeCollector.connect(OWNER).revokeRole(PAUSE_ROLE, userWithoutPauseRole.address);
            userWithHarvestRole = addr3;
            await feeCollector.connect(OWNER).grantRole(HARVEST_ROLE, userWithHarvestRole.address);
        });
        it('Initializes as unpaused', async function() {
            expect(await feeCollector.paused()).to.be.false;
        });
        it('Cannot call harvest() when paused', async function() {
            await feeCollector.connect(userWithPauseRole).pause();
            await expect(feeCollector.connect(userWithHarvestRole).harvest(
                [],
                false,
                0,
            )).to.be.reverted;
        });
        it('Can call harvest() when unpaused', async function() {
            await expect(feeCollector.connect(userWithHarvestRole).harvest(
                [],
                false,
                0,
            )).not.to.be.reverted;
        });
        it('Cannot call recoverLP() when paused', async function() {
            await feeCollector.connect(userWithPauseRole).pause();
            await expect(feeCollector.connect(OWNER).recoverLP(
                [],
            )).to.be.reverted;
        });
        it('Can call recoverLP() when unpaused', async function() {
            await expect(feeCollector.connect(OWNER).recoverLP(
                [],
            )).not.to.be.reverted;
        });
    });

    describe('Harvesting', async function() {
        let userWithHarvestRole, userWithoutHarvestRole;

        beforeEach(async function() {
            userWithHarvestRole = addr1;
            await feeCollector.connect(OWNER).grantRole(HARVEST_ROLE, userWithHarvestRole.address);
            userWithoutHarvestRole = addr2;
            await feeCollector.connect(OWNER).revokeRole(HARVEST_ROLE, userWithoutHarvestRole.address);
        });
        it('User with role can harvest', async function() {
            await expect(feeCollector.connect(userWithHarvestRole).harvest(
                [],
                false,
                0,
            )).not.to.be.reverted;
        });
    });

    describe('Recovering', async function() {
        let userWithRecoveryRole, userWithoutRecoveryRole;
        const bal = ethers.utils.parseEther('10');

        beforeEach(async function() {
            userWithRecoveryRole = addr1;
            await feeCollector.connect(OWNER).grantRole(RECOVERY_ROLE, userWithRecoveryRole.address);
            userWithoutRecoveryRole = addr2;
            await feeCollector.connect(OWNER).revokeRole(RECOVERY_ROLE, userWithoutRecoveryRole.address);

            _lp0.transfer.whenCalledWith(TREASURY_ADDRESS, bal).returns(true);
            _lp0.balanceOf.whenCalledWith(feeCollector.address).returns(bal);
        });
        it('Admin can recover whitelisted token', async function() {
            await feeCollector.connect(userWithRecoveryRole).setRecoverable(_lp0.address, true);
            await expect(feeCollector.connect(OWNER).recoverLP(
                [_lp0.address],
            )).not.to.be.reverted;
            // expect(_lp0.balanceOf).to.have.been.called; // Not working even with sinon-chai
        });
        it('Admin cannot recover non-whitelisted token', async function() {
            await feeCollector.connect(userWithRecoveryRole).setRecoverable(_lp0.address, false);
            await expect(feeCollector.connect(OWNER).recoverLP(
                [_lp0.address],
            )).to.be.revertedWith('Cannot recover');
        });
    });

});

function keccak256(value) {
    return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(value));
}
