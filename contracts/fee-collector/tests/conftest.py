from brownie import PangolinFeeCollector, DummyERC20, StakingRewards
from brownie import interface, chain
from .utils.constants import (
    PNG,
    PGL_DEPOSIT_AMOUNT,
    MINICHEF_OWNER,
    PAIRS,
    ADDRESS_ZERO,
    DEPOSIT_AMOUNT,
    GOVERNOR,
)
from .utils.pangolin import minichef, deposit_liquidity, pangolin_factory
import pytest


@pytest.fixture(scope="session")
def alice(accounts):
    yield accounts[1]


@pytest.fixture(scope="session")
def bob(accounts):
    yield accounts[2]


@pytest.fixture(scope="session")
def charlie(accounts):
    yield accounts[3]


@pytest.fixture(scope="session")
def owner(accounts):
    yield accounts[0]


@pytest.fixture(scope="session")
def staking_rewards(owner):
    yield StakingRewards.deploy(PNG, PNG, {"from": owner})


@pytest.fixture(scope="session")
def pgl_collector(owner, staking_rewards):
    collector = PangolinFeeCollector.deploy(staking_rewards, 0, {"from": owner})
    staking_rewards.transferOwnership(collector, {"from": owner})
    collector.setTreasuryFee(500, {"from": GOVERNOR})
    yield collector


@pytest.fixture(scope="session")
def dummy_lp_token(owner):
    yield DummyERC20.deploy(
        "DummyLP", "PGL", owner, PGL_DEPOSIT_AMOUNT, {"from": owner}
    )


@pytest.fixture(scope="session", autouse=True)
def deposit_seed_liquidity(charlie, pgl_collector):
    for i, pair in enumerate(PAIRS):
        print(f"Depositing liquidity for pair {i}/{len(PAIRS)}")
        deposit_liquidity(pair[0], pair[1], charlie, DEPOSIT_AMOUNT * 1e18)
        pgl_pair = interface.IPangolinPair(pangolin_factory().getPair(pair[0], pair[1]))
        assert pgl_pair.balanceOf(charlie) > 0, f"Liquidity deposit failed for {pair}"


@pytest.fixture(scope="function")
def deposit_lp_tokens(charlie, pgl_collector):
    pgls = []
    for i, pair in enumerate(PAIRS):
        pgl_pair = interface.IPangolinPair(pangolin_factory().getPair(pair[0], pair[1]))
        pgls.append(pgl_pair)
        pgl_pair.transfer(
            pgl_collector, pgl_pair.balanceOf(charlie) // 100, {"from": charlie}
        )
    yield pgls


@pytest.fixture(scope="session", autouse=True)
def create_dummy_minichef_rewards(owner, dummy_lp_token, pgl_collector):
    mchef = minichef()
    mchef.addPool(1000, dummy_lp_token, ADDRESS_ZERO, {"from": MINICHEF_OWNER})
    pid = mchef.poolLength() - 1
    dummy_lp_token.approve(mchef, 2 ** 256 - 1, {"from": owner})
    mchef.deposit(pid, PGL_DEPOSIT_AMOUNT, pgl_collector, {"from": owner})
    chain.mine(100)
    pgl_collector.setMiniChefPool(pid, {"from": owner})
