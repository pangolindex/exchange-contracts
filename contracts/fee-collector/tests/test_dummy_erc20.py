import brownie
from .utils.constants import PGL_DEPOSIT_AMOUNT


def test_mint(dummy_lp_token, owner, bob):
    original_supply = dummy_lp_token.totalSupply()
    dummy_lp_token.mint(bob, PGL_DEPOSIT_AMOUNT, {"from": owner})
    assert dummy_lp_token.totalSupply() == original_supply + PGL_DEPOSIT_AMOUNT
    assert dummy_lp_token.balanceOf(bob) == PGL_DEPOSIT_AMOUNT


def test_mint_non_owner(dummy_lp_token, alice):
    with brownie.reverts():
        dummy_lp_token.mint(alice, PGL_DEPOSIT_AMOUNT, {"from": alice})


def test_burn(dummy_lp_token, owner):
    original_supply = dummy_lp_token.totalSupply()
    dummy_lp_token.mint(owner, PGL_DEPOSIT_AMOUNT, {"from": owner})
    assert dummy_lp_token.totalSupply() == original_supply + PGL_DEPOSIT_AMOUNT
    assert dummy_lp_token.balanceOf(owner) == PGL_DEPOSIT_AMOUNT
    dummy_lp_token.burn(owner, PGL_DEPOSIT_AMOUNT, {"from": owner})
    assert dummy_lp_token.totalSupply() == original_supply
    assert dummy_lp_token.balanceOf(owner) == 0


def test_burn_non_owner(dummy_lp_token, alice, owner):
    dummy_lp_token.mint(alice, PGL_DEPOSIT_AMOUNT, {"from": owner})
    with brownie.reverts():
        dummy_lp_token.burn(alice, PGL_DEPOSIT_AMOUNT, {"from": alice})
