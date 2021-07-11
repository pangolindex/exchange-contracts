const { expect } = require("chai")
const { ethers } = require("hardhat")
const fixture = require("./fixture.json")

const makeAccountGenerator = async () => {
    let accounts = await ethers.getSigners()
    function* nextAccount() {
        for (let account of accounts) {
            yield account
        }
    }
    let newNextAccountGen = nextAccount()
    return () => newNextAccountGen.next().value
}

const getAmountOut = function(amountIn, reserveIn, reserveOut) {
    const amountInWithFee = amountIn.mul(997);
    const numerator = amountInWithFee.mul(reserveOut);
    const denominator = reserveIn.mul(1000).add(amountInWithFee);
    return numerator.div(denominator);
}

const getTokenContract = async(tokenAddress) => {
    return await ethers.getContractAt("IPangolinERC20", tokenAddress)
}

const getPairContract = async(pairAddress) => {
    return await ethers.getContractAt("IPangolinPair", pairAddress)
}

const getWAVAXContract = async() => {
    return await ethers.getContractAt("IWAVAX", fixture.Tokens.WAVAX)
}

const fundWAVAX = async(account, amount) => {
    const WAVAX = await ethers.getContractAt("IWAVAX", fixture.Tokens.WAVAX)
    await WAVAX.connect(account).deposit({value: amount})
    expect(await WAVAX.balanceOf(account.address)).to.gte(amount)
}

const fundToken = async(account, tokenToFund, amountAvax) => {
    const WAVAX = await ethers.getContractAt("IWAVAX", fixture.Tokens.WAVAX)
    const tokenContract = await getTokenContract(tokenToFund)
    const tokenSymbol = await tokenContract.symbol()
    if (!(tokenSymbol in fixture.Pairs.AVAX)) throw `No valid pair for AVAX-${tokenSymbol}`
    const pairAddress = fixture.Pairs.AVAX[tokenSymbol]
    const fundPairContract = await ethers.getContractAt("IPangolinPair", pairAddress)
    let [reserves0, reserves1] = await fundPairContract.getReserves()
    const token0 = await fundPairContract.token0()
    if (token0 != fixture.Tokens.WAVAX) [reserves0, reserves1] = [reserves1, reserves0]
    expect(await WAVAX.balanceOf(account.address)).to.gte(amountAvax)
    await WAVAX.connect(account).transfer(fundPairContract.address, amountAvax)
    let amountOut0 = 0
    let amountOut1 = getAmountOut(amountAvax, reserves0, reserves1)
    if (token0 != fixture.Tokens.WAVAX) [amountOut0, amountOut1] = [amountOut1, amountOut0]
    await fundPairContract.connect(account).swap(amountOut0, amountOut1, account.address, [])
    return await tokenContract.balanceOf(account.address)
}

function getDeadline() {
    return Math.floor(Date.now() / 1000) + 60 * 20;
}

module.exports = {
    makeAccountGenerator,
    fundToken, fundWAVAX,
    getWAVAXContract,
    getTokenContract,
    getPairContract,
    getDeadline
}