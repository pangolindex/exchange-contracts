import { Wallet } from "ethers";
import { ethers, waffle, network } from "hardhat";
import { ElixirFactory } from "../../typechain/ElixirFactory";
import { expect } from "./shared/expect";
import snapshotGasCost from "./shared/snapshotGasCost";
import "dotenv/config";

import {
  FeeAmount,
  getCreate2Address,
  getCreate2AddressWithInitCodeHash,
  TICK_SPACINGS,
} from "./shared/utilities";

const { constants } = ethers;

const TEST_ADDRESSES: [string, string] = [
  "0x1000000000000000000000000000000000000000",
  "0x2000000000000000000000000000000000000000",
];

const POOL_IMPLEMENTATION = "0x5cB5539A18591947C82f5D840B05ed79f6395491";
const POOL_INIT_CODE_HASH =
  "0x41a723f9e6457830b1b7a44df4435fab88581d073226894b33131815dd674c22";

const createFixtureLoader = waffle.createFixtureLoader;

describe("ElixirFactory", () => {
  let wallet: Wallet, other: Wallet;

  let factory: ElixirFactory;
  let poolBytecode: string;
  const fixture = async () => {
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

    const poolFactory = await ethers.getContractFactory("ElixirPool");
    const poolImplementation = await poolFactory.connect(poolDeployer).deploy();

    const factoryFactory = await ethers.getContractFactory("ElixirFactory");
    const factory = await factoryFactory.deploy(POOL_IMPLEMENTATION);
    return factory as ElixirFactory;
  };

  let loadFixture: ReturnType<typeof createFixtureLoader>;
  before("create fixture loader", async () => {
    [wallet, other] = await (ethers as any).getSigners();

    loadFixture = createFixtureLoader([wallet, other]);
  });

  before("load pool bytecode", async () => {
    poolBytecode = (await ethers.getContractFactory("ElixirPool")).bytecode;
  });

  beforeEach("deploy factory", async () => {
    factory = await loadFixture(fixture);
  });

  it("implementation address", async () => {
    expect(await factory.implementation()).to.be.eq(POOL_IMPLEMENTATION);
  });

  it("owner is deployer", async () => {
    expect(await factory.owner()).to.eq(wallet.address);
  });

  it("factory bytecode size", async () => {
    expect(
      ((await waffle.provider.getCode(factory.address)).length - 2) / 2
    ).to.matchSnapshot();
  });

  it("pool bytecode size", async () => {
    await factory.createPool(
      TEST_ADDRESSES[0],
      TEST_ADDRESSES[1],
      FeeAmount.MEDIUM
    );
    const poolAddress = getCreate2Address(
      factory.address,
      TEST_ADDRESSES,
      FeeAmount.MEDIUM,
      poolBytecode
    );
    expect(
      ((await waffle.provider.getCode(poolAddress)).length - 2) / 2
    ).to.matchSnapshot();
  });

  it("initial enabled fee amounts", async () => {
    expect(await factory.feeAmountTickSpacing(FeeAmount.LOW)).to.eq(
      TICK_SPACINGS[FeeAmount.LOW]
    );
    expect(await factory.feeAmountTickSpacing(FeeAmount.MEDIUM)).to.eq(
      TICK_SPACINGS[FeeAmount.MEDIUM]
    );
    expect(await factory.feeAmountTickSpacing(FeeAmount.HIGH)).to.eq(
      TICK_SPACINGS[FeeAmount.HIGH]
    );
  });

  async function createAndCheckPool(
    tokens: [string, string],
    feeAmount: FeeAmount,
    tickSpacing: number = TICK_SPACINGS[feeAmount]
  ) {
    const create2Address = getCreate2AddressWithInitCodeHash(
      factory.address,
      tokens,
      feeAmount,
      POOL_INIT_CODE_HASH
    );
    const create = factory.createPool(tokens[0], tokens[1], feeAmount);

    await expect(create)
      .to.emit(factory, "PoolCreated")
      .withArgs(
        TEST_ADDRESSES[0],
        TEST_ADDRESSES[1],
        feeAmount,
        tickSpacing,
        create2Address
      );

    await expect(factory.createPool(tokens[0], tokens[1], feeAmount)).to.be
      .reverted;
    await expect(factory.createPool(tokens[1], tokens[0], feeAmount)).to.be
      .reverted;
    expect(
      await factory.getPool(tokens[0], tokens[1], feeAmount),
      "getPool in order"
    ).to.eq(create2Address);
    expect(
      await factory.getPool(tokens[1], tokens[0], feeAmount),
      "getPool in reverse"
    ).to.eq(create2Address);

    const poolContractFactory = await ethers.getContractFactory("ElixirPool");
    const pool = poolContractFactory.attach(create2Address);

    expect(await pool.factory(), "pool factory address").to.eq(factory.address);
    expect(await pool.token0(), "pool token0").to.eq(TEST_ADDRESSES[0]);
    expect(await pool.token1(), "pool token1").to.eq(TEST_ADDRESSES[1]);
    expect(await pool.fee(), "pool fee").to.eq(feeAmount);
    expect(await pool.tickSpacing(), "pool tick spacing").to.eq(tickSpacing);
  }

  describe("#createPool", () => {
    it("succeeds for low fee pool", async () => {
      await createAndCheckPool(TEST_ADDRESSES, FeeAmount.LOW);
    });

    it("succeeds for medium fee pool", async () => {
      await createAndCheckPool(TEST_ADDRESSES, FeeAmount.MEDIUM);
    });
    it("succeeds for high fee pool", async () => {
      await createAndCheckPool(TEST_ADDRESSES, FeeAmount.HIGH);
    });

    it("succeeds if tokens are passed in reverse", async () => {
      await createAndCheckPool(
        [TEST_ADDRESSES[1], TEST_ADDRESSES[0]],
        FeeAmount.MEDIUM
      );
    });

    it("fails if token a == token b", async () => {
      await expect(
        factory.createPool(TEST_ADDRESSES[0], TEST_ADDRESSES[0], FeeAmount.LOW)
      ).to.be.reverted;
    });

    it("fails if token a is 0 or token b is 0", async () => {
      await expect(
        factory.createPool(
          TEST_ADDRESSES[0],
          constants.AddressZero,
          FeeAmount.LOW
        )
      ).to.be.reverted;
      await expect(
        factory.createPool(
          constants.AddressZero,
          TEST_ADDRESSES[0],
          FeeAmount.LOW
        )
      ).to.be.reverted;
      await expect(
        factory.createPool(
          constants.AddressZero,
          constants.AddressZero,
          FeeAmount.LOW
        )
      ).to.be.revertedWith("");
    });

    it("fails if fee amount is not enabled", async () => {
      await expect(
        factory.createPool(TEST_ADDRESSES[0], TEST_ADDRESSES[1], 250)
      ).to.be.reverted;
    });

    it("gas", async () => {
      await snapshotGasCost(
        factory.createPool(
          TEST_ADDRESSES[0],
          TEST_ADDRESSES[1],
          FeeAmount.MEDIUM
        )
      );
    });
  });

  describe("#setOwner", () => {
    it("fails if caller is not owner", async () => {
      await expect(factory.connect(other).setOwner(wallet.address)).to.be
        .reverted;
    });

    it("updates owner", async () => {
      await factory.setOwner(other.address);
      expect(await factory.owner()).to.eq(other.address);
    });

    it("emits event", async () => {
      await expect(factory.setOwner(other.address))
        .to.emit(factory, "OwnerChanged")
        .withArgs(wallet.address, other.address);
    });

    it("cannot be called by original owner", async () => {
      await factory.setOwner(other.address);
      await expect(factory.setOwner(wallet.address)).to.be.reverted;
    });
  });

  describe("#enableFeeAmount", () => {
    it("fails if caller is not owner", async () => {
      await expect(factory.connect(other).enableFeeAmount(100, 2)).to.be
        .reverted;
    });
    it("fails if fee is too great", async () => {
      await expect(factory.enableFeeAmount(1000000, 10)).to.be.reverted;
    });
    it("fails if tick spacing is too small", async () => {
      await expect(factory.enableFeeAmount(500, 0)).to.be.reverted;
    });
    it("fails if tick spacing is too large", async () => {
      await expect(factory.enableFeeAmount(500, 16834)).to.be.reverted;
    });
    it("fails if already initialized", async () => {
      await factory.enableFeeAmount(100, 5);
      await expect(factory.enableFeeAmount(100, 10)).to.be.reverted;
    });
    it("sets the fee amount in the mapping", async () => {
      await factory.enableFeeAmount(100, 5);
      expect(await factory.feeAmountTickSpacing(100)).to.eq(5);
    });
    it("emits an event", async () => {
      await expect(factory.enableFeeAmount(100, 5))
        .to.emit(factory, "FeeAmountEnabled")
        .withArgs(100, 5);
    });
    it("enables pool creation", async () => {
      await factory.enableFeeAmount(250, 15);
      await createAndCheckPool([TEST_ADDRESSES[0], TEST_ADDRESSES[1]], 250, 15);
    });
  });
});
