import brownie
from brownie import Contract, interface, chain
from decimal import Decimal
from .utils.constants import (
    PAIRS,
    PNG,
    WAVAX,
    WETH,
    MINICHEF_HARVEST_EVENT_SIG,
    DEPOSIT_AMOUNT,
    MINICHEF,
    GOVERNOR,
)
from .utils.pangolin import swap, png_token, get_avax_price_from_pair, approx


def get_fee(pgl_collector: Contract) -> Decimal:
    return Decimal(pgl_collector.harvestIncentive()) / Decimal(
        pgl_collector.FEE_DENOMINATOR()
    )


def get_treasury_fee(pgl_collector: Contract) -> Decimal:
    return Decimal(pgl_collector.treasuryFee()) / Decimal(
        pgl_collector.FEE_DENOMINATOR()
    )


def test_harvest_multiple_pools_no_masterchef(
    alice, pgl_collector, staking_rewards, deposit_lp_tokens
):

    treasury_fee = get_treasury_fee(pgl_collector)
    treasury = pgl_collector.treasury()

    avax_price = get_avax_price_from_pair(PNG)
    pgls = deposit_lp_tokens
    png = png_token()

    original_alice_png_balance = png.balanceOf(alice)
    original_staking_contract_png_balance = png.balanceOf(staking_rewards)
    original_staking_period_finish = staking_rewards.periodFinish()
    original_staking_rate = staking_rewards.rewardRate()
    original_treasury_balance = png.balanceOf(treasury)

    for pgl_pair in pgls:
        assert (
            pgl_pair.balanceOf(pgl_collector) != 0
        ), f"LP Token not on contract {pgl_pair}"
    tx = pgl_collector.harvest(pgls, False, {"from": alice})
    for pgl_pair in pgls:
        assert (
            pgl_pair.balanceOf(pgl_collector) == 0
        ), f"LP Token still on contract after harvest {pgl_pair}"

    original_price = avax_price * len(PAIRS) * DEPOSIT_AMOUNT // 100
    fee = get_fee(pgl_collector)
    transferred_png_amount = (
        png.balanceOf(staking_rewards) - original_staking_contract_png_balance
    )
    alice_received_png_amount = png.balanceOf(alice) - original_alice_png_balance
    treasury_received_png_amount = png.balanceOf(treasury) - original_treasury_balance
    print("PNG Added to staking contract:", transferred_png_amount)
    print("PNG paid to caller:", alice_received_png_amount)
    print("PNG paid to treasury:", treasury_received_png_amount)
    print("Original AVAX amount in PNG:", original_price)

    assert approx(
        alice_received_png_amount,
        int(transferred_png_amount / (1 - fee - treasury_fee) * fee),
        0.05,
    ), "Caller received more than fee"
    assert approx(
        treasury_received_png_amount,
        int(transferred_png_amount / (1 - fee - treasury_fee) * treasury_fee),
        0.05,
    ), "Treasury received more than fee"
    assert approx(
        transferred_png_amount
        + alice_received_png_amount
        + treasury_received_png_amount,
        original_price,
        0.05,
    ), "Transferred PNG amount deviates from original"

    assert (
        staking_rewards.periodFinish() > original_staking_period_finish
    ), "Staking finish period unchanged"
    assert (
        staking_rewards.rewardRate() != original_staking_rate
    ), "Staking reward rate unchanged"

    assert sum([log["address"] == MINICHEF for log in tx.logs]) == 0


