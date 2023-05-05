import { BigNumber } from "ethers";
import { ethers } from "hardhat";
import { MockTimePangolinV2Pool } from "../../../typechain/MockTimePangolinV2Pool";
import { TestERC20 } from "../../../typechain/TestERC20";
import { PangolinV2Factory } from "../../../typechain/PangolinV2Factory";
import { TestPangolinV2Callee } from "../../../typechain/TestPangolinV2Callee";
import { TestPangolinV2Router } from "../../../typechain/TestPangolinV2Router";
import { MockTimePangolinV2PoolDeployer } from "../../../typechain/MockTimePangolinV2PoolDeployer";

import { Fixture } from "ethereum-waffle";

interface FactoryFixture {
  factory: PangolinV2Factory;
}

async function factoryFixture(): Promise<FactoryFixture> {
  const factoryFactory = await ethers.getContractFactory("PangolinV2Factory");
  const factory = (await factoryFactory.deploy()) as PangolinV2Factory;
  return { factory };
}

interface TokensFixture {
  token0: TestERC20;
  token1: TestERC20;
  token2: TestERC20;
}

async function tokensFixture(): Promise<TokensFixture> {
  const tokenFactory = await ethers.getContractFactory("TestERC20");
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
  swapTargetCallee: TestPangolinV2Callee;
  swapTargetRouter: TestPangolinV2Router;
  createPool(
    fee: number,
    tickSpacing: number,
    firstToken?: TestERC20,
    secondToken?: TestERC20
  ): Promise<MockTimePangolinV2Pool>;
}

// Monday, October 5, 2020 9:00:00 AM GMT-05:00
export const TEST_POOL_START_TIME = 1601906400;

export const poolFixture: Fixture<PoolFixture> =
  async function (): Promise<PoolFixture> {
    const { factory } = await factoryFixture();
    const { token0, token1, token2 } = await tokensFixture();

    const MockTimePangolinV2PoolDeployerFactory =
      await ethers.getContractFactory("MockTimePangolinV2PoolDeployer");
    const MockTimePangolinV2PoolFactory = await ethers.getContractFactory(
      "MockTimePangolinV2Pool"
    );

    const calleeContractFactory = await ethers.getContractFactory(
      "TestPangolinV2Callee"
    );
    const routerContractFactory = await ethers.getContractFactory(
      "TestPangolinV2Router"
    );

    const swapTargetCallee =
      (await calleeContractFactory.deploy()) as TestPangolinV2Callee;
    const swapTargetRouter =
      (await routerContractFactory.deploy()) as TestPangolinV2Router;

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
        const mockTimePoolDeployer =
          (await MockTimePangolinV2PoolDeployerFactory.deploy()) as MockTimePangolinV2PoolDeployer;
        const tx = await mockTimePoolDeployer.deploy(
          factory.address,
          firstToken.address,
          secondToken.address,
          fee,
          tickSpacing
        );

        const receipt = await tx.wait();
        const poolAddress = receipt.events?.[0].args?.pool as string;
        return MockTimePangolinV2PoolFactory.attach(
          poolAddress
        ) as MockTimePangolinV2Pool;
      },
    };
  };
