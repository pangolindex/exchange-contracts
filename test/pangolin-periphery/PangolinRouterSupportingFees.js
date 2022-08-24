const { smock } = require('@defi-wonderland/smock');
const { ethers, network } = require('hardhat');
const chai = require('chai');
chai.use(smock.matchers);
const { expect } = chai;

describe('PangolinRouterSupportingFees', function() {
    const BIPS = 10_000;

    let OWNER, user1, user2, user3;
    let PangolinRouterSupportingFees, PangolinFactory, PangolinPair, _Token, _Wavax;
    let router, pangolinFactory;
    let wavax, tokenA, tokenB;

    before(async function() {
        [ OWNER, user1, user2, user3 ] = await ethers.getSigners();

        PangolinRouterSupportingFees = await ethers.getContractFactory('PangolinRouterSupportingFees');
        PangolinFactory = await ethers.getContractFactory('PangolinFactory');
        PangolinPair = await ethers.getContractFactory('PangolinPair');

        _Token = await smock.mock('Png');
        _Wavax = await smock.mock('WAVAX');
    });

    beforeEach(async function() {
        pangolinFactory = await PangolinFactory.deploy(OWNER.address);
        await pangolinFactory.deployed();

        wavax = await _Wavax.deploy();
        await wavax.deployed();

        tokenA = await _Token.deploy(
            ethers.utils.parseEther('100000000'), // _maxSupply
            ethers.utils.parseEther('100000000'), // initialSupply
            'TOKA', // _symbol
            'Token A', // _name
        );
        await tokenA.deployed();

        tokenB = await _Token.deploy(
            ethers.utils.parseEther('100000000'), // _maxSupply
            ethers.utils.parseEther('100000000'), // initialSupply
            'TOKB', // _symbol
            'Token B', // _name
        );
        await tokenB.deployed();

        router = await PangolinRouterSupportingFees.deploy(
            pangolinFactory.address,
            wavax.address,
            OWNER.address,
        );
        await router.deployed();
    });

    describe('Permissions', async function() {
        let partner, manager, nonOwner;

        beforeEach(async function() {
            partner = user1;
            manager = user2;
            nonOwner = user3;
        });

        describe('Partner activation', async function() {
            it('Defaults to not active', async function() {
                const feeInfo = await getFeeInfo(partner.address);
                expect(feeInfo.initialized).to.be.false;
            });
            it('Owner can activate partner', async function() {
                await expect(router.connect(OWNER).activatePartner(
                    partner.address,
                )).to.emit(router, 'PartnerActivated');
                const feeInfo = await getFeeInfo(partner.address);
                expect(feeInfo.initialized).to.be.true;
                expect(feeInfo.feeCut).to.equal(50_00);
            });
            it('Non-owner can activate partner', async function() {
                await expect(router.connect(nonOwner).activatePartner(
                    partner.address,
                )).to.emit(router, 'PartnerActivated');
                const feeInfo = await getFeeInfo(partner.address);
                expect(feeInfo.initialized).to.be.true;
                expect(feeInfo.feeCut).to.equal(50_00);
            });
            it('Fee floor is applied', async function() {
                const feeFloor = 10;
                await router.connect(OWNER).modifyFeeFloor(feeFloor);

                await expect(router.connect(OWNER).activatePartner(
                    partner.address,
                )).to.emit(router, 'PartnerActivated');
                const feeInfo = await getFeeInfo(partner.address);
                expect(feeInfo.initialized).to.be.true;
                expect(feeInfo.feeTotal).to.equal(feeFloor);
                expect(feeInfo.feePartner).to.be.greaterThan(0);
                expect(feeInfo.feeProtocol).to.be.greaterThan(0);
            });
        });

        describe('Managers', async function() {
            beforeEach(async function() {
                await router.connect(OWNER).activatePartner(partner.address);
            });

            it('Owner can alter managers', async function() {
                await expect(router.connect(OWNER).modifyManagement(
                    partner.address,
                    manager.address,
                    true,
                )).to.emit(router, 'ManagerChange');
                expect(await router.managers(partner.address, manager.address)).to.be.true;
                await expect(router.connect(OWNER).modifyManagement(
                    partner.address,
                    manager.address,
                    false,
                )).to.emit(router, 'ManagerChange');
                expect(await router.managers(partner.address, manager.address)).to.be.false;
            });
            it('Non-owner can not alter managers', async function() {
                await expect(router.connect(nonOwner).modifyManagement(
                    partner.address,
                    manager.address,
                    true,
                )).to.be.revertedWith('Permission denied');
                expect(await router.managers(partner.address, manager.address)).to.be.false;
                await expect(router.connect(nonOwner).modifyManagement(
                    partner.address,
                    manager.address,
                    false,
                )).to.be.revertedWith('Permission denied');
                expect(await router.managers(partner.address, manager.address)).to.be.false;
            });
            it('Partner can alter own managers', async function() {
                await expect(router.connect(partner).modifyManagement(
                    partner.address,
                    manager.address,
                    true,
                )).not.to.be.reverted;
                expect(await router.managers(partner.address, manager.address)).to.be.true;
                await expect(router.connect(partner).modifyManagement(
                    partner.address,
                    manager.address,
                    false,
                )).not.to.be.reverted;
                expect(await router.managers(partner.address, manager.address)).to.be.false;
            });
            it('Partner can not alter other managers', async function() {
                const otherPartner = nonOwner;
                await expect(router.connect(partner).modifyManagement(
                    otherPartner.address,
                    manager.address,
                    true,
                )).to.be.revertedWith('Permission denied');
                expect(await router.managers(otherPartner.address, manager.address)).to.be.false;
                await expect(router.connect(partner).modifyManagement(
                    otherPartner.address,
                    manager.address,
                    false,
                )).to.be.revertedWith('Permission denied');
                expect(await router.managers(otherPartner.address, manager.address)).to.be.false;
            });
            it('Cannot alter managers of un-initialized partner', async function() {
                await expect(router.connect(OWNER).modifyManagement(
                    nonOwner.address,
                    manager.address,
                    true,
                )).to.be.revertedWith('Not initialized');
            });
        });

        describe('Total fee changes', async function() {
            beforeEach(async function() {
                // Activate partner
                await router.connect(OWNER).activatePartner(partner.address);

                // Enable manager
                router.connect(OWNER).modifyManagement(
                    partner.address,
                    manager.address,
                    true,
                );
            });
            it('Total fee defaults to 0', async function() {
                const feeInfo = await getFeeInfo(partner.address);
                expect(feeInfo.feeTotal).to.equal(0);
            });
            it('Owner can change total fee', async function() {
                const feeTotal = 1_00;
                await expect(router.connect(OWNER).modifyTotalFee(
                    partner.address,
                    feeTotal,
                )).to.emit(router, 'FeeChange');
                const feeInfo = await getFeeInfo(partner.address);
                expect(feeInfo.feeTotal).to.equal(1_00);
            });
            it('Partner can change total fee', async function() {
                const feeTotal = 1_00;
                await expect(router.connect(partner).modifyTotalFee(
                    partner.address,
                    feeTotal,
                )).to.emit(router, 'FeeChange');
                const feeInfo = await getFeeInfo(partner.address);
                expect(feeInfo.feeTotal).to.equal(1_00);
            });
            it('Manager can change total fee', async function() {
                const feeTotal = 1_00;
                await expect(router.connect(manager).modifyTotalFee(
                    partner.address,
                    feeTotal,
                )).to.emit(router, 'FeeChange');
                const feeInfo = await getFeeInfo(partner.address);
                expect(feeInfo.feeTotal).to.equal(1_00);
            });
            it('Random user can not change total fee', async function() {
                const feeTotal = 1_00;
                await expect(router.connect(nonOwner).modifyTotalFee(
                    partner.address,
                    feeTotal,
                )).to.be.revertedWith('Permission denied');
            });
            it('Total fee cannot exceed 2%', async function() {
                const feeTotal = 2_00 + 1;
                await expect(router.connect(manager).modifyTotalFee(
                    partner.address,
                    feeTotal,
                )).to.be.revertedWith('Excessive total fee');
            });
            it('Cannot change total fee of un-initialized partner', async function() {
                const feeTotal = 1_00;
                await expect(router.connect(OWNER).modifyTotalFee(
                    nonOwner.address,
                    feeTotal,
                )).to.be.revertedWith('Not initialized');
            });
            it('Total fee must exceed fee floor', async function() {
                const feeFloor = 10;
                await router.connect(OWNER).modifyFeeFloor(feeFloor);

                const feeTotal = feeFloor - 1;
                await expect(router.connect(manager).modifyTotalFee(
                    partner.address,
                    feeTotal,
                )).to.be.revertedWith('Insufficient total fee');
            });
        });

        describe('Fee cut changes', async function() {
            beforeEach(async function() {
                // Activate partner
                await router.connect(OWNER).activatePartner(partner.address);

                // Enable manager
                router.connect(OWNER).modifyManagement(
                    partner.address,
                    manager.address,
                    true,
                );
            });

            it('Protocol fee cut is effectively 50% by default', async function() {
                const feeTotal = 1_00;
                await expect(router.connect(OWNER).modifyTotalFee(
                    partner.address,
                    feeTotal,
                )).to.emit(router, 'FeeChange');
                const feeInfo = await getFeeInfo(partner.address);
                expect(feeInfo.feeCut).to.equal(50_00);
                expect(feeInfo.feePartner).to.equal(50);
                expect(feeInfo.feeProtocol).to.equal(50);
            });
            it('Owner can modify fee cut to 25%', async function() {
                const feeTotal = 1_00;
                await expect(router.connect(OWNER).modifyFeeCut(
                    partner.address,
                    25_00,
                )).to.emit(router, 'FeeChange');
                await expect(router.connect(OWNER).modifyTotalFee(
                    partner.address,
                    feeTotal,
                )).to.emit(router, 'FeeChange');
                const feeInfo = await getFeeInfo(partner.address);
                expect(feeInfo.feeCut).to.equal(25_00);
                expect(feeInfo.feePartner).to.equal(75);
                expect(feeInfo.feeProtocol).to.equal(25);
            });
            it('Owner can modify fee cut to 0%', async function() {
                const feeTotal = 1_00;
                await expect(router.connect(OWNER).modifyFeeCut(
                    partner.address,
                    5_00,
                )).to.emit(router, 'FeeChange');
                await expect(router.connect(OWNER).modifyFeeCut(
                    partner.address,
                    0,
                )).to.emit(router, 'FeeChange');
                await expect(router.connect(OWNER).modifyTotalFee(
                    partner.address,
                    feeTotal,
                )).to.emit(router, 'FeeChange');
                const feeInfo = await getFeeInfo(partner.address);
                expect(feeInfo.feeCut).to.equal(0);
                expect(feeInfo.feePartner).to.equal(1_00);
                expect(feeInfo.feeProtocol).to.equal(0);
            });
            it('Fee cut can not exceed 50%', async function() {
                await expect(router.connect(OWNER).modifyFeeCut(
                    partner.address,
                    50_00 + 1,
                )).to.be.revertedWith('Excessive fee cut');
            });
            it('Manager can not modify fee cut', async function() {
                await expect(router.connect(manager).modifyFeeCut(
                    partner.address,
                    25_00,
                )).to.be.revertedWith('Permission denied');
            });
            it('Partner can not modify fee cut', async function() {
                await expect(router.connect(partner).modifyFeeCut(
                    partner.address,
                    25_00,
                )).to.be.revertedWith('Permission denied');
            });
            it('Cannot change fee cut of un-initialized partner', async function() {
                await expect(router.connect(OWNER).modifyFeeCut(
                    nonOwner.address,
                    25_00,
                )).to.be.revertedWith('Not initialized');
            });
        });

        describe('Fee floor changes', async function() {
            it('Fee floor is 0% by default', async function() {
                expect(await router.FEE_FLOOR()).to.equal(0);
            });
            it('Owner can modify fee floor to 0.30%', async function() {
                const feeFloor = 30;
                await expect(router.connect(OWNER).modifyFeeFloor(
                    feeFloor,
                )).to.emit(router, 'FeeFloorChange');
                expect(await router.FEE_FLOOR()).to.equal(feeFloor);
            });
            it('Fee cut can not exceed 0.30%', async function() {
                const feeFloor = 30 + 1;
                await expect(router.connect(OWNER).modifyFeeFloor(
                    feeFloor,
                )).to.be.revertedWith('Excessive fee floor');
            });
            it('Owner can modify fee floor to 0%', async function() {
                await expect(router.connect(OWNER).modifyFeeFloor(
                    30,
                )).to.emit(router, 'FeeFloorChange');
                expect(await router.FEE_FLOOR()).to.equal(30);
                await expect(router.connect(OWNER).modifyFeeFloor(
                    0,
                )).to.emit(router, 'FeeFloorChange');
                expect(await router.FEE_FLOOR()).to.equal(0);
            });
            it('Non-owner cannot modify fee cut', async function() {
                await expect(router.connect(nonOwner).modifyFeeFloor(
                    10,
                )).to.be.revertedWith('Permission denied');
            });
        });
    });

    describe('Swapping', async function() {
        const partnerInitialized = '0x0000000000000000000000000000000000000001';
        const partnerUnInitialized = '0x0000000000000000000000000000000000000002';
        let liquidityA = ethers.utils.parseEther('5000000');
        let liquidityB = ethers.utils.parseEther('1000000');
        let previousFeesB = ethers.utils.parseEther('4000');
        let liquidityW = ethers.utils.parseEther('2000');
        let previousFeesW = ethers.utils.parseEther('40');
        let deadline;
        let feeTotal, feeCut;

        describe('2% total fee and 50% cut', async function() {
            beforeEach(async function() {
                // Activate partner
                await router.connect(OWNER).activatePartner(partnerInitialized);

                feeTotal = 2_00;
                feeCut = 50_00;
                await router.connect(OWNER).modifyTotalFee(
                    partnerInitialized,
                    feeTotal,
                );
                deadline = Math.ceil(Date.now() / 1000) + 60;
            });

            testSwapMethods();
        });

        describe('2% total fee and 25% cut', async function() {
            beforeEach(async function() {
                // Activate partner
                await router.connect(OWNER).activatePartner(partnerInitialized);

                feeTotal = 2_00;
                feeCut = 25_00;
                await router.connect(OWNER).modifyTotalFee(
                    partnerInitialized,
                    feeTotal,
                );
                await router.connect(OWNER).modifyFeeCut(
                    partnerInitialized,
                    feeCut,
                );
                deadline = Math.ceil(Date.now() / 1000) + 60;
            });

            testSwapMethods();
        });

        describe('2% total fee and 0% cut', async function() {
            beforeEach(async function() {
                // Activate partner
                await router.connect(OWNER).activatePartner(partnerInitialized);

                feeTotal = 2_00;
                feeCut = 0;
                await router.connect(OWNER).modifyTotalFee(
                    partnerInitialized,
                    feeTotal,
                );
                await router.connect(OWNER).modifyFeeCut(
                    partnerInitialized,
                    feeCut,
                );
                deadline = Math.ceil(Date.now() / 1000) + 60;
            });

            testSwapMethods();
        });

        describe('0% total fee and 50% cut (default)', async function() {
            beforeEach(async function() {
                // Activate partner
                await router.connect(OWNER).activatePartner(partnerInitialized);

                feeTotal = 0;
                feeCut = 50_00;
                deadline = Math.ceil(Date.now() / 1000) + 60;
            });

            testSwapMethods();
        });

        function testSwapMethods() {
            describe('swapExactTokensForTokens', async function() {
                let pair, actualAmountOut;

                beforeEach(async function() {
                    pair = await createPair(tokenA, tokenB, pangolinFactory);
                    await addLiquidity(pair, tokenA, liquidityA, tokenB, liquidityB, OWNER, OWNER);
                    await approve(OWNER, tokenA, router.address);
                    await tokenB.transfer(router.address, previousFeesB);

                    const path = [tokenA.address, tokenB.address];
                    const amountIn = ethers.utils.parseEther('100');
                    const amounts = await router.getAmountsOut(amountIn, path);
                    actualAmountOut = amounts[1];
                    const amountOutAdjusted = actualAmountOut.mul(BIPS - feeTotal).div(BIPS);
                    await expect(router.swapExactTokensForTokens(
                        amountIn.toString(),
                        amountOutAdjusted.toString(),
                        path,
                        OWNER.address,
                        deadline,
                        partnerInitialized,
                    )).not.to.be.reverted;
                });

                it('Cannot swap with un-initialized partner', async function() {
                    await expect(router.swapExactTokensForTokens(
                        ethers.utils.parseEther('1'),
                        0,
                        [tokenA.address, tokenB.address],
                        OWNER.address,
                        deadline,
                        partnerUnInitialized,
                    )).to.be.revertedWith('Invalid partner');
                });
                it('Transfers protocol fee', async function() {
                    const { protocolFee } = getFees(actualAmountOut, feeTotal, feeCut);
                    expect(await tokenB.balanceOf(router.address)).to.equal(protocolFee.add(previousFeesB));
                });
                it('Transfers partner fee', async function() {
                    const { partnerFee } = getFees(actualAmountOut, feeTotal, feeCut);
                    expect(await tokenB.balanceOf(partnerInitialized)).to.equal(partnerFee);
                });
                it('Transfers swap output', async function() {
                    const { totalFee, partnerFee } = getFees(actualAmountOut, feeTotal, feeCut);
                    const userAmount = actualAmountOut.sub(totalFee);
                    // tokenB.transfer 0: provide liquidity
                    // tokenB.transfer 1: seed previous fees
                    // tokenB.transfer 2: from pair to router
                    let transferCount = 3;
                    // tokenB.transfer: partner fee transfer
                    if (partnerFee.gt(0)) transferCount++;
                    const userTransfer = tokenB.transfer.getCall(transferCount);
                    expect(userTransfer.args[0]).to.equal(OWNER.address);
                    expect(userTransfer.args[1]).to.equal(userAmount);
                });
            });

            describe('swapTokensForExactTokens', async function() {
                let pair, desiredAmountOut, actualAmountOut;

                beforeEach(async function() {
                    pair = await createPair(tokenA, tokenB, pangolinFactory);
                    await addLiquidity(pair, tokenA, liquidityA, tokenB, liquidityB, OWNER, OWNER);
                    await approve(OWNER, tokenA, router.address);
                    await tokenB.transfer(router.address, previousFeesB);

                    const path = [tokenA.address, tokenB.address];
                    desiredAmountOut = ethers.utils.parseEther('100');
                    actualAmountOut = desiredAmountOut.mul(BIPS + feeTotal).div(BIPS);
                    const amounts = await router.getAmountsIn(actualAmountOut, path);
                    await expect(router.swapTokensForExactTokens(
                        desiredAmountOut.toString(),
                        amounts[0].toString(),
                        path,
                        OWNER.address,
                        deadline,
                        partnerInitialized,
                    )).not.to.be.reverted;
                });

                it('Cannot swap with un-initialized partner', async function() {
                    await expect(router.swapTokensForExactTokens(
                        ethers.utils.parseEther('10'),
                        0,
                        [tokenA.address, tokenB.address],
                        OWNER.address,
                        deadline,
                        partnerUnInitialized,
                    )).to.be.revertedWith('Invalid partner');
                });
                it('Transfers protocol fee', async function() {
                    const { protocolFee } = getFees(desiredAmountOut, feeTotal, feeCut);
                    expect(await tokenB.balanceOf(router.address)).to.equal(protocolFee.add(previousFeesB));
                });
                it('Transfers partner fee', async function() {
                    const { partnerFee } = getFees(desiredAmountOut, feeTotal, feeCut);
                    expect(await tokenB.balanceOf(partnerInitialized)).to.equal(partnerFee);
                });
                it('Transfers swap output', async function() {
                    const { partnerFee } = getFees(actualAmountOut, feeTotal, feeCut);
                    // tokenB.transfer 0: provide liquidity
                    // tokenB.transfer 1: seed previous fees
                    // tokenB.transfer 2: from pair to router
                    let transferCount = 3;
                    // tokenB.transfer: partner fee transfer
                    if (partnerFee.gt(0)) transferCount++;
                    const userTransfer = tokenB.transfer.getCall(transferCount);
                    expect(userTransfer.args[0]).to.equal(OWNER.address);
                    expect(userTransfer.args[1]).to.equal(desiredAmountOut);
                });
            });

            describe('swapExactAVAXForTokens', async function() {
                let pair, actualAmountOut;

                beforeEach(async function() {
                    pair = await createPair(wavax, tokenB, pangolinFactory);
                    await depositWAVAX(OWNER, liquidityW);
                    await addLiquidity(pair, wavax, liquidityW, tokenB, liquidityB, OWNER, OWNER);
                    await tokenB.transfer(router.address, previousFeesB);

                    const path = [wavax.address, tokenB.address];
                    const amountIn = ethers.utils.parseEther('100');
                    const amounts = await router.getAmountsOut(amountIn, path);
                    actualAmountOut = amounts[1];
                    const amountOutAdjusted = actualAmountOut.mul(BIPS - feeTotal).div(BIPS);
                    await expect(router.swapExactAVAXForTokens(
                        amountOutAdjusted.toString(),
                        path,
                        OWNER.address,
                        deadline,
                        partnerInitialized,
                        {
                            value: amountIn,
                        },
                    )).not.to.be.reverted;
                });

                it('Cannot swap with un-initialized partner', async function() {
                    await expect(router.swapExactAVAXForTokens(
                        0,
                        [wavax.address, tokenB.address],
                        OWNER.address,
                        deadline,
                        partnerUnInitialized,
                        {
                            value: ethers.utils.parseEther('10'),
                        },
                    )).to.be.revertedWith('Invalid partner');
                });
                it('Transfers protocol fee', async function() {
                    const { protocolFee } = getFees(actualAmountOut, feeTotal, feeCut);
                    expect(await tokenB.balanceOf(router.address)).to.equal(protocolFee.add(previousFeesB));
                });
                it('Transfers partner fee', async function() {
                    const { partnerFee } = getFees(actualAmountOut, feeTotal, feeCut);
                    expect(await tokenB.balanceOf(partnerInitialized)).to.equal(partnerFee);
                });
                it('Transfers swap output', async function() {
                    const { totalFee, partnerFee } = getFees(actualAmountOut, feeTotal, feeCut);
                    const userAmount = actualAmountOut.sub(totalFee);
                    // tokenB.transfer 0: provide liquidity
                    // tokenB.transfer 1: seed previous fees
                    // tokenB.transfer 2: from pair to router
                    let transferCount = 3;
                    // tokenB.transfer: partner fee transfer
                    if (partnerFee.gt(0)) transferCount++;
                    const userTransfer = tokenB.transfer.getCall(transferCount);
                    expect(userTransfer.args[0]).to.equal(OWNER.address);
                    expect(userTransfer.args[1]).to.equal(userAmount);
                });
            });

            describe('swapTokensForExactAVAX', async function() {
                let pair, desiredAmountOut, actualAmountOut;
                let receipt, avaxBefore;

                beforeEach(async function() {
                    pair = await createPair(tokenA, wavax, pangolinFactory);
                    await depositWAVAX(OWNER, liquidityW.add(previousFeesW));
                    await addLiquidity(pair, tokenA, liquidityA, wavax, liquidityW, OWNER, OWNER);
                    await approve(OWNER, tokenA, router.address);
                    await wavax.transfer(router.address, previousFeesW);

                    const path = [tokenA.address, wavax.address];
                    desiredAmountOut = ethers.utils.parseEther('100');
                    actualAmountOut = desiredAmountOut.mul(BIPS + feeTotal).div(BIPS);
                    const amounts = await router.getAmountsIn(actualAmountOut, path);
                    avaxBefore = await OWNER.getBalance();
                    receipt = await expect(router.swapTokensForExactAVAX(
                        desiredAmountOut.toString(),
                        amounts[0].toString(),
                        path,
                        OWNER.address,
                        deadline,
                        partnerInitialized,
                    )).not.to.be.reverted;
                });

                it('Cannot swap with un-initialized partner', async function() {
                    await expect(router.swapTokensForExactAVAX(
                        0,
                        ethers.utils.parseEther('10'),
                        [tokenA.address, wavax.address],
                        OWNER.address,
                        deadline,
                        partnerUnInitialized,
                    )).to.be.revertedWith('Invalid partner');
                });
                it('Transfers protocol fee', async function() {
                    const { protocolFee } = getFees(desiredAmountOut, feeTotal, feeCut);
                    expect(await wavax.balanceOf(router.address)).to.equal(protocolFee.add(previousFeesW));
                });
                it('Transfers partner fee', async function() {
                    const { partnerFee } = getFees(desiredAmountOut, feeTotal, feeCut);
                    expect(await wavax.balanceOf(partnerInitialized)).to.equal(partnerFee);
                });
                it('Transfers swap output', async function() {
                    const { gasUsed, effectiveGasPrice } = await receipt.wait();
                    const avaxAfter = await OWNER.getBalance();
                    const gasCost = gasUsed.mul(effectiveGasPrice);
                    expect(avaxAfter).to.equal(avaxBefore.add(desiredAmountOut).sub(gasCost));
                });
            });

            describe('swapExactTokensForAVAX', async function() {
                let pair, actualAmountOut;
                let receipt, avaxBefore;

                beforeEach(async function() {
                    pair = await createPair(tokenA, wavax, pangolinFactory);
                    await depositWAVAX(OWNER, liquidityW.add(previousFeesW));
                    await addLiquidity(pair, tokenA, liquidityA, wavax, liquidityW, OWNER, OWNER);
                    await approve(OWNER, tokenA, router.address);
                    await wavax.transfer(router.address, previousFeesW);

                    const path = [tokenA.address, wavax.address];
                    const amountIn = ethers.utils.parseEther('100');
                    const amounts = await router.getAmountsOut(amountIn, path);
                    actualAmountOut = amounts[1];
                    const amountOutAdjusted = actualAmountOut.mul(BIPS - feeTotal).div(BIPS);
                    avaxBefore = await OWNER.getBalance();
                    receipt = await expect(router.swapExactTokensForAVAX(
                        amountIn.toString(),
                        amountOutAdjusted.toString(),
                        path,
                        OWNER.address,
                        deadline,
                        partnerInitialized,
                    )).not.to.be.reverted;
                });

                it('Cannot swap with un-initialized partner', async function() {
                    await expect(router.swapExactTokensForAVAX(
                        ethers.utils.parseEther('10'),
                        0,
                        [tokenA.address, wavax.address],
                        OWNER.address,
                        deadline,
                        partnerUnInitialized,
                    )).to.be.revertedWith('Invalid partner');
                });
                it('Transfers protocol fee', async function() {
                    const { protocolFee } = getFees(actualAmountOut, feeTotal, feeCut);
                    expect(await wavax.balanceOf(router.address)).to.equal(protocolFee.add(previousFeesW));
                });
                it('Transfers partner fee', async function() {
                    const { partnerFee } = getFees(actualAmountOut, feeTotal, feeCut);
                    expect(await wavax.balanceOf(partnerInitialized)).to.equal(partnerFee);
                });
                it('Transfers swap output', async function() {
                    const { remainder } = getFees(actualAmountOut, feeTotal, feeCut);
                    const { gasUsed, effectiveGasPrice } = await receipt.wait();
                    const avaxAfter = await OWNER.getBalance();
                    const gasCost = gasUsed.mul(effectiveGasPrice);
                    expect(avaxAfter).to.equal(avaxBefore.add(remainder).sub(gasCost));
                });
            });

            describe('swapAVAXForExactTokens', async function() {
                let pair, desiredAmountOut, actualAmountOut;

                beforeEach(async function() {
                    pair = await createPair(wavax, tokenB, pangolinFactory);
                    await depositWAVAX(OWNER, liquidityW);
                    await addLiquidity(pair, wavax, liquidityW, tokenB, liquidityB, OWNER, OWNER);
                    await tokenB.transfer(router.address, previousFeesB);

                    const path = [wavax.address, tokenB.address];
                    desiredAmountOut = ethers.utils.parseEther('100');
                    actualAmountOut = desiredAmountOut.mul(BIPS + feeTotal).div(BIPS);
                    const amounts = await router.getAmountsIn(actualAmountOut, path);
                    await expect(router.swapAVAXForExactTokens(
                        desiredAmountOut.toString(),
                        path,
                        OWNER.address,
                        deadline,
                        partnerInitialized,
                        {
                            value: amounts[0].toString(),
                        },
                    )).not.to.be.reverted;
                });

                it('Cannot swap with un-initialized partner', async function() {
                    await expect(router.swapAVAXForExactTokens(
                        0,
                        [wavax.address, tokenB.address],
                        OWNER.address,
                        deadline,
                        partnerUnInitialized,
                        {
                            value: ethers.utils.parseEther('10'),
                        },
                    )).to.be.revertedWith('Invalid partner');
                });
                it('Transfers protocol fee', async function() {
                    const { protocolFee } = getFees(desiredAmountOut, feeTotal, feeCut);
                    expect(await tokenB.balanceOf(router.address)).to.equal(protocolFee.add(previousFeesB));
                });
                it('Transfers partner fee', async function() {
                    const { partnerFee } = getFees(desiredAmountOut, feeTotal, feeCut);
                    expect(await tokenB.balanceOf(partnerInitialized)).to.equal(partnerFee);
                });
                it('Transfers swap output', async function() {
                    const { partnerFee } = getFees(actualAmountOut, feeTotal, feeCut);
                    // tokenB.transfer 0: provide liquidity
                    // tokenB.transfer 1: seed previous fees
                    // tokenB.transfer 2: from pair to router
                    let transferCount = 3;
                    // tokenB.transfer: partner fee transfer
                    if (partnerFee.gt(0)) transferCount++;
                    const userTransfer = tokenB.transfer.getCall(transferCount);
                    expect(userTransfer.args[0]).to.equal(OWNER.address);
                    expect(userTransfer.args[1]).to.equal(desiredAmountOut);
                });
            });

            describe('swapExactTokensForTokensSupportingFeeOnTransferTokens', async function() {
                let pair, actualAmountOut;

                beforeEach(async function() {
                    pair = await createPair(tokenA, tokenB, pangolinFactory);
                    await addLiquidity(pair, tokenA, liquidityA, tokenB, liquidityB, OWNER, OWNER);
                    await approve(OWNER, tokenA, router.address);
                    await tokenB.transfer(router.address, previousFeesB);

                    const path = [tokenA.address, tokenB.address];
                    const amountIn = ethers.utils.parseEther('100');
                    const amounts = await router.getAmountsOut(amountIn, path);
                    actualAmountOut = amounts[1];
                    const amountOutAdjusted = actualAmountOut.mul(BIPS - feeTotal).div(BIPS);
                    await expect(router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
                        amountIn.toString(),
                        amountOutAdjusted.toString(),
                        path,
                        OWNER.address,
                        deadline,
                        partnerInitialized,
                    )).not.to.be.reverted;
                });

                it('Cannot swap with un-initialized partner', async function() {
                    await expect(router.swapExactTokensForTokensSupportingFeeOnTransferTokens(
                        ethers.utils.parseEther('10'),
                        0,
                        [tokenA.address, tokenB.address],
                        OWNER.address,
                        deadline,
                        partnerUnInitialized,
                    )).to.be.revertedWith('Invalid partner');
                });
                it('Transfers protocol fee', async function() {
                    const { protocolFee } = getFees(actualAmountOut, feeTotal, feeCut);
                    expect(await tokenB.balanceOf(router.address)).to.equal(protocolFee.add(previousFeesB));
                });
                it('Transfers partner fee', async function() {
                    const { partnerFee } = getFees(actualAmountOut, feeTotal, feeCut);
                    expect(await tokenB.balanceOf(partnerInitialized)).to.equal(partnerFee);
                });
                it('Transfers swap output', async function() {
                    const { totalFee, partnerFee } = getFees(actualAmountOut, feeTotal, feeCut);
                    const userAmount = actualAmountOut.sub(totalFee);
                    // tokenB.transfer 0: provide liquidity
                    // tokenB.transfer 1: seed previous fees
                    // tokenB.transfer 2: from pair to router
                    let transferCount = 3;
                    // tokenB.transfer: partner fee transfer
                    if (partnerFee.gt(0)) transferCount++;
                    const userTransfer = tokenB.transfer.getCall(transferCount);
                    expect(userTransfer.args[0]).to.equal(OWNER.address);
                    expect(userTransfer.args[1]).to.equal(userAmount);
                });
            });

            describe('swapExactAVAXForTokensSupportingFeeOnTransferTokens', async function() {
                let pair, actualAmountOut;

                beforeEach(async function() {
                    pair = await createPair(wavax, tokenB, pangolinFactory);
                    await depositWAVAX(OWNER, liquidityW);
                    await addLiquidity(pair, wavax, liquidityW, tokenB, liquidityB, OWNER, OWNER);
                    await tokenB.transfer(router.address, previousFeesB);

                    const path = [wavax.address, tokenB.address];
                    const amountIn = ethers.utils.parseEther('100');
                    const amounts = await router.getAmountsOut(amountIn, path);
                    actualAmountOut = amounts[1];
                    const amountOutAdjusted = actualAmountOut.mul(BIPS - feeTotal).div(BIPS);
                    await expect(router.swapExactAVAXForTokensSupportingFeeOnTransferTokens(
                        amountOutAdjusted.toString(),
                        path,
                        OWNER.address,
                        deadline,
                        partnerInitialized,
                        {
                            value: amountIn,
                        },
                    )).not.to.be.reverted;
                });

                it('Cannot swap with un-initialized partner', async function() {
                    await expect(router.swapExactAVAXForTokensSupportingFeeOnTransferTokens(
                        0,
                        [wavax.address, tokenB.address],
                        OWNER.address,
                        deadline,
                        partnerUnInitialized,
                        {
                            value: ethers.utils.parseEther('10'),
                        },
                    )).to.be.revertedWith('Invalid partner');
                });
                it('Transfers protocol fee', async function() {
                    const { protocolFee } = getFees(actualAmountOut, feeTotal, feeCut);
                    expect(await tokenB.balanceOf(router.address)).to.equal(protocolFee.add(previousFeesB));
                });
                it('Transfers partner fee', async function() {
                    const { partnerFee } = getFees(actualAmountOut, feeTotal, feeCut);
                    expect(await tokenB.balanceOf(partnerInitialized)).to.equal(partnerFee);
                });
                it('Transfers swap output', async function() {
                    const { totalFee, partnerFee } = getFees(actualAmountOut, feeTotal, feeCut);
                    const userAmount = actualAmountOut.sub(totalFee);
                    // tokenB.transfer 0: provide liquidity
                    // tokenB.transfer 1: seed previous fees
                    // tokenB.transfer 2: from pair to router
                    let transferCount = 3;
                    // tokenB.transfer: partner fee transfer
                    if (partnerFee.gt(0)) transferCount++;
                    const userTransfer = tokenB.transfer.getCall(transferCount);
                    expect(userTransfer.args[0]).to.equal(OWNER.address);
                    expect(userTransfer.args[1]).to.equal(userAmount);
                });
            });

            describe('swapExactTokensForAVAXSupportingFeeOnTransferTokens', async function() {
                let pair, actualAmountOut;
                let receipt, avaxBefore;

                beforeEach(async function() {
                    pair = await createPair(tokenA, wavax, pangolinFactory);
                    await depositWAVAX(OWNER, liquidityW.add(previousFeesW));
                    await addLiquidity(pair, tokenA, liquidityA, wavax, liquidityW, OWNER, OWNER);
                    await approve(OWNER, tokenA, router.address);
                    await wavax.transfer(router.address, previousFeesW);

                    const path = [tokenA.address, wavax.address];
                    const amountIn = ethers.utils.parseEther('100');
                    const amounts = await router.getAmountsOut(amountIn, path);
                    actualAmountOut = amounts[1];
                    const amountOutAdjusted = actualAmountOut.mul(BIPS - feeTotal).div(BIPS);
                    avaxBefore = await OWNER.getBalance();
                    receipt = await expect(router.swapExactTokensForAVAXSupportingFeeOnTransferTokens(
                        amountIn.toString(),
                        amountOutAdjusted.toString(),
                        path,
                        OWNER.address,
                        deadline,
                        partnerInitialized,
                    )).not.to.be.reverted;
                });

                it('Cannot swap with un-initialized partner', async function() {
                    await expect(router.swapExactTokensForAVAXSupportingFeeOnTransferTokens(
                        ethers.utils.parseEther('10'),
                        0,
                        [tokenA.address, wavax.address],
                        OWNER.address,
                        deadline,
                        partnerUnInitialized,
                    )).to.be.revertedWith('Invalid partner');
                });
                it('Transfers protocol fee', async function() {
                    const { protocolFee } = getFees(actualAmountOut, feeTotal, feeCut);
                    expect(await wavax.balanceOf(router.address)).to.equal(protocolFee.add(previousFeesW));
                });
                it('Transfers partner fee', async function() {
                    const { partnerFee } = getFees(actualAmountOut, feeTotal, feeCut);
                    expect(await wavax.balanceOf(partnerInitialized)).to.equal(partnerFee);
                });
                it('Transfers swap output', async function() {
                    const { remainder } = getFees(actualAmountOut, feeTotal, feeCut);
                    const { gasUsed, effectiveGasPrice } = await receipt.wait();
                    const avaxAfter = await OWNER.getBalance();
                    const gasCost = gasUsed.mul(effectiveGasPrice);
                    expect(avaxAfter).to.equal(avaxBefore.add(remainder).sub(gasCost));
                });
            });
        }
    });

    describe('Withdrawing fees', async function() {
        let feesA = ethers.utils.parseEther('5000000');
        let feesB = ethers.utils.parseEther('1000000');

        beforeEach(async function() {
            tokenA.transfer(router.address, feesA);
            tokenB.transfer(router.address, feesB);
        });

        it('Non-owner cannot withdraw fees', async function() {
            await expect(router.connect(user1).withdrawFees(
                [tokenA.address],
                [feesA],
                user1.address,
            )).to.be.revertedWith('Permission denied');
        });
        it('Token and amount arguments must match', async function() {
            await expect(router.connect(OWNER).withdrawFees(
                [tokenA.address],
                [],
                user1.address,
            )).to.be.revertedWith('Mismatched array lengths');
        });
        it('Owner can withdraw single token fees', async function() {
            await expect(router.connect(OWNER).withdrawFees(
                [tokenA.address],
                [feesA],
                user1.address,
            )).to.emit(router, 'FeeWithdrawn');
            expect(await tokenA.balanceOf(user1.address)).to.equal(feesA);
        });
        it('Owner can withdraw multiple token fees', async function() {
            await expect(router.connect(OWNER).withdrawFees(
                [tokenA.address, tokenB.address],
                [feesA, feesB],
                user1.address,
            )).to.emit(router, 'FeeWithdrawn');
            expect(await tokenA.balanceOf(user1.address)).to.equal(feesA);
            expect(await tokenB.balanceOf(user1.address)).to.equal(feesB);
        });
    });

    // Helpers
    async function createPair(tokenA, tokenB, factory = pangolinFactory) {
        await factory.createPair(tokenA.address, tokenB.address);
        const address = await factory.getPair(tokenA.address, tokenB.address);
        return PangolinPair.attach(address);
    }
    async function addLiquidity(pair, tokenA, amountA, tokenB, amountB, user, to = user) {
        await tokenA.connect(user).transfer(pair.address, amountA);
        await tokenB.connect(user).transfer(pair.address, amountB);
        await pair.connect(user).mint(to.address);
    }
    async function approve(user, token, spenderAddress, amount = '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff') {
        return token.connect(user).approve(spenderAddress, amount);
    }
    async function depositWAVAX(user, amount) {
        const initBalance = await user.getBalance();
        const bal = initBalance.add(amount).toHexString().replace('0x0', '0x');
        await network.provider.request({
            method: 'hardhat_setBalance',
            params: [user.address, bal],
        });
        await wavax.connect(user).deposit({ value: amount.toString() });
    }
    function getFees(amount, feeTotal, feeCut) {
        const totalFee = amount.mul(feeTotal).div(BIPS);
        const protocolFee = totalFee.mul(feeCut).div(BIPS);
        const partnerFee = totalFee.sub(protocolFee);
        const remainder = amount.sub(totalFee);
        return { totalFee, protocolFee, partnerFee, remainder };
    }
    async function getFeeInfo(feeTo) {
        const feeInfo = await router.getFeeInfo(feeTo);
        return {
            feePartner: feeInfo[0],
            feeProtocol: feeInfo[1],
            feeTotal: feeInfo[2],
            feeCut: feeInfo[3],
            initialized: feeInfo[4],
        };
    }
});
