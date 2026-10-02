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
