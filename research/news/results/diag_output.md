FOMC N3 W=30 2R: train PF 1.34 (80 trades); random-direction pctl 99.5 (median 0.61, p90 0.89); non-event days 1622 trades, PF 0.38; PF costs x1.5 1.00
   train: longs 46 R 0.2, shorts 34 R 3.6; median risk $9.55; lot 'skip' 37; exits {'Time': 78, 'SL': 2}; median spread at entry $0.43
   holdout: longs 33 R 3.8, shorts 26 R 2.3; median risk $14.95; lot 'skip' 43; exits {'Time': 44, 'SL': 11, 'TP': 4}; median spread at entry $0.44
   per year, train:
| entry_time | trades | pf | R | $ |
|---|---|---|---|---|
| 2004 | 2 | 0.33 | -0.3 | -0.95 |
| 2005 | 3 | 22.01 | 0.9 | 3.67 |
| 2006 | 7 | 1.21 | 0.2 | 3.55 |
| 2007 | 6 | 0.32 | -0.7 | -4.26 |
| 2008 | 8 | 1.15 | 0.2 | 3.23 |
| 2009 | 4 | 0.25 | -1.0 | -1.18 |
| 2010 | 6 | 0.81 | -0.2 | -5.9 |
| 2011 | 7 | 1.59 | 1.1 | -16.83 |
| 2012 | 5 | 1.53 | 0.3 | 11.79 |
| 2013 | 5 | 3.15 | 0.9 | 20.34 |
| 2014 | 3 | 5.76 | 0.3 | 3.8 |
| 2015 | 4 | 0.0 | -0.7 | -9.56 |
| 2016 | 5 | 30.71 | 1.7 | 20.25 |
| 2017 | 7 | 6.23 | 1.5 | 14.26 |
| 2018 | 8 | 0.63 | -0.4 | -3.74 |
FOMC N1 W=30 m=0.5 stop=ext 2R: train PF 1.46 (87 trades); random-direction pctl 99.7 (median 0.78, p90 1.07); non-event days 708 trades, PF 0.47; PF costs x1.5 1.30
   train: longs 43 R 8.9, shorts 44 R 2.1; median risk $6.20; lot 'skip' 21; exits {'Time': 64, 'SL': 17, 'TP': 6}; median spread at entry $0.41
   holdout: longs 28 R -2.4, shorts 28 R 2.2; median risk $7.82; lot 'skip' 22; exits {'SL': 27, 'Time': 22, 'TP': 7}; median spread at entry $0.41
   per year, train:
| entry_time | trades | pf | R | $ |
|---|---|---|---|---|
| 2004 | 2 | 2.7 | 0.5 | 2.26 |
| 2005 | 1 | inf | 0.8 | 2.17 |
| 2006 | 6 | 8.86 | 2.0 | 9.19 |
| 2007 | 4 | inf | 1.9 | 8.75 |
| 2008 | 6 | 1.32 | 0.4 | 8.92 |
| 2009 | 8 | 0.1 | -3.7 | -3.95 |
| 2010 | 4 | 0.21 | -1.0 | -5.1 |
| 2011 | 7 | 2.67 | 3.0 | -3.58 |
| 2012 | 8 | 0.79 | -0.8 | 21.83 |
| 2013 | 5 | 9.48 | 3.9 | 39.97 |
| 2014 | 7 | 1.13 | 0.3 | 2.08 |
| 2015 | 7 | 0.88 | -0.2 | 9.2 |
| 2016 | 8 | 4.11 | 4.5 | 31.13 |
| 2017 | 8 | 18.06 | 4.2 | 31.05 |
| 2018 | 6 | 0.07 | -4.8 | -22.24 |
ALL N4 N1 W=30 m=1 stop=2ATR EOS +trend: train PF 1.57 (91 trades); random-direction pctl 98.2 (median 1.04, p90 1.35); non-event days 782 trades, PF 0.63; PF costs x1.5 1.18
   train: longs 51 R 25.1, shorts 40 R 8.0; median risk $2.65; lot 'skip' 0; exits {'SL': 55, 'Time': 36}; median spread at entry $0.41
   holdout: longs 61 R -18.8, shorts 22 R -4.0; median risk $3.29; lot 'skip' 6; exits {'SL': 71, 'Time': 12}; median spread at entry $0.39
   per year, train:
| entry_time | trades | pf | R | $ |
|---|---|---|---|---|
| 2006 | 11 | 0.34 | -5.5 | -23.22 |
| 2007 | 3 | 0.41 | -1.2 | -7.26 |
| 2008 | 10 | 2.32 | 6.8 | 33.61 |
| 2009 | 6 | 1.95 | 3.2 | 7.66 |
| 2010 | 6 | 1.35 | 1.5 | -0.16 |
| 2011 | 11 | 2.95 | 12.0 | 48.5 |
| 2012 | 14 | 2.4 | 12.3 | 52.68 |
| 2013 | 8 | 1.5 | 2.1 | 9.31 |
| 2014 | 6 | 0.29 | -3.7 | -11.01 |
| 2015 | 7 | 2.68 | 7.0 | 30.69 |
| 2016 | 6 | 0.52 | -2.5 | -8.35 |
| 2017 | 2 | 0.52 | -0.5 | -0.39 |
| 2018 | 1 | inf | 1.8 | 7.72 |

train grid summary:
| scope | family | points | trades (median) | PF median | PF > 1.0 | points with >= 80 trades | best PF with >= 80 trades | gross R/trade (median) | spread R (median) |
|---|---|---|---|---|---|---|---|---|---|
| NFP | N1 | 54 | 82 | 0.73 | 12 | 30 | 1.16 | 0.072 | 0.15 |
| NFP | N2 | 12 | 86 | 0.66 | 0 | 8 | 0.78 | 0.057 | 0.102 |
| NFP | N3 | 9 | 157 | 0.65 | 0 | 9 | 0.85 | -0.007 | 0.063 |
| CPI | N1 | 54 | 66 | 0.51 | 5 | 18 | 0.72 | -0.119 | 0.137 |
| CPI | N2 | 12 | 41 | 0.79 | 0 | 0 | - | 0.112 | 0.12 |
| CPI | N3 | 9 | 155 | 0.67 | 1 | 9 | 1.03 | -0.009 | 0.089 |
| FOMC | N1 | 54 | 44 | 1.67 | 50 | 12 | 1.46 | 0.745 | 0.163 |
| FOMC | N2 | 12 | 47 | 0.38 | 0 | 0 | - | -0.193 | 0.112 |
| FOMC | N3 | 9 | 90 | 1.21 | 9 | 9 | 1.34 | 0.133 | 0.065 |
| ALL | N1 | 54 | 193 | 0.88 | 15 | 36 | 1.2 | 0.178 | 0.151 |
| ALL | N2 | 12 | 177 | 0.54 | 0 | 12 | 0.66 | -0.024 | 0.11 |
| ALL | N3 | 9 | 399 | 0.76 | 0 | 9 | 0.91 | 0.023 | 0.074 |
