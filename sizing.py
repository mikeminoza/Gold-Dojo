"""Position sizing: how many lots so a trade risks about RISK_PERCENT of the account."""
import math

import config


def lot_size(entry, sl, tp, balance=None, risk_percent=None):
    """Suggested lots plus the money at risk and at target for a trade."""
    balance = config.ACCOUNT_BALANCE if balance is None else balance
    risk_percent = config.RISK_PERCENT if risk_percent is None else risk_percent

    risk_per_lot = abs(entry - sl) * config.OZ_PER_LOT
    wanted = balance * risk_percent / 100
    steps = math.floor(wanted / risk_per_lot / config.LOT_STEP + 1e-9) if risk_per_lot > 0 else 0
    lots = round(steps * config.LOT_STEP, 2)
    below_min = lots < config.MIN_LOT
    if below_min:
        lots = config.MIN_LOT

    risk = lots * risk_per_lot
    reward = lots * abs(tp - entry) * config.OZ_PER_LOT
    actual = 100 * risk / balance
    if actual > config.MAX_RISK_PERCENT:
        verdict = "skip"
        note = (f"Even {lots:.2f} lot risks {actual:.1f}% of the account, above your "
                f"{config.MAX_RISK_PERCENT:g}% limit. Consider skipping this one.")
    elif below_min and actual > risk_percent + 0.05:
        verdict = "high"
        note = f"The smallest lot risks {actual:.1f}%, a bit above your {risk_percent:g}% target."
    else:
        verdict = "ok"
        note = f"Risks {actual:.1f}% of the account."
    return {"lots": lots, "risk": round(risk, 2), "reward": round(reward, 2),
            "risk_percent": round(actual, 2), "verdict": verdict, "note": note}


def money(pnl_per_oz, lots):
    """Profit/loss in account currency for a result in $ per oz."""
    return pnl_per_oz * lots * config.OZ_PER_LOT
