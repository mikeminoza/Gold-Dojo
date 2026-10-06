# Holdout 2019-01-01 - 2026-09-30 (run 2026-10-06 03:19 UTC, once)

finalists frozen 2026-10-06 03:18 UTC: none

| id | trades | per_yr | win_% | pf | total_R | avg_R | drop_% | result_$ | drop_$% | losing_years | years | loss_streak | spread_R | tp_% | floored | skip_lots | role |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A A1 dir=none k=1.5 rf=on | 233 | 30.1 | 27.9 | 0.73 | -45.7 | -0.196 | -48.7 | -202.45 | -52.3 | 6 | 8 | 12 | 0.092 | 27.0 | 20 | 51 | reference (no verdict weight) |
| B H1 N=8 dir=ema stop=1.0ATR 2R | 113 | 14.6 | 32.7 | 0.67 | -23.9 | -0.211 | -31.6 | -78.64 | -35.4 | 6 | 8 | 8 | 0.089 | 15.9 | 4 | 9 | reference (no verdict weight) |
| NY live | 726 | 93.7 | 40.5 | 0.82 | -64.8 | -0.089 | -82.9 | -203.8 | -75.0 | 6 | 8 | 12 | 0.087 | 11.8 | 0 | 97 | live reference |

## Pre-registered checks

| id | role | PF | trades | drop_%(R) | random pctl (median, p90) | PF costs x1.5 | max year share of R | passes | robust |
|---|---|---|---|---|---|---|---|---|---|
| A A1 dir=none k=1.5 rf=on | reference (no verdict weight) | 0.73 | 233 | -48.7 | 23.8 (0.8, 0.93) | 0.64 | - | 1 | no |
| B H1 N=8 dir=ema stop=1.0ATR 2R | reference (no verdict weight) | 0.67 | 113 | -31.6 | 39.7 (0.7, 0.88) | 0.62 | - | 1 | no |

NY live with costs x1.5: PF 0.70

## Neighbours on the holdout (reported only)

| id | trades | per_yr | win_% | pf | total_R | avg_R | drop_% | result_$ | drop_$% | losing_years | years | loss_streak | spread_R | tp_% | floored | skip_lots |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| A A2 dir=none k=1.5 rf=on | 265 | 34.2 | 27.9 | 0.73 | -53.4 | -0.202 | -57.3 | -253.38 | -60.5 | 6 | 8 | 16 | 0.094 | 26.8 | 27 | 53 |
| A A1 dir=trend k=1.5 rf=on | 114 | 14.7 | 31.6 | 0.86 | -11.0 | -0.096 | -16.5 | -113.06 | -37.8 | 6 | 8 | 13 | 0.087 | 29.8 | 12 | 26 |
| A A1 dir=none k=1 rf=on | 233 | 30.1 | 26.2 | 0.67 | -58.1 | -0.249 | -59.1 | -235.31 | -54.1 | 6 | 8 | 15 | 0.127 | 25.8 | 52 | 22 |
| A A1 dir=none k=1.5 rf=off | 1317 | 170.0 | 28.5 | 0.75 | -238.7 | -0.181 | -249.2 | -951.0 | -220.3 | 8 | 8 | 21 | 0.119 | 27.8 | 254 | 120 |
| B M30 N=8 dir=ema stop=1.0ATR 2R | 290 | 37.4 | 31.4 | 0.78 | -44.9 | -0.155 | -64.7 | -186.03 | -51.9 | 5 | 8 | 11 | 0.122 | 26.2 | 36 | 23 |
| B H1 N=4 dir=ema stop=1.0ATR 2R | 215 | 27.7 | 30.7 | 0.61 | -53.2 | -0.247 | -54.3 | -230.16 | -51.6 | 8 | 8 | 8 | 0.09 | 14.4 | 9 | 16 |
| B H1 N=8 dir=none stop=1.0ATR 2R | 214 | 27.6 | 31.8 | 0.68 | -45.0 | -0.21 | -52.4 | -115.96 | -54.5 | 7 | 8 | 10 | 0.084 | 17.3 | 6 | 28 |
| B H1 N=8 dir=ema stop=mid 2R | 113 | 14.6 | 48.7 | 0.99 | -0.5 | -0.004 | -10.6 | 52.78 | -28.7 | 5 | 8 | 5 | 0.047 | 4.4 | 0 | 61 |
| B H1 N=8 dir=ema stop=1.5ATR 2R | 113 | 14.6 | 42.5 | 0.93 | -4.1 | -0.036 | -19.8 | 8.8 | -32.6 | 4 | 8 | 7 | 0.064 | 15.0 | 0 | 25 |
| B H1 N=8 dir=ema stop=1.0ATR 3R | 113 | 14.6 | 31.9 | 0.71 | -21.0 | -0.186 | -31.6 | -69.63 | -35.5 | 5 | 8 | 8 | 0.091 | 8.8 | 4 | 9 |

## Per year (holdout), R / $ (trades)

| year | A A1 dir=none k=1.5 rf=on | B H1 N=8 dir=ema stop=1.0ATR 2R | NY live |
|---|---|---|---|
| 2019 | -16.3 / -63.93 (27) | -2.3 / -11.72 (14) | -14.0 / -53.65 (64) |
| 2020 | -7.8 / -68.59 (31) | +5.2 / +33.53 (19) | -34.8 / -179.87 (105) |
| 2021 | -3.7 / -17.30 (24) | -6.6 / -26.59 (11) | -9.4 / -43.07 (88) |
| 2022 | +0.4 / +6.25 (23) | -1.9 / -6.55 (15) | +1.9 / +16.88 (96) |
| 2023 | -10.8 / -33.65 (21) | -10.0 / -35.58 (23) | -7.3 / -25.21 (87) |
| 2024 | -6.5 / -25.58 (24) | -2.9 / -16.62 (15) | -5.0 / -6.06 (111) |
| 2025 | +1.3 / +14.62 (52) | -7.2 / -60.10 (10) | +4.6 / +118.54 (106) |
| 2026 | -2.4 / -14.28 (31) | +1.9 / +44.99 (6) | -0.7 / -31.37 (69) |

## Combination with the live New York breakout (holdout, 1% risk each, R)

| stream | total_R | pf_days | drop_R | R_per_drop | sharpe_monthly |
|---|---|---|---|---|---|
| NY live alone | -64.8 | 0.82 | -82.9 | -0.78 | -0.83 |
| A A1 dir=none k=1.5 rf=on alone | -45.7 | 0.73 | -48.7 | -0.94 | -0.85 |
| NY live + A A1 dir=none k=1.5 rf=on | -110.5 | 0.78 | -127.0 | -0.87 | -1.13 |
| B H1 N=8 dir=ema stop=1.0ATR 2R alone | -23.9 | 0.67 | -31.6 | -0.75 | -0.68 |
| NY live + B H1 N=8 dir=ema stop=1.0ATR 2R | -88.7 | 0.78 | -105.9 | -0.84 | -1.08 |

Correlation with NY live (daily R over all holdout weekdays; monthly R): {"A A1 dir=none k=1.5 rf=on": {"daily": 0.008, "monthly": 0.068, "same_day_trades": 89}, "B H1 N=8 dir=ema stop=1.0ATR 2R": {"daily": 0.046, "monthly": -0.106, "same_day_trades": 58}}