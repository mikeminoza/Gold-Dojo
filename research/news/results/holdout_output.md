| id | role | trades | win % | PF | total R | result $500 | worst drop | losing yrs | streak | spread R | gross R |
|---|---|---|---|---|---|---|---|---|---|---|---|
| FOMC N3 W=30 2R | finalist | 59 | 52.5 | 1.41 | 6.2 | 117.14 | -12.7% | 3 / 8 | 4 | 0.035 | 0.154 |
| FOMC N1 W=30 m=0.5 stop=ext 2R | extra (no verdict weight) | 56 | 46.4 | 0.99 | -0.2 | 159.84 | -14.2% | 3 / 8 | 5 | 0.063 | 0.088 |
| ALL N4 N1 W=30 m=1 stop=2ATR EOS +trend | extra (no verdict weight) | 83 | 14.5 | 0.69 | -22.8 | -77.1 | -27.1% | 5 / 8 | 17 | 0.122 | -0.093 |

| id | PF>1.2 | >=40 trades | drop<30% | random pctl (median, p90) | PF costs x1.5 | non-event days (trades, PF) | robust |
|---|---|---|---|---|---|---|---|
| FOMC N3 W=30 2R | 1.41 pass | 59 pass | -12.7% pass | 87.8 (0.96, 1.45) FAIL | 1.31 pass | 1274, 0.53 pass | no |
| FOMC N1 W=30 m=0.5 stop=ext 2R | 0.99 FAIL | 56 pass | -14.2% pass | 70.9 (0.86, 1.23) FAIL | 0.93 FAIL | 628, 0.6 pass | no |
| ALL N4 N1 W=30 m=1 stop=2ATR EOS +trend | 0.69 FAIL | 83 pass | -27.1% pass | 25.7 (0.82, 1.10) FAIL | 0.64 FAIL | 709, 0.74 FAIL | no |

Neighbours on the holdout:
| reference | neighbour | trades | PF | total R | drop |
|---|---|---|---|---|---|
| FOMC N3 W=30 2R | FOMC N3 W=15 2R | 59 | 1.2 | 3.7 | -16.0% |
| FOMC N3 W=30 2R | FOMC N3 W=30 2h | 59 | 1.44 | 6.3 | -13.1% |
| FOMC N1 W=30 m=0.5 stop=ext 2R | FOMC N1 W=15 m=0.5 stop=ext 2R | 54 | 0.95 | -1.4 | -13.8% |
| FOMC N1 W=30 m=0.5 stop=ext 2R | FOMC N1 W=30 m=1 stop=ext 2R | 52 | 0.99 | -0.3 | -14.2% |
| FOMC N1 W=30 m=0.5 stop=ext 2R | FOMC N1 W=30 m=0.5 stop=1ATR 2R | 9 | 0.96 | -0.2 | -3.4% |
| FOMC N1 W=30 m=0.5 stop=ext 2R | FOMC N1 W=30 m=0.5 stop=ext 2h | 56 | 0.99 | -0.4 | -17.4% |
| ALL N4 N1 W=30 m=1 stop=2ATR EOS +trend | ALL N4 N1 W=15 m=1 stop=2ATR EOS +trend | 82 | 0.58 | -31.0 | -37.3% |
| ALL N4 N1 W=30 m=1 stop=2ATR EOS +trend | ALL N4 N1 W=30 m=0.5 stop=2ATR EOS +trend | 88 | 0.69 | -23.7 | -28.0% |
| ALL N4 N1 W=30 m=1 stop=2ATR EOS +trend | ALL N4 N1 W=30 m=1 stop=1ATR EOS +trend | 25 | 1.12 | 2.7 | -8.8% |
| ALL N4 N1 W=30 m=1 stop=2ATR EOS +trend | ALL N4 N1 W=30 m=1 stop=2ATR 2h +trend | 83 | 0.78 | -15.2 | -19.0% |

Per year (holdout), FOMC N3 W=30 2R:
| entry_time | trades | pf | R | $ |
|---|---|---|---|---|
| 2019 | 7 | 0.51 | -0.7 | -9.46 |
| 2020 | 7 | 0.72 | -0.4 | -9.51 |
| 2021 | 8 | 3.39 | 1.4 | 29.85 |
| 2022 | 8 | 0.19 | -2.9 | -38.29 |
| 2023 | 7 | 1.18 | 0.5 | 6.36 |
| 2024 | 8 | 1.81 | 1.8 | 11.68 |
| 2025 | 8 | 4.11 | 3.8 | 29.28 |
| 2026 | 6 | 2.71 | 2.8 | 97.23 |

Per year (holdout), FOMC N1 W=30 m=0.5 stop=ext 2R:
| entry_time | trades | pf | R | $ |
|---|---|---|---|---|
| 2019 | 8 | 1.76 | 1.7 | 10.24 |
| 2020 | 7 | 0.39 | -2.5 | -17.14 |
| 2021 | 5 | 1.92 | 1.1 | 18.09 |
| 2022 | 8 | 0.28 | -5.1 | -44.28 |
| 2023 | 7 | 0.44 | -2.3 | 8.99 |
| 2024 | 8 | 1.36 | 1.4 | 20.21 |
| 2025 | 8 | 1.72 | 2.9 | 62.3 |
| 2026 | 5 | 3.26 | 2.5 | 101.43 |

Per year (holdout), ALL N4 N1 W=30 m=1 stop=2ATR EOS +trend:
| entry_time | trades | pf | R | $ |
|---|---|---|---|---|
| 2019 | 2 | 0.0 | -2.1 | -7.54 |
| 2020 | 7 | 0.0 | -7.2 | -28.35 |
| 2021 | 12 | 0.63 | -3.8 | -24.09 |
| 2022 | 16 | 0.62 | -5.9 | -14.82 |
| 2023 | 10 | 1.01 | 0.1 | 9.75 |
| 2024 | 13 | 0.53 | -5.8 | -25.57 |
| 2025 | 13 | 1.09 | 0.8 | 15.88 |
| 2026 | 10 | 1.16 | 1.3 | -2.36 |