/** Plain-words guide to each strategy: the idea, the rules, what to expect and how it tested. */
export default function StrategyGuide({ strategy }: { strategy: "trend" | "h4" }) {
  if (strategy === "trend") {
    return (
      <div className="strategy-guide">
        <p>
          <strong>The idea:</strong> gold moves in long trends. Buy when a trend shows strength, then stay in until it
          ends. Long only: selling short lost money in the tests.
        </p>
        <h3>Two rules, on daily candles</h3>
        <ul>
          <li>
            <strong>100-day breakout:</strong> buy when a day closes above the highest price of the previous 100 days.
          </li>
          <li>
            <strong>Trend pullback:</strong> in an uptrend (50-day average above the 200-day), buy when price dips to the
            20-day average and closes back above it.
          </li>
        </ul>
        <h3>Managing the trade</h3>
        <ul>
          <li>Buy at the next day&apos;s open, after the signal day closes.</li>
          <li>Stop 2 × ATR (twice the average daily range) below the entry.</li>
          <li>Each day the stop moves up to 2 × ATR below the highest price since entry. It never moves down.</li>
          <li>No take-profit: the trade ends only when the trailing stop is hit, so winners can run for weeks.</li>
          <li>Risk 1% of the account per trade. Stops are wide, so a cent account helps small balances.</li>
        </ul>
        <h3>What to expect</h3>
        <ul>
          <li>About 10 trades a year, held for days to weeks.</li>
          <li>Roughly 4 to 5 in 10 trades win; a few big winners carry the result.</li>
          <li>In a long downtrend it mostly waits. Losing streaks are normal.</li>
        </ul>
        <h3>How it tested</h3>
        <p>
          23 years of daily gold data, with spread, slippage and overnight fees. Profitable both in the years used to
          build it (2003–2018) and in years it never saw (2019–2026). Breakout: 79 trades, profit factor 2.14. Pullback:
          178 trades, profit factor 1.53. Past results are no promise; it&apos;s on a paper test here.
        </p>
      </div>
    );
  }
  return (
    <div className="strategy-guide">
      <p>
        <strong>The idea:</strong> the same trend-following idea as Daily trend, on faster 4-hour candles: buy when
        gold breaks to a new high, then ride the move. Long only.
      </p>
      <h3>One rule, on 4-hour candles</h3>
      <ul>
        <li>
          <strong>4-hour breakout:</strong> buy when a 4-hour candle closes above the highest price of the previous 100
          four-hour candles (about 17 trading days).
        </li>
      </ul>
      <h3>Managing the trade</h3>
      <ul>
        <li>Buy at the next 4-hour candle&apos;s open, after the signal candle closes.</li>
        <li>Stop 3 × ATR (three times the average 4-hour range, over 20 candles) below the entry.</li>
        <li>The stop follows 3 × ATR below the highest price since entry. It never moves down.</li>
        <li>No take-profit: the trade ends only when the trailing stop is hit.</li>
        <li>Risk 1% of the account per trade. Stops are wide, so a cent account helps small balances.</li>
      </ul>
      <h3>What to expect</h3>
      <ul>
        <li>About 14 trades a year, held for days.</li>
        <li>When gold isn&apos;t trending it gets stopped out often; losing streaks are normal.</li>
      </ul>
      <h3>How it tested</h3>
      <p>
        23 years of gold data, with a $0.50 spread, $0.20 slippage on each fill and 0.02% a night financing.{" "}
        <strong>2003–2018: roughly break-even</strong> (208 trades, profit factor 1.02, +1.4R).{" "}
        <strong>2019–2026: profitable</strong> (110 trades, profit factor 2.12, +39R). So most of its profit came from
        gold&apos;s rise since 2019, and it may do poorly if gold stops trending. Past results are no promise; it&apos;s on
        a paper test here.
      </p>
    </div>
  );
}
