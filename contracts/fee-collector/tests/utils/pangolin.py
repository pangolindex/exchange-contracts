from brownie import Contract, interface
from brownie.network.account import Account
import time
from .constants import PNG, MINICHEF, PANGOLIN_FACTORY, PANGOLIN_ROUTER, WAVAX, USDT


def pangolin_router() -> Contract:
    return interface.IPangolinRouter(PANGOLIN_ROUTER)


def pangolin_factory() -> Contract:
    return interface.IPangolinFactory(PANGOLIN_FACTORY)


def png_token() -> Contract:
    return interface.IERC20(PNG)


def minichef() -> Contract:
    return interface.IMiniChef(MINICHEF)


def WAVAX_contract() -> Contract:
    return interface.IWAVAX(WAVAX)


def swap(account: Account, token: str, amount: int):
    pangolin_router().swapExactAVAXForTokens(
        0,
        [WAVAX, token],
        account,
        int(time.time() + 60),
        {"from": account, "value": amount},
    )


def approx(a, b, precision=1e-10):
    if a == b == 0:
        return True
    return 2 * abs(a - b) / (a + b) <= precision


def get_avax_price_from_pair(numeraire: str) -> int:
    """
    Returns the price of one AVAX token in another (numeraire)
    Used for approximation purpose only
    :return:
    """
    _, price = pangolin_router().getAmountsOut(1 * 10 ** 18, [WAVAX, numeraire])
    return price


def deposit_liquidity(token0: str, token1: str, account: Account, amount: int):
    """
    Swap AVAX for token1 and token2 50/50, then deposit liquidity in token1-token2 pool
    :param token0: First token in the pair
    :param token1: Second token in the pair
    :param account: Account for which to do the deposit
    :param amount: Amount of token 1 that will be split 50/50 and deposited
    :return:
    """
    assert token0 != token1, "Tokens must be different"
    # using WAVAX address as argument for native AVAX
    is_avax_pair = token1 == WAVAX or token0 == WAVAX
    non_avax_token = None
    if token0 != WAVAX:
        swap(account, token0, amount // 2)
        interface.IERC20(token0).approve(
            PANGOLIN_ROUTER, (2 ** 256 - 1), {"from": account}
        )
        non_avax_token = token0

    if token1 != WAVAX:
        swap(account, token1, amount // 2)
        interface.IERC20(token1).approve(
            PANGOLIN_ROUTER, (2 ** 256 - 1), {"from": account}
        )
        non_avax_token = token1

    if is_avax_pair:
        pangolin_router().addLiquidityAVAX(
            non_avax_token,
            interface.IERC20(non_avax_token).balanceOf(account),
            0,
            0,
            account,
            int(time.time()) + 60,
            {"from": account, "value": amount // 2},
        )
    else:
        pangolin_router().addLiquidity(
            token0,
            token1,
            interface.IERC20(token0).balanceOf(account),
            interface.IERC20(token1).balanceOf(account),
            0,
            0,
            account,
            int(time.time()) + 60,
            {"from": account},
        )
