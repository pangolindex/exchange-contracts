import brownie
from brownie import chain
from .utils.constants import ADDRESS_ZERO, GOVERNOR
from contextlib import nullcontext as does_not_raise
import pytest

TEST_ADDRESS = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"


def test_set_rewards_contract(owner, pgl_collector):
    pgl_collector.setRewardsContract(TEST_ADDRESS, {"from": owner})
    assert pgl_collector.stakingRewards() == TEST_ADDRESS
    chain.undo()


def test_set_rewards_contract_non_owner(alice, pgl_collector):
    with brownie.reverts():
        pgl_collector.setRewardsContract(TEST_ADDRESS, {"from": alice})


def test_set_rewards_contract_zero_address(owner, pgl_collector):
    with brownie.reverts():
        pgl_collector.setRewardsContract(ADDRESS_ZERO, {"from": owner})


def test_set_harvest_incentive(owner, pgl_collector):
    pgl_collector.setHarvestIncentive(123, {"from": owner})
    assert pgl_collector.harvestIncentive() == 123


def test_set_harvest_incentive_non_owner(alice, pgl_collector):
    with brownie.reverts():
        pgl_collector.setHarvestIncentive(123, {"from": alice})


def test_set_harvest_incentive_over_limit(owner, pgl_collector):
    with brownie.reverts():
        pgl_collector.setHarvestIncentive(
            pgl_collector.MAX_INCENTIVE() + 1, {"from": owner}
        )


def test_set_minichef_pid(owner, pgl_collector):
    pgl_collector.setMiniChefPool(123, {"from": owner})
    assert pgl_collector.miniChefPoolId() == 123


def test_set_minichef_pid_non_owner(alice, pgl_collector):
    with brownie.reverts():
        pgl_collector.setMiniChefPool(123, {"from": alice})


def test_set_rewards_duration(pgl_collector, staking_rewards, owner):
    with brownie.reverts(
        "Previous rewards period must be complete before changing the duration for the new period"
    ):
        pgl_collector.setRewardsDuration(86401, {"from": owner})


def test_set_rewards_duration_non_owner(pgl_collector, alice):
    with brownie.reverts():
        pgl_collector.setRewardsDuration(123, {"from": alice})


def test_transfer_staking_ownership(pgl_collector, owner, staking_rewards, alice):
    pgl_collector.transferStakingOwnership(alice, {"from": owner})
    assert staking_rewards.owner() == alice
    chain.undo()


def test_transfer_staking_ownership_non_owner(pgl_collector, bob):
    with brownie.reverts():
        pgl_collector.transferStakingOwnership(bob, {"from": bob})


def test_set_treasury_fee(pgl_collector):
    pgl_collector.setTreasuryFee(1500, {"from": GOVERNOR})
    assert pgl_collector.treasuryFee() == 1500
    chain.undo()


def test_set_treasury_fee_not_governor(pgl_collector, owner):
    with brownie.reverts("Governor only"):
        pgl_collector.setTreasuryFee(1500, {"from": owner})


def test_set_treasury_fee_too_large(pgl_collector):
    with brownie.reverts("Total fees must <= 100"):
        pgl_collector.setTreasuryFee(15000, {"from": GOVERNOR})


def test_set_treasury(pgl_collector, owner):
    pgl_collector.setTreasury(owner, {"from": owner})
    assert pgl_collector.treasury() == owner
    chain.undo()


def test_set_treasury_not_owner(pgl_collector, alice):
    with brownie.reverts():
        pgl_collector.setTreasury(alice, {"from": alice})


def test_set_treasury_address_zero(pgl_collector, owner):
    with brownie.reverts():
        pgl_collector.setTreasury(ADDRESS_ZERO, {"from": owner})


@pytest.mark.parametrize(
    "harvest_fee,treasury_fee, expectation",
    [
        (0, 500, does_not_raise()),
        (200, 9800, does_not_raise()),
        (0, 10000, does_not_raise()),
        (100, 9999, brownie.reverts("Total fees must <= 100")),
        (1, 10000, brownie.reverts("Total fees must <= 100")),
    ],
)
def test_fee_combinations(harvest_fee, treasury_fee, expectation, pgl_collector, owner):
    pgl_collector.setTreasuryFee(0, {"from": GOVERNOR})
    pgl_collector.setHarvestIncentive(0, {"from": owner})

    with expectation:
        pgl_collector.setTreasuryFee(treasury_fee, {"from": GOVERNOR})
        pgl_collector.setHarvestIncentive(harvest_fee, {"from": owner})
        chain.undo(2)

    with expectation:
        pgl_collector.setHarvestIncentive(harvest_fee, {"from": owner})
        pgl_collector.setTreasuryFee(treasury_fee, {"from": GOVERNOR})
