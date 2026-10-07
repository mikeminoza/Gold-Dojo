/** Plain-words guide to each strategy: the idea, the rules, what to expect and how it tested. */
export default function StrategyGuide({ strategy }: { strategy: "trend" | "ny" }) {
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
        <strong>The idea:</strong> the New York open (8:30 AM New York, when US data comes out) often starts a strong
        move. Trade the break out of its first hour.
      </p>
      <h3>The rules, on 30-minute candles</h3>
      <ul>
        <li>The opening range: the high and low of the first 60 minutes of the New York session.</li>
        <li>Buy when price breaks above the range, sell when it breaks below, in the direction of the 50-day trend.</li>
        <li>Stop on the other side of the range (between 0.5 and 1 × ATR), target 2 × the risk.</li>
        <li>Any trade still open closes at the end of the session (11:30 AM New York).</li>
        <li>Paused around major US news and after too many losses in a row.</li>
      </ul>
      <h3>How it tested</h3>
      <p>
        <strong>No proven edge.</strong> On 23 years of data, after spread and slippage, it didn&apos;t make money
        reliably. Use it to practice reading breakouts and placing stops on a demo account, not for real money.
      </p>
    </div>
  );
}
