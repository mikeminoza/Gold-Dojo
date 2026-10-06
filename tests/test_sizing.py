import config
import sizing


def test_risks_about_the_chosen_percent():
    s = sizing.lot_size(2000.0, 1995.0, 2010.0, balance=10_000, risk_percent=1.0)
    # $5 stop x 100 oz = $500 per lot; 1% of $10,000 = $100 -> 0.20 lot
    assert s["lots"] == 0.20
    assert s["risk"] == 100.0
    assert s["verdict"] == "ok"


def test_minimum_lot_and_over_limit_warning():
    s = sizing.lot_size(2000.0, 1985.0, 2030.0, balance=500, risk_percent=1.0)
    assert s["lots"] == config.MIN_LOT
    assert s["risk_percent"] == 3.0          # 0.01 lot x $15 stop x 100 oz = $15 = 3% of $500
    assert s["verdict"] == "skip"            # above MAX_RISK_PERCENT


def test_money_per_oz_to_dollars():
    assert sizing.money(2.5, 0.10) == 25.0


def test_trade_excursions_in_r():
    import bot
    pos = {"side": "BUY", "entry": 2000.0, "sl": 1995.0, "tp": 2010.0}
    b = bot.Bot.__new__(bot.Bot)
    b.position = pos
    b.close = lambda price, reason: None
    for bid in (2003.0, 2008.0, 1998.0, 2001.0):  # up to +8, down to -2
        b.check_sl_tp(bid, bid + 0.3)
    assert bot.Bot._excursions(pos, 1.0) == {"mfe_r": 1.6, "mae_r": -0.4}


def test_cost_tag_marks_expensive_trades():
    import bot
    # spread 0.50 + 0.20 slippage = 0.70 on an $11.74 stop = 6.0% -> kept at the 8% filter
    assert bot.Bot.cost_tag(4163.14, 4163.64, 4163.14, 4174.88) == {"cost_pct": 6.0, "cost_keep": True}
    # same costs on a $5 stop = 14% -> the filter would skip it
    assert bot.Bot.cost_tag(2000.0, 2000.5, 2000.0, 1995.0)["cost_keep"] is False