def test_full_harvest(alice, pgl_collector, staking_rewards, deposit_lp_tokens):

    treasury_fee = get_treasury_fee(pgl_collector)
    treasury = pgl_collector.treasury()

    pgls = deposit_lp_tokens
    png = png_token()
    avax_price = get_avax_price_from_pair(PNG)

    original_alice_png_balance = png.balanceOf(alice)
    original_staking_contract_png_balance = png.balanceOf(staking_rewards)
    original_staking_period_finish = staking_rewards.periodFinish()
    original_staking_rate = staking_rewards.rewardRate()
    original_treasury_balance = png.balanceOf(treasury)

    for pgl_pair in pgls:
        balance = pgl_pair.balanceOf(pgl_collector)
        assert balance != 0, f"LP Token not on contract {pgl_pair}"

    tx = pgl_collector.harvest(pgls, True, {"from": alice})

    for pgl_pair in pgls:
        assert (
            pgl_pair.balanceOf(pgl_collector) == 0
        ), f"LP Token still on contract after harvest {pgl_pair}"

    assert (
        sum([log["address"] == MINICHEF for log in tx.logs]) > 0
    ), "Minichef harvest did not happen"

    harvest_value = None
    for log in tx.logs:
        if (
            log["address"] == MINICHEF
            and log["topics"][0].hex() == MINICHEF_HARVEST_EVENT_SIG
        ):
            harvest_value = int(log["data"], 16)

    assert harvest_value is not None, "Nothing harvested from Minichef"

    fee = get_fee(pgl_collector)
    original_price = avax_price * len(PAIRS) * DEPOSIT_AMOUNT // 100
    transferred_png_amount = (
        png.balanceOf(staking_rewards) - original_staking_contract_png_balance
    )
    alice_received_png_amount = png.balanceOf(alice) - original_alice_png_balance
    treasury_received_png_amount = png.balanceOf(treasury) - original_treasury_balance
    print("PNG Added to staking contract:", transferred_png_amount)
    print("PNG paid to caller:", alice_received_png_amount)
    print("PNG paid to treasury:", treasury_received_png_amount)
    print("PNG harvested from minichef:", harvest_value)
    print("Original AVAX amount in PNG:", original_price)

    assert approx(
        alice_received_png_amount,
        int(transferred_png_amount / (1 - fee - treasury_fee) * fee),
        0.05,
    ), "Caller received more than fee"
    assert approx(
        treasury_received_png_amount,
        int(transferred_png_amount / (1 - fee - treasury_fee) * treasury_fee),
        0.05,
    ), "Treasury received more than fee"
    assert approx(
        transferred_png_amount
        + alice_received_png_amount
        + treasury_received_png_amount
        - harvest_value,
        original_price,
        0.05,
    ), "Transferred PNG amount deviates from original"

    assert (
        staking_rewards.periodFinish() > original_staking_period_finish
    ), "Staking finish period unchanged"
    assert (
        staking_rewards.rewardRate() != original_staking_rate
    ), "Staking reward rate unchanged"


def test_harvest_masterchef_only(
    alice, pgl_collector, staking_rewards, deposit_lp_tokens
):

    treasury_fee = get_treasury_fee(pgl_collector)
    treasury = pgl_collector.treasury()

    pgls = deposit_lp_tokens
    png = png_token()

    original_alice_png_balance = png.balanceOf(alice)
    original_staking_contract_png_balance = png.balanceOf(staking_rewards)
    original_staking_period_finish = staking_rewards.periodFinish()
    original_staking_rate = staking_rewards.rewardRate()
    original_treasury_balance = png.balanceOf(treasury)

    previous_balances = []
    for pgl_pair in pgls:
        balance = pgl_pair.balanceOf(pgl_collector)
        previous_balances.append(balance)
        assert balance != 0, f"LP Token not on contract {pgl_pair}"

    tx = pgl_collector.harvest([], True, {"from": alice})

    for i, pgl_pair in enumerate(pgls):
        assert (
            pgl_pair.balanceOf(pgl_collector) == previous_balances[i]
        ), f"LP Token wrongly harvested {pgl_pair}"

    assert (
        sum([log["address"] == MINICHEF for log in tx.logs]) > 0
    ), "Minichef harvest did not happen"

    harvest_value = None
    for log in tx.logs:
        if (
            log["address"] == MINICHEF
            and log["topics"][0].hex() == MINICHEF_HARVEST_EVENT_SIG
        ):
            harvest_value = int(log["data"], 16)

    assert harvest_value is not None, "Nothing harvested from Minichef"

    fee = get_fee(pgl_collector)
    transferred_png_amount = (
        png.balanceOf(staking_rewards) - original_staking_contract_png_balance
    )
    alice_received_png_amount = png.balanceOf(alice) - original_alice_png_balance
    treasury_received_png = png.balanceOf(treasury) - original_treasury_balance
    print("PNG Added to staking contract:", transferred_png_amount)
    print("PNG paid to caller:", alice_received_png_amount)
    print("PNG paid to treasury:", treasury_received_png)
    print("PNG harvested from minichef:", harvest_value)

    assert approx(
        alice_received_png_amount,
        int(transferred_png_amount / (1 - fee - treasury_fee) * fee),
        0.05,
    ), "Caller received more than fee"
    assert approx(
        treasury_received_png,
        int(transferred_png_amount / (1 - fee - treasury_fee) * treasury_fee),
        0.05,
    ), "Treasury received more than fee"
    assert (
        staking_rewards.periodFinish() > original_staking_period_finish
    ), "Staking finish period unchanged"
    assert (
        staking_rewards.rewardRate() != original_staking_rate
    ), "Staking reward rate unchanged"


