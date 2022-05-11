const { ethers, network } = require('hardhat');
const { expect } = require('chai');
const { smock } = require('@defi-wonderland/smock');

const MINUTE = 60;
const HOUR = MINUTE * 60;
const DAY = HOUR * 24;
const WEEK = DAY * 7;

// Start test block
describe('SuperFarm', function() {

    let OWNER, addr1, addr2, chef;
    let Token, MiniChefV2, PangolinPair, SuperFarmRewarder;
    let lp0;

    let superFarmRewarder, _miniChefV2;
    let reward18a, reward18b, reward6;

    const MANAGE_PERMISSION = keccak256('MANAGE_PERMISSION');
    const MODIFY_REWARD = keccak256('MODIFY_REWARD');
    const FUND_REWARD = keccak256('FUND_REWARD');
    const RENEW_REWARD = keccak256('RENEW_REWARD');
    const CANCEL_REWARD = keccak256('CANCEL_REWARD');
    
    before(async function() {
        [ OWNER, addr1, addr2 ] = await ethers.getSigners();

        SuperFarmRewarder = await ethers.getContractFactory('SuperFarmRewarder');
        Token = await ethers.getContractFactory('TestToken');
        MiniChefV2 = await ethers.getContractFactory('MiniChefV2');
        PangolinPair = await ethers.getContractFactory('PangolinPair');
        lp0 = await smock.fake(PangolinPair);

        _miniChefV2 = await smock.fake(MiniChefV2);
        _miniChefV2.lpToken.whenCalledWith(0).returns(lp0.address);

        // Allow simulating chef actions
        await network.provider.request({
            method: 'hardhat_impersonateAccount',
            params: [_miniChefV2.address]
        });
        chef = await ethers.provider.getSigner(_miniChefV2.address);

        // Ensure chef has gas to "send" txs
        await OWNER.sendTransaction({
            to: _miniChefV2.address,
            value: ethers.utils.parseEther('1000'),
        });
    });

    beforeEach(async function() {
        superFarmRewarder = await SuperFarmRewarder.deploy(
            _miniChefV2.address,
            0,
            OWNER.address,
        );

        reward18a = await Token.deploy(
            'Reward',
            'REW',
            18,
            ethers.utils.parseUnits('230000000', 18), // totalSupply
            OWNER.address, // owner
        );
        await permit(reward18a, superFarmRewarder.address, OWNER);

        reward18b = await Token.deploy(
            'Reward',
            'REW',
            18,
            ethers.utils.parseUnits('230000000', 18), // totalSupply
            OWNER.address, // owner
        );
        await permit(reward18b, superFarmRewarder.address, OWNER);

        reward6 = await Token.deploy(
            'Reward',
            'REW',
            6,
            ethers.utils.parseUnits('230000000', 6), // totalSupply
            OWNER.address, // owner
        );
        await permit(reward6, superFarmRewarder.address, OWNER);
    });

    // Test cases

    describe('Permissions', async function() {
        let userWithRole, userWithoutRole;
        beforeEach(async function() {
            userWithRole = addr1;
            userWithoutRole = addr2;

            lp0.balanceOf.whenCalledWith(_miniChefV2.address).returns(0);

            await superFarmRewarder.addRewardNow(
                reward18a.address,
                ethers.utils.parseUnits('1000', 18),
                WEEK,
            );
            await superFarmRewarder.addRewardNow(
                reward18b.address,
                ethers.utils.parseUnits('1000', 18),
                WEEK,
            );
        });

        describe('MANAGE_PERMISSION', async function() {
            beforeEach(async function() {
                await superFarmRewarder.connect(OWNER).setPermission(
                    0,
                    MANAGE_PERMISSION,
                    true,
                    userWithRole.address,
                );
            });
            itPassesRoleTests(MANAGE_PERMISSION);
            it('Grantee can grant for same id', async function() {
                await superFarmRewarder.connect(userWithRole).setPermission(
                    0,
                    MANAGE_PERMISSION,
                    true,
                    userWithoutRole.address,
                );
                expect(await superFarmRewarder.permissions(
                    0,
                    userWithoutRole.address,
                    MANAGE_PERMISSION,
                )).to.be.true;
            });
        });
        describe('MODIFY_REWARD', async function() {
            beforeEach(async function() {
                await superFarmRewarder.connect(OWNER).setPermission(
                    0,
                    MODIFY_REWARD,
                    true,
                    userWithRole.address,
                );
            });
            itPassesRoleTests(MODIFY_REWARD);
        });
        describe('FUND_REWARD', async function() {
            beforeEach(async function() {
                await superFarmRewarder.connect(OWNER).setPermission(
                    0,
                    FUND_REWARD,
                    true,
                    userWithRole.address,
                );
            });
            itPassesRoleTests(FUND_REWARD);
        });
        describe('RENEW_REWARD', async function() {
            beforeEach(async function() {
                await superFarmRewarder.connect(OWNER).setPermission(
                    0,
                    RENEW_REWARD,
                    true,
                    userWithRole.address,
                );
            });
            itPassesRoleTests(RENEW_REWARD);
        });
        describe('CANCEL_REWARD', async function() {
            beforeEach(async function() {
                await superFarmRewarder.connect(OWNER).setPermission(
                    0,
                    CANCEL_REWARD,
                    true,
                    userWithRole.address,
                );
            });
            itPassesRoleTests(CANCEL_REWARD);
        });

        function itPassesRoleTests(role) {
            it('Owner can grant', async function() {
                await superFarmRewarder.connect(OWNER).setPermission(
                    0,
                    role,
                    true,
                    userWithoutRole.address,
                );
                expect(await superFarmRewarder.permissions(
                    0,
                    userWithoutRole.address,
                    role,
                )).to.be.true;
            });
            it('Grantee cannot grant for different id', async function() {
                await expect(superFarmRewarder.connect(userWithRole).setPermission(
                    1,
                    role,
                    true,
                    userWithoutRole.address,
                )).to.be.revertedWith('Access denied');
                expect(await superFarmRewarder.permissions(
                    1,
                    userWithoutRole.address,
                    role,
                )).to.be.false;
            });
        }
    });

    describe('Adding reward', async function() {
        let now;
        beforeEach(async function() {
            lp0.balanceOf.whenCalledWith(_miniChefV2.address).returns(0);
            const block = await ethers.provider.getBlock();
            now = block.timestamp;
        });
        it('Can add a reward that begins now', async function() {
            await expect(superFarmRewarder.addRewardNow(
                reward18a.address,
                ethers.utils.parseUnits('1000000', 18),
                4 * WEEK,
            )).not.reverted;
        });
        it('Increases total reward count', async function() {
            expect(await superFarmRewarder.rewardCount()).to.equal(0);
            await expect(superFarmRewarder.addRewardNow(
                reward18a.address,
                ethers.utils.parseUnits('1000000', 18),
                4 * WEEK,
            )).not.reverted;
            expect(await superFarmRewarder.rewardCount()).to.equal(1);
        });
        it('Reward funding is transferred', async function() {
            const funding = ethers.utils.parseUnits('1000000', 18);
            const duration = 4 * WEEK;
            const startingBalance = await reward18a.balanceOf(OWNER.address);
            await expect(superFarmRewarder.addRewardNow(
                reward18a.address,
                funding,
                duration,
            )).not.reverted;
            const actualFunding = (funding.div(duration)).mul(duration);
            expect(await reward18a.balanceOf(OWNER.address)).to.equal(startingBalance.sub(actualFunding));
            expect(await reward18a.balanceOf(superFarmRewarder.address)).to.equal(actualFunding);
        });
        it('Can add the same reward that begins now twice', async function() {
            await expect(superFarmRewarder.addRewardNow(
                reward18a.address,
                ethers.utils.parseUnits('1000000', 18),
                4 * WEEK,
            )).not.reverted;
            await expect(superFarmRewarder.addRewardNow(
                reward18a.address,
                ethers.utils.parseUnits('1000000', 18),
                4 * WEEK,
            )).not.reverted;
        });
        it('Can add a reward that begins later', async function() {
            await expect(superFarmRewarder.addReward(
                reward18a.address,
                ethers.utils.parseUnits('1000000', 18),
                now + HOUR,
                now + (2 * DAY),
            )).not.reverted;
        });
        it('Can add the same reward that begins later twice', async function() {
            await expect(superFarmRewarder.addReward(
                reward18a.address,
                ethers.utils.parseUnits('1000000', 18),
                now + HOUR,
                now + (2 * DAY),
            )).not.reverted;
            await expect(superFarmRewarder.addReward(
                reward18a.address,
                ethers.utils.parseUnits('1000000', 18),
                now + HOUR,
                now + (2 * DAY),
            )).not.reverted;
        });
        it('Cannot add a reward with 0 funding', async function() {
            await expect(superFarmRewarder.addRewardNow(
                reward18a.address,
                0,
                4 * WEEK,
            )).to.be.revertedWith('Invalid amount');
        });
        it('Cannot add a reward which begins in the past', async function() {
            await expect(superFarmRewarder.addReward(
                reward18a.address,
                ethers.utils.parseUnits('1000000', 18),
                now - HOUR,
                now + HOUR,
            )).to.be.revertedWith('Invalid beginning');
        });
        it('Cannot add a reward which expires before it begins', async function() {
            await expect(superFarmRewarder.addReward(
                reward18a.address,
                ethers.utils.parseUnits('1000000', 18),
                now + HOUR,
                now + HOUR - 1,
            )).to.be.revertedWith('Invalid duration');
        });
        it('Cannot exceed reward cap', async function() {
            const rewardCap = await superFarmRewarder.MAX_REWARD_COUNT();
            for (let i = 0; i < rewardCap; i++) {
                await expect(superFarmRewarder.addRewardNow(
                    reward18a.address,
                    ethers.utils.parseUnits('1000000', 18),
                    WEEK,
                )).not.reverted;
            }
            await expect(superFarmRewarder.addRewardNow(
                reward18a.address,
                ethers.utils.parseUnits('1000000', 18),
                WEEK,
            )).to.be.revertedWith('Reward limit reached');
        });
        it('Cannot add rewards that would truncate to a 0 rate', async function() {
            await expect(superFarmRewarder.addReward(
                reward18a.address,
                ethers.utils.parseUnits('1', 6),
                now + HOUR,
                now + (365 * DAY),
            )).to.be.revertedWith('Invalid reward rate');
            await expect(superFarmRewarder.addRewardNow(
                reward18a.address,
                ethers.utils.parseUnits('1', 6),
                365 * DAY,
            )).to.be.revertedWith('Invalid reward rate');
        });
        it('Non-owner cannot add a reward', async function() {
            const amount = ethers.utils.parseUnits('1000000', 18);

            await expect(superFarmRewarder.connect(addr1).addReward(
                reward18a.address,
                amount,
                now + HOUR,
                now + HOUR + HOUR,
            )).to.be.revertedWith('Ownable: caller is not the owner');
            await expect(superFarmRewarder.connect(addr1).addRewardNow(
                reward18a.address,
                amount,
                HOUR,
            )).to.be.revertedWith('Ownable: caller is not the owner');
        });
    });

    describe('Modifying reward', async function() {
        let beginning, expiration, rewardRatePerSecond;
        let userWithModifyRole, userWithoutModifyRole;
        beforeEach(async function() {
            const timestamp = (await ethers.provider.getBlock()).timestamp;

            lp0.balanceOf.whenCalledWith(_miniChefV2.address).returns(0);

            beginning = timestamp + HOUR;
            expiration = beginning + WEEK;
            const duration = expiration - beginning;
            const unadjustedAmount = ethers.utils.parseUnits('12345', 18);
            rewardRatePerSecond = unadjustedAmount.div(duration);
            await addReward(reward18a, beginning, expiration, unadjustedAmount);

            userWithModifyRole = addr1;
            userWithoutModifyRole = addr2;
            await superFarmRewarder.setPermission(0, MODIFY_REWARD, true, userWithModifyRole.address);
        });
        it('User with role can increase an expiration before reward period starts', async function() {
            const oldRewardInfo = await superFarmRewarder.rewardInfos(0);
            const newExpiration = expiration + HOUR;

            await setTime(beginning - 10);
            await expect(superFarmRewarder.connect(userWithModifyRole).modifyRewardExpiration(
                0,
                newExpiration,
            )).not.to.be.reverted;

            const newRewardInfo = await superFarmRewarder.rewardInfos(0);
            expect(newRewardInfo.beginning).to.equal(oldRewardInfo.beginning);
            expect(newRewardInfo.expiration).to.equal(newExpiration);
            expect(newRewardInfo.rewardRatePerSecond).to.be.lt(oldRewardInfo.rewardRatePerSecond);
        });
        it('User with role can increase an expiration during active reward period', async function() {
            const oldRewardInfo = await superFarmRewarder.rewardInfos(0);
            const newExpiration = expiration + HOUR;

            await setTime(beginning + 10);
            await expect(superFarmRewarder.connect(userWithModifyRole).modifyRewardExpiration(
                0,
                newExpiration,
            )).not.to.be.reverted;

            const newRewardInfo = await superFarmRewarder.rewardInfos(0);
            expect(newRewardInfo.beginning).to.equal(oldRewardInfo.beginning);
            expect(newRewardInfo.expiration).to.equal(newExpiration);
            expect(newRewardInfo.rewardRatePerSecond).to.be.lt(oldRewardInfo.rewardRatePerSecond);
        });
        it('User with role can decrease an expiration before reward period starts', async function() {
            const oldRewardInfo = await superFarmRewarder.rewardInfos(0);
            const newExpiration = expiration - HOUR;

            await setTime(beginning - 10);
            await expect(superFarmRewarder.connect(userWithModifyRole).modifyRewardExpiration(
                0,
                newExpiration,
            )).not.to.be.reverted;

            const newRewardInfo = await superFarmRewarder.rewardInfos(0);
            expect(newRewardInfo.beginning).to.equal(oldRewardInfo.beginning);
            expect(newRewardInfo.expiration).to.equal(newExpiration);
            expect(newRewardInfo.rewardRatePerSecond).to.be.gt(oldRewardInfo.rewardRatePerSecond);
        });
        it('User with role can decrease an expiration during active reward period', async function() {
            const oldRewardInfo = await superFarmRewarder.rewardInfos(0);
            const newExpiration = expiration - HOUR;

            await setTime(beginning + 10);
            await expect(superFarmRewarder.connect(userWithModifyRole).modifyRewardExpiration(
                0,
                newExpiration,
            )).not.to.be.reverted;

            const newRewardInfo = await superFarmRewarder.rewardInfos(0);
            expect(newRewardInfo.beginning).to.equal(oldRewardInfo.beginning);
            expect(newRewardInfo.expiration).to.equal(newExpiration);
            expect(newRewardInfo.rewardRatePerSecond).to.be.gt(oldRewardInfo.rewardRatePerSecond);
        });
        it('Refunds dust', async function() {
            const userBalance = await reward18a.balanceOf(userWithModifyRole.address);

            await setTime(beginning);
            await expect(superFarmRewarder.connect(userWithModifyRole).modifyRewardExpiration(
                0,
                expiration - HOUR,
            )).not.to.be.reverted;

            expect(await reward18a.balanceOf(userWithModifyRole.address)).to.be.gt(userBalance);
        });
        it('User without role cannot modify reward', async function() {
            await setTime(beginning);
            await expect(superFarmRewarder.connect(userWithoutModifyRole).modifyRewardExpiration(
                0,
                expiration + HOUR,
            )).to.be.revertedWith('Access denied');
        });
        it('Cannot modify a non-existent reward', async function() {
            await expect(superFarmRewarder.connect(OWNER).modifyRewardExpiration(
                5,
                expiration + HOUR,
            )).to.be.revertedWith('Invalid reward ID');
            await expect(superFarmRewarder.connect(userWithModifyRole).modifyRewardExpiration(
                5,
                expiration + HOUR,
            )).to.be.revertedWith('Invalid reward ID');
        });
        it('Cannot modify an expired reward', async function() {
            await setTime(expiration);
            await expect(superFarmRewarder.connect(userWithModifyRole).modifyRewardExpiration(
                0,
                expiration + HOUR,
            )).to.be.revertedWith('Reward is expired');
        });
        it('Cannot modify a cancelled reward', async function() {
            await superFarmRewarder.connect(OWNER).cancelReward(0, OWNER.address);
            await setTime(beginning);
            await expect(superFarmRewarder.connect(userWithModifyRole).modifyRewardExpiration(
                0,
                expiration + HOUR,
            )).to.be.revertedWith('Reward is cancelled');
        });
        it('Cannot modify expiration to be before beginning', async function() {
            await expect(superFarmRewarder.connect(userWithModifyRole).modifyRewardExpiration(
                0,
                beginning - HOUR,
            )).to.be.revertedWith('Invalid reward period');
        });
        it('Cannot modify expiration to be the same as beginning', async function() {
            await expect(superFarmRewarder.connect(userWithModifyRole).modifyRewardExpiration(
                0,
                beginning,
            )).to.be.revertedWith('Invalid reward period');
        });
        it('Cannot modify expiration to be the same as current expiration', async function() {
            await expect(superFarmRewarder.connect(userWithModifyRole).modifyRewardExpiration(
                0,
                expiration,
            )).to.be.revertedWith('Identical period');
        });
        it('Cannot modify expiration to be now', async function() {
            const now = beginning + 1;
            await setTime(now);
            await expect(superFarmRewarder.connect(userWithModifyRole).modifyRewardExpiration(
                0,
                now,
            )).to.be.revertedWith('Invalid reward period');
        });
        it('Cannot modify expiration to be in the past (before period begins)', async function() {
            await setTime(beginning - 5);
            await expect(superFarmRewarder.connect(userWithModifyRole).modifyRewardExpiration(
                0,
                beginning - 10,
            )).to.be.revertedWith('Invalid reward period');
        });
        it('Cannot modify expiration to be in the past (after period begins)', async function() {
            await setTime(beginning + 10);
            await expect(superFarmRewarder.connect(userWithModifyRole).modifyRewardExpiration(
                0,
                beginning + 5,
            )).to.be.revertedWith('Invalid reward period');
        });
    });

    describe('Funding reward', async function() {
        let beginning, expiration, initialFunding, rewardRatePerSecond;
        let userWithFundRole, userWithoutFundRole;
        beforeEach(async function() {
            const timestamp = (await ethers.provider.getBlock()).timestamp;

            lp0.balanceOf.whenCalledWith(_miniChefV2.address).returns(0);

            beginning = timestamp + HOUR;
            expiration = beginning + WEEK;
            const duration = expiration - beginning;
            const unadjustedInitialFunding = ethers.utils.parseUnits('100000', 18);
            rewardRatePerSecond = unadjustedInitialFunding.div(duration);
            await addReward(reward18a, beginning, expiration, unadjustedInitialFunding);
            initialFunding = await reward18a.balanceOf(superFarmRewarder.address);

            userWithFundRole = addr1;
            userWithoutFundRole = addr2;
            await superFarmRewarder.setPermission(0, FUND_REWARD, true, userWithFundRole.address);
        });
        it('Owner can fund a reward before the period starts', async function() {
            const funding = ethers.utils.parseUnits('1000', 18);
            const actualFunding = funding.div(rewardRatePerSecond).mul(rewardRatePerSecond);
            const oldRewardInfo = await superFarmRewarder.rewardInfos(0);
            await expect(superFarmRewarder.connect(OWNER).fundReward(0, funding)).not.to.be.reverted;
            expect(await reward18a.balanceOf(superFarmRewarder.address)).to.equal(initialFunding.add(actualFunding));
            const newRewardInfo = await superFarmRewarder.rewardInfos(0);
            expect(newRewardInfo.beginning).to.equal(oldRewardInfo.beginning);
            expect(newRewardInfo.expiration).to.be.gt(oldRewardInfo.expiration);
            expect(newRewardInfo.rewardRatePerSecond).to.equal(oldRewardInfo.rewardRatePerSecond);
        });
        it('Owner can fund a reward during active period', async function() {
            const funding = ethers.utils.parseUnits('1000', 18);
            const actualFunding = funding.div(rewardRatePerSecond).mul(rewardRatePerSecond);
            const oldRewardInfo = await superFarmRewarder.rewardInfos(0);
            await setTime(beginning + HOUR);
            await expect(superFarmRewarder.connect(OWNER).fundReward(0, funding)).not.to.be.reverted;
            expect(await reward18a.balanceOf(superFarmRewarder.address)).to.equal(initialFunding.add(actualFunding));
            const newRewardInfo = await superFarmRewarder.rewardInfos(0);
            expect(newRewardInfo.beginning).to.equal(oldRewardInfo.beginning);
            expect(newRewardInfo.expiration).to.be.gt(oldRewardInfo.expiration);
            expect(newRewardInfo.rewardRatePerSecond).to.equal(oldRewardInfo.rewardRatePerSecond);
        });
        it('User with role can fund a reward before the period starts', async function() {
            const funding = ethers.utils.parseUnits('1000', 18);
            const actualFunding = funding.div(rewardRatePerSecond).mul(rewardRatePerSecond);
            await reward18a.connect(OWNER).transfer(userWithFundRole.address, funding);
            await permit(reward18a, superFarmRewarder.address, userWithFundRole);
            const oldRewardInfo = await superFarmRewarder.rewardInfos(0);
            await expect(superFarmRewarder.connect(userWithFundRole).fundReward(0, funding)).not.to.be.reverted;
            expect(await reward18a.balanceOf(superFarmRewarder.address)).to.equal(initialFunding.add(actualFunding));
            const newRewardInfo = await superFarmRewarder.rewardInfos(0);
            expect(newRewardInfo.beginning).to.equal(oldRewardInfo.beginning);
            expect(newRewardInfo.expiration).to.be.gt(oldRewardInfo.expiration);
            expect(newRewardInfo.rewardRatePerSecond).to.equal(oldRewardInfo.rewardRatePerSecond);
        });
        it('User with role can fund a reward during active period', async function() {
            const funding = ethers.utils.parseUnits('1000', 18);
            const actualFunding = funding.div(rewardRatePerSecond).mul(rewardRatePerSecond);
            await reward18a.connect(OWNER).transfer(userWithFundRole.address, funding);
            await permit(reward18a, superFarmRewarder.address, userWithFundRole);
            const oldRewardInfo = await superFarmRewarder.rewardInfos(0);
            await setTime(beginning + HOUR);
            await expect(superFarmRewarder.connect(userWithFundRole).fundReward(0, funding)).not.to.be.reverted;
            expect(await reward18a.balanceOf(superFarmRewarder.address)).to.equal(initialFunding.add(actualFunding));
            const newRewardInfo = await superFarmRewarder.rewardInfos(0);
            expect(newRewardInfo.beginning).to.equal(oldRewardInfo.beginning);
            expect(newRewardInfo.expiration).to.be.gt(oldRewardInfo.expiration);
            expect(newRewardInfo.rewardRatePerSecond).to.equal(oldRewardInfo.rewardRatePerSecond);
        });
        it('Cannot provide 0 funding', async function() {
            const funding = 0;
            await expect(superFarmRewarder.connect(userWithFundRole).fundReward(
                0,
                funding,
            )).to.be.revertedWith('Invalid amount');
        });
        it('Cannot be funded by user without role', async function() {
            const funding = ethers.utils.parseUnits('1000', 18);
            await expect(superFarmRewarder.connect(userWithoutFundRole).fundReward(
                0,
                funding,
            )).to.be.revertedWith('Access denied');
        });
        it('Cannot fund a cancelled reward', async function() {
            const funding = ethers.utils.parseUnits('1000', 18);
            await superFarmRewarder.cancelReward(0, OWNER.address);
            await expect(superFarmRewarder.connect(userWithFundRole).fundReward(
                0,
                funding,
            )).to.be.revertedWith('Reward is cancelled');
        });
        it('Cannot fund expired reward', async function() {
            const funding = ethers.utils.parseUnits('1000', 18);
            await setTime(expiration);
            await expect(superFarmRewarder.connect(userWithFundRole).fundReward(
                0,
                funding,
            )).to.be.revertedWith('Reward is expired');
        });
        it('Cannot provide small funding where the duration is not increased', async function() {
            const funding = 10; // Incredibly small amount
            await expect(superFarmRewarder.connect(userWithFundRole).fundReward(
                0,
                funding,
            )).to.be.revertedWith('Invalid duration');
        });
    });

    describe('Renewing reward', async function() {
        let beginning, expiration, initialFunding, rewardRatePerSecond;
        let userWithRenewRole, userWithoutRenewRole;
        beforeEach(async function() {
            const timestamp = (await ethers.provider.getBlock()).timestamp;

            lp0.balanceOf.whenCalledWith(_miniChefV2.address).returns(0);

            beginning = timestamp + HOUR;
            expiration = beginning + WEEK;
            const duration = expiration - beginning;
            const unadjustedInitialFunding = ethers.utils.parseUnits('100000', 18);
            rewardRatePerSecond = unadjustedInitialFunding.div(duration);
            await addReward(reward18a, beginning, expiration, unadjustedInitialFunding);
            initialFunding = await reward18a.balanceOf(superFarmRewarder.address);

            userWithRenewRole = addr1;
            userWithoutRenewRole = addr2;
            await superFarmRewarder.setPermission(0, RENEW_REWARD, true, userWithRenewRole.address);

            await reward18a.transfer(userWithRenewRole.address, ethers.utils.parseUnits('1000000', 18));
            await permit(reward18a, superFarmRewarder.address, userWithRenewRole);
        });
        it('User without role cannot renew a reward', async function() {
            const amount = ethers.utils.parseUnits('20000', 18);
            await setTime(expiration);
            await expect(superFarmRewarder.connect(userWithoutRenewRole).renewReward(
                0,
                amount,
                expiration + MINUTE,
                expiration + MINUTE + MINUTE,
            )).to.be.revertedWith('Access denied');
            await expect(superFarmRewarder.connect(userWithoutRenewRole).renewRewardNow(
                0,
                amount,
                MINUTE,
            )).to.be.revertedWith('Access denied');
        });
        it('Owner can renew a reward beginning immediately', async function() {
            const amount = ethers.utils.parseUnits('20000', 18);
            const duration = 20000;
            const actualAmount = amount.div(duration).mul(duration);
            await setTime(expiration);
            await expect(superFarmRewarder.connect(OWNER).renewRewardNow(
                0,
                amount,
                duration,
            )).not.to.be.reverted;
            expect(await reward18a.balanceOf(superFarmRewarder.address)).to.equal(initialFunding.add(actualAmount));
            const rewardInfo = await superFarmRewarder.rewardInfos(0);
            expect(rewardInfo.beginning).to.equal(expiration);
            expect(rewardInfo.expiration).to.equal(expiration + duration);
            expect(rewardInfo.rewardRatePerSecond).to.equal(amount.div(duration));
        });
        it('Owner can renew a reward beginning later', async function() {
            const amount = ethers.utils.parseUnits('20000', 18);
            const newBeginning = expiration + HOUR;
            const newExpiration = newBeginning + WEEK;
            const duration = newExpiration - newBeginning;
            const actualAmount = amount.div(duration).mul(duration);
            await setTime(expiration);
            await expect(superFarmRewarder.connect(OWNER).renewReward(
                0,
                amount,
                newBeginning,
                newExpiration,
            )).not.to.be.reverted;
            expect(await reward18a.balanceOf(superFarmRewarder.address)).to.equal(initialFunding.add(actualAmount));
            const rewardInfo = await superFarmRewarder.rewardInfos(0);
            expect(rewardInfo.beginning).to.equal(newBeginning);
            expect(rewardInfo.expiration).to.equal(newExpiration);
            expect(rewardInfo.rewardRatePerSecond).to.equal(amount.div(newExpiration - newBeginning));
        });
        it('User with role can renew a reward now', async function() {
            const amount = ethers.utils.parseUnits('20000', 18);
            const duration = 20000;
            const actualAmount = amount.div(duration).mul(duration);
            await setTime(expiration);
            await expect(superFarmRewarder.connect(userWithRenewRole).renewRewardNow(
                0,
                amount,
                duration,
            )).not.to.be.reverted;
            expect(await reward18a.balanceOf(superFarmRewarder.address)).to.equal(initialFunding.add(actualAmount));
            const rewardInfo = await superFarmRewarder.rewardInfos(0);
            expect(rewardInfo.beginning).to.equal(expiration);
            expect(rewardInfo.expiration).to.equal(expiration + duration);
            expect(rewardInfo.rewardRatePerSecond).to.equal(amount.div(duration));
        });
        it('User with role can renew a reward later', async function() {
            const amount = ethers.utils.parseUnits('20000', 18);
            const newBeginning = expiration + HOUR;
            const newExpiration = newBeginning + WEEK;
            const duration = newExpiration - newBeginning;
            const actualAmount = amount.div(duration).mul(duration);
            await setTime(expiration);
            await expect(superFarmRewarder.connect(userWithRenewRole).renewReward(
                0,
                amount,
                newBeginning,
                newExpiration,
            )).not.to.be.reverted;
            expect(await reward18a.balanceOf(superFarmRewarder.address)).to.equal(initialFunding.add(actualAmount));
            const rewardInfo = await superFarmRewarder.rewardInfos(0);
            expect(rewardInfo.beginning).to.equal(newBeginning);
            expect(rewardInfo.expiration).to.equal(newExpiration);
            expect(rewardInfo.rewardRatePerSecond).to.equal(amount.div(newExpiration - newBeginning));
        });
        it('Cannot renew without funding', async function() {
            await setTime(expiration);
            await expect(superFarmRewarder.renewReward(
                0,
                0,
                expiration,
                expiration + HOUR,
            )).to.be.revertedWith('Invalid amount');
            await expect(superFarmRewarder.renewRewardNow(
                0,
                0,
                DAY,
            )).to.be.revertedWith('Invalid amount');
        });
        it('Cannot renew using a beginning in the past', async function() {
            await setTime(expiration);
            await expect(superFarmRewarder.renewReward(
                0,
                initialFunding,
                expiration - HOUR,
                expiration + HOUR,
            )).to.be.revertedWith('Invalid beginning');
        });
        it('Cannot renew using an expiration greater than beginning', async function() {
            const newBeginning = expiration + HOUR;
            await setTime(expiration);
            await expect(superFarmRewarder.renewReward(
                0,
                initialFunding,
                newBeginning,
                newBeginning - 1,
            )).to.be.revertedWith('Invalid duration');
        });
        it('Cannot renew an active reward', async function() {
            await setTime(expiration - 10);
            await expect(superFarmRewarder.renewReward(
                0,
                initialFunding,
                expiration + HOUR,
                expiration + DAY,
            )).to.be.revertedWith('Reward is not expired');
            await setTime(expiration - 5);
            await expect(superFarmRewarder.renewRewardNow(
                0,
                initialFunding,
                WEEK,
            )).to.be.revertedWith('Reward is not expired');
        });
        it('Cannot renew with small funding causing a zero reward rate', async function() {
            await setTime(expiration);
            await expect(superFarmRewarder.renewReward(
                0,
                100, // Very small funding amount
                expiration + HOUR,
                expiration + WEEK,
            )).to.be.revertedWith('Invalid reward rate');
            await expect(superFarmRewarder.renewRewardNow(
                0,
                100, // Very small funding amount
                WEEK,
            )).to.be.revertedWith('Invalid reward rate');
        });
    });

    describe('Cancelling reward', async function() {
        let beginning, expiration, initialFunding, rewardRatePerSecond;
        let userWithCancelRole, userWithoutCancelRole;
        let ownerBalance, userBalance;
        beforeEach(async function() {
            const timestamp = (await ethers.provider.getBlock()).timestamp;

            lp0.balanceOf.whenCalledWith(_miniChefV2.address).returns(0);

            beginning = timestamp + HOUR;
            expiration = beginning + WEEK;
            const duration = expiration - beginning;
            const unadjustedInitialFunding = ethers.utils.parseUnits('123456', 18);
            rewardRatePerSecond = unadjustedInitialFunding.div(duration);
            await addReward(reward18a, beginning, expiration, unadjustedInitialFunding);
            initialFunding = await reward18a.balanceOf(superFarmRewarder.address);

            userWithCancelRole = addr1;
            userWithoutCancelRole = addr2;
            await superFarmRewarder.setPermission(0, CANCEL_REWARD, true, userWithCancelRole.address);

            ownerBalance = await reward18a.balanceOf(OWNER.address);
            userBalance = await reward18a.balanceOf(userWithCancelRole.address);
        });
        it('User without role cannot cancel a reward', async function() {
            await setTime(beginning + MINUTE);
            await expect(superFarmRewarder.connect(userWithoutCancelRole).cancelReward(
                0,
                userWithoutCancelRole.address,
            )).to.be.revertedWith('Access denied');
        });
        it('Owner can cancel a reward before the period begins', async function() {
            await setTime(beginning - 30);
            await expect(superFarmRewarder.connect(OWNER).cancelReward(
                0,
                OWNER.address,
            )).not.to.be.reverted;

            const rewardInfo = await superFarmRewarder.rewardInfos(0);
            expect(rewardInfo.rewardRatePerSecond).to.equal(0);
            expect(rewardInfo.expiration).to.equal(beginning);
            expect(await reward18a.balanceOf(superFarmRewarder.address)).to.equal(0);
            expect(await reward18a.balanceOf(OWNER.address)).to.equal(ownerBalance.add(initialFunding));
        });
        it('User with role can cancel a reward before the period begins', async function() {
            await setTime(beginning - 30);
            await expect(superFarmRewarder.connect(userWithCancelRole).cancelReward(
                0,
                userWithCancelRole.address,
            )).not.to.be.reverted;

            expect(await superFarmRewarder.rewardInfos(0)).property('rewardRatePerSecond').to.equal(0);
            expect(await reward18a.balanceOf(superFarmRewarder.address)).to.equal(0);
            expect(await reward18a.balanceOf(userWithCancelRole.address)).to.equal(userBalance.add(initialFunding));
        });
        it('Owner can cancel a reward during an active period (with deposits)', async function() {
            const deposit = ethers.utils.parseUnits('100', 18);

            await setTime(beginning);
            await normalDeposit(0, addr1, deposit);

            await setTime(beginning + HOUR);
            await expect(superFarmRewarder.connect(OWNER).cancelReward(
                0,
                OWNER.address,
            )).not.to.be.reverted;

            const allocatedRewards = rewardRatePerSecond.mul(HOUR);
            expect(await superFarmRewarder.rewardInfos(0)).property('rewardRatePerSecond').to.equal(0);
            expect(await reward18a.balanceOf(superFarmRewarder.address)).to.equal(allocatedRewards);
            expect(await reward18a.balanceOf(OWNER.address)).to.equal(ownerBalance.add(initialFunding.sub(allocatedRewards)));
        });
        it('Owner can cancel a reward during an active period (without deposits)', async function() {
            await setTime(beginning + HOUR);
            await expect(superFarmRewarder.connect(OWNER).cancelReward(
                0,
                OWNER.address,
            )).not.to.be.reverted;

            expect(await superFarmRewarder.rewardInfos(0)).property('rewardRatePerSecond').to.equal(0);
            expect(await reward18a.balanceOf(superFarmRewarder.address)).to.equal(0);
            expect(await reward18a.balanceOf(OWNER.address)).to.equal(ownerBalance.add(initialFunding));
        });
        it('User with role can cancel a reward during an active period (with deposits)', async function() {
            const deposit = ethers.utils.parseUnits('100', 18);

            await setTime(beginning);
            await normalDeposit(0, addr1, deposit);

            await setTime(beginning + HOUR);
            await expect(superFarmRewarder.connect(userWithCancelRole).cancelReward(
                0,
                userWithCancelRole.address,
            )).not.to.be.reverted;

            const allocatedRewards = rewardRatePerSecond.mul(HOUR);
            expect(await superFarmRewarder.rewardInfos(0)).property('rewardRatePerSecond').to.equal(0);
            expect(await reward18a.balanceOf(superFarmRewarder.address)).to.equal(allocatedRewards);
            expect(await reward18a.balanceOf(userWithCancelRole.address)).to.equal(userBalance.add(initialFunding).sub(allocatedRewards));
        });
        it('User with role can cancel a reward during an active period (without deposits)', async function() {
            await setTime(beginning + HOUR);
            await expect(superFarmRewarder.connect(OWNER).cancelReward(
                0,
                OWNER.address,
            )).not.to.be.reverted;

            expect(await superFarmRewarder.rewardInfos(0)).property('rewardRatePerSecond').to.equal(0);
            expect(await reward18a.balanceOf(superFarmRewarder.address)).to.equal(0);
            expect(await reward18a.balanceOf(OWNER.address)).to.equal(ownerBalance.add(initialFunding));
        });
        it('Owner can cancel reward after expiration (without deposits)', async function() {
            await setTime(expiration);
            await expect(superFarmRewarder.connect(OWNER).cancelReward(
                0,
                OWNER.address,
            )).not.to.be.reverted;

            expect(await superFarmRewarder.rewardInfos(0)).property('rewardRatePerSecond').to.equal(0);
            expect(await reward18a.balanceOf(superFarmRewarder.address)).to.equal(0);
            expect(await reward18a.balanceOf(OWNER.address)).to.equal(ownerBalance.add(initialFunding));
        });
        it('User with role can cancel reward after expiration (without deposits)', async function() {
            await setTime(expiration);
            await expect(superFarmRewarder.connect(userWithCancelRole).cancelReward(
                0,
                userWithCancelRole.address,
            )).not.to.be.reverted;

            expect(await superFarmRewarder.rewardInfos(0)).property('rewardRatePerSecond').to.equal(0);
            expect(await reward18a.balanceOf(superFarmRewarder.address)).to.equal(0);
            expect(await reward18a.balanceOf(userWithCancelRole.address)).to.equal(userBalance.add(initialFunding));
        });
        it('Cannot cancel reward after expiration (with deposits)', async function() {
            const deposit = ethers.utils.parseUnits('100', 18);

            await setTime(beginning);
            await normalDeposit(0, addr1, deposit);

            await setTime(expiration);
            await expect(superFarmRewarder.connect(OWNER).cancelReward(
                0,
                OWNER.address,
            )).to.be.revertedWith('Fully allocated');
            await expect(superFarmRewarder.connect(userWithCancelRole).cancelReward(
                0,
                OWNER.address,
            )).to.be.revertedWith('Fully allocated');
        });
    });

    describe('Recover ERC20', async function() {
        let timestamp;
        let beginning, expiration;
        let trappedToken, trappedTokenAmount;
        beforeEach(async function() {
            timestamp = (await ethers.provider.getBlock()).timestamp;

            lp0.balanceOf.whenCalledWith(_miniChefV2.address).returns(0);

            beginning = timestamp + HOUR;
            expiration = beginning + WEEK;
            const unadjustedInitialFunding = ethers.utils.parseUnits('123456', 18);
            await addReward(reward18a, beginning, expiration, unadjustedInitialFunding);

            trappedToken = reward18b;
            trappedTokenAmount = ethers.utils.parseUnits('100', 18);
            await trappedToken.transfer(superFarmRewarder.address, trappedTokenAmount);
        });
        it('Owner can recover token to itself', async function() {
            const balanceBefore = await trappedToken.balanceOf(OWNER.address);
            await expect(superFarmRewarder.recoverERC20(trappedToken.address, OWNER.address)).to.not.be.reverted;
            expect(await trappedToken.balanceOf(superFarmRewarder.address)).to.equal(0);
            expect(await trappedToken.balanceOf(OWNER.address)).to.equal(balanceBefore.add(trappedTokenAmount));
        });
        it('Owner can recover token to another address', async function() {
            await expect(superFarmRewarder.recoverERC20(trappedToken.address, addr1.address)).to.not.be.reverted;
            expect(await trappedToken.balanceOf(superFarmRewarder.address)).to.equal(0);
            expect(await trappedToken.balanceOf(addr1.address)).to.equal(trappedTokenAmount);
        });
        it('Owner cannot recover reward token', async function() {
            await expect(superFarmRewarder.recoverERC20(
                reward18a.address,
                OWNER.address,
            )).to.be.revertedWith('Cannot recover reward asset');
            expect(await trappedToken.balanceOf(superFarmRewarder.address)).to.equal(trappedTokenAmount);
        });
        it('Non-owner cannot recover token', async function() {
            await expect(superFarmRewarder.connect(addr1).recoverERC20(
                trappedToken.address,
                addr1.address,
            )).to.be.revertedWith('Ownable: caller is not the owner');
            expect(await trappedToken.balanceOf(superFarmRewarder.address)).to.equal(trappedTokenAmount);
        });
    });

    describe('Reward info', async function() {
        let timestamp;
        let beginning, expiration, funding;
        beforeEach(async function() {
            timestamp = (await ethers.provider.getBlock()).timestamp;

            lp0.balanceOf.whenCalledWith(_miniChefV2.address).returns(0);

            beginning = timestamp + HOUR;
            expiration = beginning + WEEK;
            funding = ethers.utils.parseUnits('100000', 18);
        });
        it('Shows info on one reward', async function() {
            await addReward(reward18a, beginning, expiration, funding);
            const info1 = await superFarmRewarder.rewardInfos(0);
            expect(info1.reward).to.equal(reward18a.address);
            expect(info1.rewardRatePerSecond).to.be.gt(0);
            expect(info1.accRewardPerShare).to.equal(0);
            expect(info1.beginning).to.equal(beginning);
            expect(info1.expiration).to.equal(expiration);
        });
        it('Shows info on multiple rewards', async function() {
            await addReward(reward18a, beginning, expiration, funding);
            await addReward(reward18b, beginning, expiration, funding);
            const info1 = await superFarmRewarder.rewardInfos(0);
            const info2 = await superFarmRewarder.rewardInfos(1);
            expect(info1.reward).to.equal(reward18a.address);
            expect(info2.reward).to.equal(reward18b.address);
        });
    });

    describe('Allocations', async function() {
        let reward, beginning, expiration, initialFunding, rewardRatePerSecond;
        let totalDeposited;
        let rewardDecimals, margin;

        afterEach(enableAutomine);

        describe('Reward with 18 decimals', async function() {
            beforeEach(async function() {
                reward = reward18a;
                rewardDecimals = 18;
                margin = ethers.utils.parseUnits('1', 5); // fraction of a token
            });

            await itPassesAllocationTests();
        });

        describe('Reward with 6 decimals', async function() {
            beforeEach(async function() {
                reward = reward6;
                rewardDecimals = 6;
                margin = ethers.utils.parseUnits('1', 0); // fraction of a token
            });

            await itPassesAllocationTests();
        });

        async function itPassesAllocationTests() {
            beforeEach(async function() {
                const timestamp = (await ethers.provider.getBlock()).timestamp;

                beginning = timestamp + HOUR;
                expiration = beginning + WEEK;
                const duration = expiration - beginning;
                const unadjustedInitialFunding = ethers.utils.parseUnits('230000000', rewardDecimals);
                rewardRatePerSecond = unadjustedInitialFunding.div(duration);
                await addReward(reward, beginning, expiration, unadjustedInitialFunding);
                initialFunding = await reward.balanceOf(superFarmRewarder.address);

                totalDeposited = ethers.utils.parseUnits('0');
                lp0.balanceOf.whenCalledWith(_miniChefV2.address).returns(totalDeposited);
            });
            it('User deposits once', async function () {
                const deposit = ethers.utils.parseUnits('100000', rewardDecimals);

                await setTime(beginning);
                await normalDeposit(0, addr1, deposit);

                await mineBlock(beginning + MINUTE);

                const pendingTokens = await superFarmRewarder.pendingTokens(0, addr1.address, 0);
                let expected = rewardRatePerSecond.mul(MINUTE);
                expect(pendingTokens.rewardAmounts[0]).to.be.within(expected.sub(margin), expected);

                await expect(superFarmRewarder.connect(addr1).forceClaimRewards(
                    [0],
                    addr1.address,
                )).to.emit(superFarmRewarder, 'RewardPaid');
                expected = expected.add(rewardRatePerSecond);
                expect(await reward.balanceOf(addr1.address)).to.be.within(expected.sub(margin), expected);
            });
            it('User deposits once before period begins', async function () {
                const deposit = ethers.utils.parseUnits('100', rewardDecimals);
                await setTime(beginning - MINUTE);
                await normalDeposit(0, addr1, deposit);

                await mineBlock(beginning + MINUTE);

                const pendingTokens = await superFarmRewarder.pendingTokens(0, addr1.address, 0);
                let expected = rewardRatePerSecond.mul(MINUTE);
                expect(pendingTokens.rewardAmounts[0]).to.be.within(expected.sub(margin), expected);

                await expect(superFarmRewarder.connect(addr1).forceClaimRewards(
                    [0],
                    addr1.address,
                )).to.emit(superFarmRewarder, 'RewardPaid');
                expected = expected.add(rewardRatePerSecond);
                expect(await reward.balanceOf(addr1.address)).to.be.within(expected.sub(margin), expected);
            });
            it('User deposits once after period begins', async function () {
                const deposit = ethers.utils.parseUnits('1000', rewardDecimals);
                await setTime(beginning + MINUTE);
                await normalDeposit(0, addr1, deposit);

                await mineBlock(beginning + MINUTE + HOUR);

                const pendingTokens = await superFarmRewarder.pendingTokens(0, addr1.address, 0);
                let expected = rewardRatePerSecond.mul(HOUR);
                expect(pendingTokens.rewardAmounts[0]).to.be.within(expected.sub(margin), expected);

                await expect(superFarmRewarder.connect(addr1).forceClaimRewards(
                    [0],
                    addr1.address,
                )).to.emit(superFarmRewarder, 'RewardPaid');
                expected = expected.add(rewardRatePerSecond);
                expect(await reward.balanceOf(addr1.address)).to.be.within(expected.sub(margin), expected);
            });
            it('User deposits once after period expires', async function () {
                const deposit = ethers.utils.parseUnits('1000', rewardDecimals);
                await setTime(expiration + MINUTE);
                await normalDeposit(0, addr1, deposit);

                await mineBlock(expiration + MINUTE + MINUTE);

                const pendingTokens = await superFarmRewarder.pendingTokens(0, addr1.address, 0);
                expect(pendingTokens.rewardAmounts[0]).to.equal(0);

                await expect(superFarmRewarder.connect(addr1).forceClaimRewards(
                    [0],
                    addr1.address,
                )).not.to.emit(superFarmRewarder, 'RewardPaid');
                expect(await reward.balanceOf(addr1.address)).to.equal(0);
            });
            it('User deposits twice with one reward', async function () {
                const deposit1 = ethers.utils.parseUnits('2000', rewardDecimals);
                const deposit2 = ethers.utils.parseUnits('1000', rewardDecimals);

                // First deposit
                totalDeposited = totalDeposited.add(deposit1);
                await setTime(beginning);
                await normalDeposit(0, addr1, totalDeposited);

                // Second deposit (after one minute)
                totalDeposited = totalDeposited.add(deposit2);
                await setTime(beginning + MINUTE);
                await normalDeposit(0, addr1, totalDeposited);

                // Wait another minute
                await mineBlock(beginning + MINUTE + MINUTE);

                const pending = await superFarmRewarder.pendingTokens(0, addr1.address, 0);
                let expected = rewardRatePerSecond.mul(MINUTE + MINUTE);
                expect(pending.rewardAmounts[0]).to.be.within(expected.sub(margin), expected);

                await expect(superFarmRewarder.connect(addr1).forceClaimRewards(
                    [0],
                    addr1.address,
                )).to.emit(superFarmRewarder, 'RewardPaid');
                expected = expected.add(rewardRatePerSecond);
                expect(await reward.balanceOf(addr1.address)).to.be.within(expected.sub(margin), expected);
            });
            it('User deposits and then withdraws', async function () {
                const deposit1 = ethers.utils.parseUnits('250', rewardDecimals);
                const withdrawal1 = ethers.utils.parseUnits('100', rewardDecimals);

                // Deposit
                totalDeposited = totalDeposited.add(deposit1);
                await setTime(beginning);
                await normalDeposit(0, addr1, totalDeposited);

                // Withdraw (after one minute)
                totalDeposited = totalDeposited.sub(withdrawal1);
                await setTime(beginning + MINUTE);
                await normalDeposit(0, addr1, totalDeposited);

                // Wait another minute
                await mineBlock(beginning + MINUTE + MINUTE);

                const pending = await superFarmRewarder.pendingTokens(0, addr1.address, 0);
                let expected = rewardRatePerSecond.mul(MINUTE + MINUTE);
                expect(pending.rewardAmounts[0]).to.be.within(expected.sub(margin), expected);

                await expect(superFarmRewarder.connect(addr1).forceClaimRewards(
                    [0],
                    addr1.address,
                )).to.emit(superFarmRewarder, 'RewardPaid');
                expected = expected.add(rewardRatePerSecond);
                expect(await reward.balanceOf(addr1.address)).to.be.within(expected.sub(margin), expected);
            });
            it('User deposits and then harvests', async function () {
                const deposit1 = ethers.utils.parseUnits('2500', rewardDecimals);

                // Deposit
                totalDeposited = totalDeposited.add(deposit1);
                await setTime(beginning);
                await normalDeposit(0, addr1, totalDeposited);

                const priorBalance = await reward.balanceOf(addr1.address);

                // Harvest (after one minute)
                await setTime(beginning + MINUTE);
                await expect(superFarmRewarder.connect(chef).onReward(
                    0,
                    addr1.address,
                    addr1.address,
                    10, // non-zero means harvest
                    totalDeposited,
                )).to.emit(superFarmRewarder, 'RewardPaid');
                lp0.balanceOf.whenCalledWith(_miniChefV2.address).returns(totalDeposited);

                const expectedRewards = rewardRatePerSecond.mul(MINUTE);
                const expectedFinalBalance = priorBalance.add(expectedRewards);
                expect(await reward.balanceOf(addr1.address)).to.be.within(expectedFinalBalance.sub(margin), expectedFinalBalance);

                const pending = await superFarmRewarder.pendingTokens(0, addr1.address, 0);
                expect(pending.rewardAmounts[0]).to.equal(0);
            });
            it('User deposits and then forcibly claims', async function () {
                const deposit1 = ethers.utils.parseUnits('2500', rewardDecimals);

                // Deposit
                totalDeposited = totalDeposited.add(deposit1);
                await setTime(beginning);
                await normalDeposit(0, addr1, totalDeposited);

                const priorBalance = await reward.balanceOf(addr1.address);

                // Force claim (after one minute)
                await setTime(beginning + MINUTE);
                await expect(superFarmRewarder.connect(addr1).forceClaimRewards(
                    [0],
                    addr1.address,
                )).to.emit(superFarmRewarder, 'RewardPaid');
                lp0.balanceOf.whenCalledWith(_miniChefV2.address).returns(totalDeposited);

                const expectedRewards = rewardRatePerSecond.mul(MINUTE);
                const expectedFinalBalance = priorBalance.add(expectedRewards);
                expect(await reward.balanceOf(addr1.address)).to.be.within(expectedFinalBalance.sub(margin), expectedFinalBalance);

                const pending = await superFarmRewarder.pendingTokens(0, addr1.address, 0);
                expect(pending.rewardAmounts[0]).to.equal(0);
            });
            it('Multiple users deposit', async function () {
                await disableAutomine();

                // Deposit tokens (25% / 75%)
                const deposit1 = ethers.utils.parseUnits('100', rewardDecimals);
                const deposit2 = ethers.utils.parseUnits('300', rewardDecimals);

                await expect(superFarmRewarder.connect(chef).onReward(
                    0,
                    addr1.address,
                    addr1.address,
                    0,
                    deposit1,
                )).not.to.be.reverted;
                await expect(superFarmRewarder.connect(chef).onReward(
                    0,
                    addr2.address,
                    addr2.address,
                    0,
                    deposit2,
                )).not.to.be.reverted;

                await mineBlock(beginning);

                totalDeposited = totalDeposited.add(deposit1).add(deposit2);
                lp0.balanceOf.whenCalledWith(_miniChefV2.address).returns(totalDeposited);

                await mineBlock(beginning + HOUR);

                // User1
                const pendingTokens1 = await superFarmRewarder.pendingTokens(0, addr1.address, 0);
                const expected1 = rewardRatePerSecond.mul(HOUR).mul(100).div(400);
                expect(pendingTokens1.rewardAmounts[0]).to.be.within(expected1.sub(margin), expected1);

                // User2
                const pendingTokens2 = await superFarmRewarder.pendingTokens(0, addr2.address, 0);
                const expected2 = rewardRatePerSecond.mul(HOUR).mul(300).div(400);
                expect(pendingTokens2.rewardAmounts[0]).to.be.within(expected2.sub(margin), expected2);

                // User1 force claim
                await expect(superFarmRewarder.connect(addr1).forceClaimRewards(
                    [0],
                    addr1.address,
                )).not.to.be.reverted;

                // User2 force claim
                await expect(superFarmRewarder.connect(addr2).forceClaimRewards(
                    [0],
                    addr2.address,
                )).not.to.be.reverted;

                // Mine both `forceClaimRewards` txs
                await mineBlock(beginning + HOUR + 1);

                const expected1PlusSecond = rewardRatePerSecond.mul(HOUR + 1).mul(100).div(400);
                expect(await reward.balanceOf(addr1.address)).to.be.within(expected1PlusSecond.sub(margin), expected1PlusSecond);
                const expected2PlusSecond = rewardRatePerSecond.mul(HOUR + 1).mul(300).div(400);
                expect(await reward.balanceOf(addr2.address)).to.be.within(expected2PlusSecond.sub(margin), expected2PlusSecond);
            });
            it('Multiple users deposit and withdraw', async function () {
                await disableAutomine();

                // Both users deposit tokens (25% / 75%)
                const deposit1 = ethers.utils.parseUnits('100', rewardDecimals);
                const deposit2 = ethers.utils.parseUnits('300', rewardDecimals);

                await expect(superFarmRewarder.connect(chef).onReward(
                    0,
                    addr1.address,
                    addr1.address,
                    0,
                    deposit1,
                )).not.to.be.reverted;
                await expect(superFarmRewarder.connect(chef).onReward(
                    0,
                    addr2.address,
                    addr2.address,
                    0,
                    deposit2,
                )).not.to.be.reverted;
                await mineBlock(beginning);
                totalDeposited = totalDeposited.add(deposit1).add(deposit2);
                lp0.balanceOf.whenCalledWith(_miniChefV2.address).returns(totalDeposited);

                // User2 withdraws (one hour later)
                await expect(superFarmRewarder.connect(chef).onReward(
                    0,
                    addr2.address,
                    addr2.address,
                    0, // No harvest
                    0, // Withdraw 100%
                )).not.to.be.reverted;
                await mineBlock(beginning + HOUR);
                totalDeposited = totalDeposited.sub(deposit2);
                lp0.balanceOf.whenCalledWith(_miniChefV2.address).returns(totalDeposited);

                // Wait another hour
                await mineBlock(beginning + HOUR + HOUR);

                // User1 (never withdrew)
                const pendingTokens1 = await superFarmRewarder.pendingTokens(0, addr1.address, 0);
                const expected1a = rewardRatePerSecond.mul(HOUR).mul(100).div(400); // Sharing rewards
                const expected1b = rewardRatePerSecond.mul(HOUR).mul(400).div(400); // Full rewards
                const expected1 = expected1a.add(expected1b);
                expect(pendingTokens1.rewardAmounts[0]).to.be.within(expected1.sub(margin), expected1);

                // User2 (withdrew halfway)
                const pendingTokens2 = await superFarmRewarder.pendingTokens(0, addr2.address, 0);
                const expected2a = rewardRatePerSecond.mul(HOUR).mul(300).div(400); // Sharing rewards
                const expected2b = 0; // No rewards
                const expected2 = expected2a.add(expected2b);
                expect(pendingTokens2.rewardAmounts[0]).to.be.within(expected2.sub(margin), expected2);

                // User1 force claim
                await expect(superFarmRewarder.connect(addr1).forceClaimRewards(
                    [0],
                    addr1.address,
                )).not.to.be.reverted;

                // User2 force claim
                await expect(superFarmRewarder.connect(addr2).forceClaimRewards(
                    [0],
                    addr2.address,
                )).not.to.be.reverted;

                // Mine both `forceClaimRewards` txs
                await mineBlock(beginning + HOUR + HOUR + 1);

                const expected1bPlusSecond = rewardRatePerSecond.mul(HOUR + 1).mul(400).div(400); // Full rewards
                const expected1PlusSecond = expected1a.add(expected1bPlusSecond);
                expect(await reward.balanceOf(addr1.address)).to.be.within(expected1PlusSecond.sub(margin), expected1PlusSecond);
                expect(await reward.balanceOf(addr2.address)).to.be.within(expected2.sub(margin), expected2);
            });
            it('Does not transfer reward on non-harvest', async function () {
                const deposit1 = ethers.utils.parseUnits('10', rewardDecimals);
                const deposit2 = ethers.utils.parseUnits('20', rewardDecimals);

                // Deposit
                await setTime(beginning);
                totalDeposited = totalDeposited.add(deposit1);
                await normalDeposit(0, addr1, totalDeposited, 0);

                // Deposit again
                await setTime(beginning + HOUR);
                totalDeposited = totalDeposited.add(deposit2);
                await expect(superFarmRewarder.connect(chef).onReward(
                    0,
                    addr1.address,
                    addr1.address,
                    0, // No rewards
                    totalDeposited,
                )).not.to.emit(superFarmRewarder, 'RewardPaid');
            });
        }
    });

    async function normalDeposit(pid, user, totalDeposited, rewardAmount = 0, lp = lp0) {
        await expect(superFarmRewarder.connect(chef).onReward(
            pid,
            user.address,
            user.address,
            rewardAmount,
            totalDeposited,
        )).not.to.be.reverted;
        lp.balanceOf.whenCalledWith(_miniChefV2.address).returns(totalDeposited);
    }

    async function addReward(reward, beginning, expiration, amount) {
        await superFarmRewarder.connect(OWNER).addReward(
            reward.address,
            amount,
            beginning,
            expiration,
        );
    }
});

async function setTime(time) {
    await ethers.provider.send('evm_setNextBlockTimestamp', [time]);
}

async function mineBlock(time) {
    if (time) await setTime(time);
    await ethers.provider.send('evm_mine');
}

async function enableAutomine() {
    await ethers.provider.send('evm_setAutomine', [true]);
}

async function disableAutomine() {
    await ethers.provider.send('evm_setAutomine', [false]);
}

async function permit(token, spender, owner, amount = ethers.constants.MaxUint256) {
    return token.connect(owner).approve(spender, amount);
}

function keccak256(value) {
    return ethers.utils.keccak256(ethers.utils.toUtf8Bytes(value));
}
