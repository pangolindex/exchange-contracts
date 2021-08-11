import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers"
import { expect } from "chai"
import { BigNumber, Contract } from "ethers"
import { ethers } from "hardhat"
import fixture from "./fixture"

export async function getOwnerAccount(): Promise<SignerWithAddress> {
    return (await ethers.getSigners())[0]
}

export async function makeAccountGenerator(): Promise<()=>SignerWithAddress> {
    let accounts = await ethers.getSigners()
    //removes the default owner, which is accounts[0]
    accounts.splice(0,1)
    function* nextAccount() {
        let index = 0
        while (true) {
            yield accounts[index%accounts.length]
            index++
        }
    }
    let newNextAccountGen = nextAccount()
    return () => newNextAccountGen.next().value!
}

export function getAmountOut(amountIn: BigNumber, reserveIn: BigNumber, reserveOut: BigNumber) {
    const amountInWithFee = amountIn.mul(997);
    const numerator = amountInWithFee.mul(reserveOut);
    const denominator = reserveIn.mul(1000).add(amountInWithFee);
    return numerator.div(denominator);
}

export async function getTokenContract(tokenAddress: string): Promise<Contract> {
    return await ethers.getContractAt("IPangolinERC20", tokenAddress)
}

export async function getPairContract(pairAddress: string): Promise<Contract> {
    return await ethers.getContractAt("IPangolinPair", pairAddress)
}

export async function getWAVAXContract(): Promise<Contract> {
    return await ethers.getContractAt("IWAVAX", fixture.Tokens.WAVAX)
}

export async function fundWAVAX(account: SignerWithAddress, amount: BigNumber) {
    const WAVAX = await getWAVAXContract()
    await WAVAX.connect(account).deposit({value: amount})
    expect(await WAVAX.balanceOf(account.address)).to.gte(amount)
}

export async function fundToken(account: SignerWithAddress, tokenToFund: string, amountAvax: BigNumber): Promise<BigNumber> {
    const WAVAX = await ethers.getContractAt("IWAVAX", fixture.Tokens.WAVAX)
    //we're already funded in this case
    if (tokenToFund == WAVAX.address) return amountAvax

    const tokenContract = await getTokenContract(tokenToFund)
    type TokenSymbol = keyof typeof fixture.Pairs.AVAX
    const tokenSymbol = await tokenContract.symbol() as TokenSymbol
    if (!(tokenSymbol in fixture.Pairs.AVAX)) throw `No valid pair for AVAX-${tokenSymbol} required to fund the account with 1INCH from WAVAX`
    const pairAddress: string = fixture.Pairs.AVAX[tokenSymbol]
    const fundPairContract = await ethers.getContractAt("IPangolinPair", pairAddress)
    let [reserves0, reserves1] = await fundPairContract.getReserves()
    const token0: string = await fundPairContract.token0()
    if (token0 != fixture.Tokens.WAVAX) [reserves0, reserves1] = [reserves1, reserves0]
    expect(await WAVAX.balanceOf(account.address)).to.gte(amountAvax)
    await WAVAX.connect(account).transfer(fundPairContract.address, amountAvax)
    let amountOut0 = BigNumber.from(0)
    let amountOut1 = getAmountOut(amountAvax, reserves0, reserves1)
    if (token0 != fixture.Tokens.WAVAX) [amountOut0, amountOut1] = [amountOut1, amountOut0]
    expect(amountOut0.add(amountOut1), "Not enough AVAX used, value is 0 due to rounding issues, use a bigger amountAvax").to.not.equal(0)
    await fundPairContract.connect(account).swap(amountOut0, amountOut1, account.address, [])
    return await tokenContract.balanceOf(account.address)
}

export async function fundLiquidityToken(account: SignerWithAddress, pairAddress: string, amountAvax: BigNumber): Promise<BigNumber> {
    const pairContract = await getPairContract(pairAddress)
    await fundWAVAX(account, amountAvax)
    let pairToken0 = await getTokenContract(await pairContract.token0())
    let pairToken1 = await getTokenContract(await pairContract.token1())    
    let amountToken0 = await fundToken(account, pairToken0.address, amountAvax.div(2))
    let amountToken1 = await fundToken(account, pairToken1.address, amountAvax.div(2))
    expect(await pairToken0.balanceOf(account.address)).to.gte(amountToken0)
    expect(await pairToken1.balanceOf(account.address)).to.gte(amountToken1)
    
    // funds the liquidity token
    await pairToken0.connect(account).transfer(pairContract.address, amountToken0)
    await pairToken1.connect(account).transfer(pairContract.address, amountToken1)
    await pairContract.connect(account).mint(account.address)
    let liquidityAmount = await pairContract.balanceOf(account.address)
    expect(liquidityAmount).to.gt(0)
    return liquidityAmount
}

export function getDeadline() {
    return Math.floor(Date.now() / 1000) + 60 * 20 * 4;
}

export async function checkDust(tokens: string[], addressToCheck: string, expectAmount: number) {
    for(let i = 0; i < tokens.length; i++) {
        let token = await getTokenContract(tokens[i])
        expect(await token.balanceOf(addressToCheck)).to.equal(expectAmount)
    }
}
