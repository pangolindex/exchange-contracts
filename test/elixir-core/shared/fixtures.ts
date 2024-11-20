import { Wallet, BigNumber } from "ethers";
import { ethers, network } from "hardhat";
import { MockTimeElixirPool } from "../../../typechain/MockTimeElixirPool";
import { TestERC20 } from "../../../typechain/TestERC20";
import { ElixirFactory } from "../../../typechain/ElixirFactory";
import { TestElixirCallee } from "../../../typechain/TestElixirCallee";
import { TestElixirRouter } from "../../../typechain/TestElixirRouter";
import { MockTimeElixirPoolDeployer } from "../../../typechain/MockTimeElixirPoolDeployer";

import { Fixture } from "ethereum-waffle";

interface FactoryFixture {
  factory: ElixirFactory;
}

async function impersonateDeployer(wallet: Wallet) {
  //  impersonating poolDeployer's account
  const poolDeployerAddress = "0x427207B1Cdb6F2Ab8B1D21Ab77600f00b0a639a7";
  await network.provider.request({
    method: "hardhat_impersonateAccount",
    params: [poolDeployerAddress],
  });

  const poolDeployer = await (ethers as any).getSigner(poolDeployerAddress);

  //  fund the impersonated account
  await wallet.sendTransaction({
    to: poolDeployerAddress,
    value: ethers.utils.parseEther("100"),
  });

  return poolDeployer;
}

async function factoryFixture(): Promise<FactoryFixture> {
  let wallet: Wallet;
  let poolDeployer: Wallet;
  [wallet] = await (ethers as any).getSigners();

  poolDeployer = await impersonateDeployer(wallet);

  const poolFactory = await ethers.getContractFactory("ElixirPool");
  const poolImplementation = await poolFactory.connect(poolDeployer).deploy();

  const factoryFactory = await ethers.getContractFactory("ElixirFactory");
  const factory = (await factoryFactory.deploy(
    poolImplementation.address
  )) as ElixirFactory;
  return { factory };
}

interface TokensFixture {
  token0: TestERC20;
  token1: TestERC20;
  token2: TestERC20;
}

async function tokensFixture(): Promise<TokensFixture> {
  const tokenFactory = await ethers.getContractFactory(
    "contracts/PangolinV3-core/test/TestERC20.sol:TestERC20"
  );
  const tokenA = (await tokenFactory.deploy(
    BigNumber.from(2).pow(255)
  )) as TestERC20;
  const tokenB = (await tokenFactory.deploy(
    BigNumber.from(2).pow(255)
  )) as TestERC20;
  const tokenC = (await tokenFactory.deploy(
    BigNumber.from(2).pow(255)
  )) as TestERC20;

  const [token0, token1, token2] = [tokenA, tokenB, tokenC].sort(
    (tokenA, tokenB) =>
      tokenA.address.toLowerCase() < tokenB.address.toLowerCase() ? -1 : 1
  );

  return { token0, token1, token2 };
}

type TokensAndFactoryFixture = FactoryFixture & TokensFixture;

interface PoolFixture extends TokensAndFactoryFixture {
  swapTargetCallee: TestElixirCallee;
  swapTargetRouter: TestElixirRouter;
  createPool(
    fee: number,
    tickSpacing: number,
    firstToken?: TestERC20,
    secondToken?: TestERC20
  ): Promise<MockTimeElixirPool>;
}

// Monday, October 5, 2020 9:00:00 AM GMT-05:00
export const TEST_POOL_START_TIME = 1601906400;

export const poolFixture: Fixture<PoolFixture> =
  async function (): Promise<PoolFixture> {
    let wallet: Wallet;
    [wallet] = await (ethers as any).getSigners();

    const { factory } = await factoryFixture();
    const { token0, token1, token2 } = await tokensFixture();

    const MockTimeElixirPoolDeployerFactory = await ethers.getContractFactory(
      "MockTimeElixirPoolDeployer"
    );
    const MockTimeElixirPoolFactory = await ethers.getContractFactory(
      "MockTimeElixirPool"
    );

    const calleeContractFactory = await ethers.getContractFactory(
      "contracts/PangolinV3-core/test/TestElixirCallee.sol:TestElixirCallee"
    );
    const routerContractFactory = await ethers.getContractFactory(
      "TestElixirRouter"
    );

    const swapTargetCallee =
      (await calleeContractFactory.deploy()) as TestElixirCallee;
    const swapTargetRouter =
      (await routerContractFactory.deploy()) as TestElixirRouter;

    const implementationAddress = await factory.implementation();

    return {
      token0,
      token1,
      token2,
      factory,
      swapTargetCallee,
      swapTargetRouter,
      createPool: async (
        fee,
        tickSpacing,
        firstToken = token0,
        secondToken = token1
      ) => {
        const mockTimePoolImplementation =
          await MockTimeElixirPoolFactory.deploy();
        const mockTimePoolDeployer =
          (await MockTimeElixirPoolDeployerFactory.deploy(
            mockTimePoolImplementation.address
          )) as MockTimeElixirPoolDeployer;
        const tx = await mockTimePoolDeployer.deploy(
          factory.address,
          firstToken.address,
          secondToken.address,
          fee,
          tickSpacing
        );

        const receipt = await tx.wait();
        const poolAddress = receipt.events?.[0].args?.pool as string;
        return MockTimeElixirPoolFactory.attach(
          poolAddress
        ) as MockTimeElixirPool;
      },
    };
  };