def test_harvest_nothing(alice, pgl_collector, staking_rewards, deposit_lp_tokens):

    treasury = pgl_collector.treasury()
    pgls = deposit_lp_tokens
    png = png_token()

    original_alice_png_balance = png.balanceOf(alice)
    original_staking_contract_png_balance = png.balanceOf(staking_rewards)
    original_staking_period_finish = staking_rewards.periodFinish()
    original_staking_rate = staking_rewards.rewardRate()
    original_treasury_balance = png.balanceOf(treasury)

    previous_balances = []
    for pgl_pair in pgls:
        balance = pgl_pair.balanceOf(pgl_collector)
        previous_balances.append(balance)
        assert balance != 0, f"LP Token not on contract {pgl_pair}"

    tx = pgl_collector.harvest([], False, {"from": alice})
    for i, pgl_pair in enumerate(pgls):
        assert (
            pgl_pair.balanceOf(pgl_collector) == previous_balances[i]
        ), f"LP Token wrongly harvested {pgl_pair}"

    transferred_png_amount = (
        png.balanceOf(staking_rewards) - original_staking_contract_png_balance
    )
    alice_received_png_amount = png.balanceOf(alice) - original_alice_png_balance
    treasury_received_png_amount = png.balanceOf(treasury) - original_treasury_balance

    print("PNG Added to staking contract:", transferred_png_amount)
    print("PNG paid to caller:", alice_received_png_amount)

    assert alice_received_png_amount == 0, "Caller received fee for 0 value harvest"
    assert (
        treasury_received_png_amount == 0
    ), "Treasury received fee for 0 value harvest"
    assert transferred_png_amount == 0, "Transferred PNG despite 0 value harvest"

    assert (
        staking_rewards.periodFinish() == original_staking_period_finish
    ), "Staking finish period should remain unchanged"
    assert (
        staking_rewards.rewardRate() == original_staking_rate
    ), "Staking reward rate should remain unchanged"

    assert (len(tx.logs)) == 0


def test_harvest_no_treasury_fee(
    owner, pgl_collector, staking_rewards, deposit_lp_tokens
):
    pgl_collector.setTreasuryFee(0, {"from": GOVERNOR})
    treasury = pgl_collector.treasury()
    pgls = deposit_lp_tokens
    png = png_token()
    original_treasury_balance = png.balanceOf(treasury)
    original_staking_contract_png_balance = png.balanceOf(staking_rewards)
    tx = pgl_collector.harvest(pgls, True, {"from": owner})
    transferred_png_amount = (
        png.balanceOf(staking_rewards) - original_staking_contract_png_balance
    )
    # check for no empty erc20 transfer to treasury
    assert tx.events[-1]["to"] == owner
    assert tx.events[-2]["reward"] == transferred_png_amount
    assert png.balanceOf(treasury) == original_treasury_balance
    chain.undo(2)


def test_harvest_no_caller_fee(
    alice, owner, pgl_collector, staking_rewards, deposit_lp_tokens
):
    pgl_collector.setHarvestIncentive(0, {"from": owner})
    treasury = pgl_collector.treasury()
    pgls = deposit_lp_tokens
    png = png_token()
    original_alice_png_balance = png.balanceOf(alice)
    original_staking_contract_png_balance = png.balanceOf(staking_rewards)
    tx = pgl_collector.harvest(pgls, True, {"from": alice})
    transferred_png_amount = (
        png.balanceOf(staking_rewards) - original_staking_contract_png_balance
    )
    # check for no empty erc20 transfer to caller
    # events[-1] is DelegateVotesChanged event after PNG transfer
    assert tx.events[-2]["to"] == treasury
    assert tx.events[-3]["reward"] == transferred_png_amount
    assert png.balanceOf(alice) == original_alice_png_balance
    chain.undo(2)


def test_harvest_all_to_treasury_fee(
    alice, owner, pgl_collector, staking_rewards, deposit_lp_tokens
):
    pgl_collector.setHarvestIncentive(0, {"from": owner})
    pgl_collector.setTreasuryFee(10000, {"from": GOVERNOR})
    treasury = pgl_collector.treasury()
    pgls = deposit_lp_tokens
    png = png_token()
    original_alice_png_balance = png.balanceOf(alice)
    original_treasury_balance = png.balanceOf(treasury)
    original_staking_contract_png_balance = png.balanceOf(staking_rewards)
    tx = pgl_collector.harvest(pgls, True, {"from": alice})
    transferred_png_amount = (
        png.balanceOf(staking_rewards) - original_staking_contract_png_balance
    )
    # check for no empty transfers
    assert tx.events[-2]["to"] == treasury
    assert tx.events[-3]["to"] == pgl_collector
    assert transferred_png_amount == 0
    assert original_treasury_balance < png.balanceOf(treasury)
    assert png.balanceOf(alice) == original_alice_png_balance
    chain.undo(3)


def test_harvest_harvest_wrong_minichef_pool(
    alice, owner, pgl_collector, staking_rewards
):

    treasury = pgl_collector.treasury()
    png = png_token()

    original_alice_png_balance = png.balanceOf(alice)
    original_staking_contract_png_balance = png.balanceOf(staking_rewards)
    original_staking_period_finish = staking_rewards.periodFinish()
    original_staking_rate = staking_rewards.rewardRate()
    original_treasury_balance = png.balanceOf(treasury)

    pgl_collector.setMiniChefPool(2, {"from": owner})
    pgl_collector.harvest([], True, {"from": alice})

    transferred_png_amount = (
        png.balanceOf(staking_rewards) - original_staking_contract_png_balance
    )
    alice_received_png_amount = png.balanceOf(alice) - original_alice_png_balance
    treasury_received_png_amount = png.balanceOf(treasury) - original_treasury_balance
    print("PNG Added to staking contract:", transferred_png_amount)
    print("PNG paid to treasury:", treasury_received_png_amount)
    print("PNG paid to caller:", alice_received_png_amount)

    assert alice_received_png_amount == 0, "Caller received fee for 0 value harvest"
    assert (
        treasury_received_png_amount == 0
    ), "Treasury received fee for 0 value harvest"
    assert transferred_png_amount == 0, "Transferred PNG despite 0 value harvest"

    assert (
        staking_rewards.periodFinish() == original_staking_period_finish
    ), "Staking finish period should remain unchanged"
    assert (
        staking_rewards.rewardRate() == original_staking_rate
    ), "Staking reward rate should remain unchanged"


def test_harvest_harvest_inexistant_minichef_pool(
    alice, owner, pgl_collector, staking_rewards
):

    with brownie.reverts():
        pgl_collector.setMiniChefPool(10 ** 5, {"from": owner})
        pgl_collector.harvest([], True, {"from": alice})
    chain.undo(2)


def test_harvest_random_tokens(alice, owner, pgl_collector):

    tx = pgl_collector.harvest([PNG, WAVAX, WETH], False, {"from": alice})
    assert (len(tx.logs)) == 0


def test_harvest_too_many_pairs(owner, pgl_collector):
    with brownie.reverts():
        pgl_collector.harvest([PNG] * 51, False, {"from": owner})


def test_harvest_stuck_tokens(alice, owner, pgl_collector):
    swap(alice, WETH, 1e22)
    weth = interface.IERC20(WETH)
    weth.transfer(pgl_collector, weth.balanceOf(alice), {"from": alice})
    with brownie.reverts():
        pgl_collector.harvest([WETH], False, {"from": alice})


def test_harvest_non_owned_staking_contract(
    alice, bob, deposit_lp_tokens, owner, pgl_collector, staking_rewards
):
    pgl_collector.transferStakingOwnership(alice, {"from": owner})

    pgls = deposit_lp_tokens

    with brownie.reverts():
        pgl_collector.harvest(pgls, True, {"from": alice})

    staking_rewards.transferOwnership(pgl_collector, {"from": alice})
    pgl_collector.harvest(pgls, True, {"from": alice})

    for pgl_pair in pgls:
        assert (
            pgl_pair.balanceOf(pgl_collector) == 0
        ), f"LP Token still on contract after harvest {pgl_pair}"


def test_harvest_call_from_contract(pgl_collector):
    with brownie.reverts("No contracts"):
        pgl_collector.harvest([], True, {"from": GOVERNOR})
