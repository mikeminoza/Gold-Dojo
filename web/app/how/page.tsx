import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "How it works · Gold Dojo" };

/** Plain-English explanation of the signals, the two trend strategies, sizing and the risks. */
export default function How() {
  return (
    <main className="how">
      <article className="how-card">
        <p className="how-back">
          <Link href="/">← Back to the signals</Link>
        </p>
        <h1>How Gold Dojo works</h1>
        <p className="how-lead">
          A bot watches the gold price (XAUUSD) and posts <strong>Buy</strong> signals from two long-only trend
          strategies here. It never places trades: you decide whether to follow a signal, in your own broker account.
        </p>
        <p className="how-notice">
          <strong>Both strategies are on a paper test.</strong> They made money in a 23-year test, mostly by riding
          gold&apos;s long rise, and may do poorly if gold stops trending. Don&apos;t trade them with money you need.
        </p>

        <section>
          <h2>The strategies: Daily trend and 4-hour trend</h2>
          <p>
            Both follow the same idea: gold moves in long trends, so buy when it shows strength and stay in until the
            trend ends. Long only: selling short lost money in the tests. Switch between them on the signal card.
          </p>
          <ol>
            <li>
              <strong>Daily trend (the main strategy)</strong> has two rules on daily candles. <em>100-day
              breakout:</em> buy when a day closes above the highest price of the previous 100 days. <em>Trend
              pullback:</em> in an uptrend (50-day average above the 200-day), buy when price dips to the 20-day
              average and closes back above it. The stop starts 2 × ATR (twice the average daily range) below the entry.
            </li>
            <li>
              <strong>4-hour trend</strong> has one rule on 4-hour candles: buy when a 4-hour candle closes above the
              highest price of the previous 100 four-hour candles (about 17 trading days). The stop starts 3 × ATR below
              the entry.
            </li>
            <li>
              <strong>Entry:</strong> at the open of the next candle, after the signal candle closes.
            </li>
            <li>
              <strong>Trailing stop, no target:</strong> the stop follows the highest price since entry and never moves
              down. The trade ends only when the stop is hit, so winners can run for days or weeks.
            </li>
            <li>
              <strong>Few trades:</strong> about 10 a year for Daily trend and 14 for 4-hour trend, held for days to
              weeks.
            </li>
          </ol>
        </section>

        <section>
          <h2>Reading a signal</h2>
          <dl className="how-terms">
            <div>
              <dt>Long / Buy / Wait</dt>
              <dd>
                The big word on the right, for the strategy you chose. Long means a paper trade is open, Buy means the
                strategy buys at the next candle&apos;s open, Wait means nothing to do yet.
              </dd>
            </div>
            <div>
              <dt>Entry</dt>
              <dd>The price the trade was bought at.</dd>
            </div>
            <div>
              <dt>Trailing stop</dt>
              <dd>Where the trade is closed if price falls back. It moves up as the trade gains, never down.</dd>
            </div>
            <div>
              <dt>Lot size</dt>
              <dd>
                How big to trade so a stop-out costs your chosen risk (1% of the account by default). 1 lot = 100
                ounces of gold, so every $1 the price moves is $1 per 0.01 lot.
              </dd>
            </div>
          </dl>
          <p>
            Set your own balance and risk on your <Link href="/profile">profile</Link>; every lot size on the site
            follows it. The stops are wide, so on a small standard account even 0.01 lot can risk more than you chose;
            a cent account lets you size smaller.
          </p>
        </section>

        <section>
          <h2>How it has done</h2>
          <p>
            We replayed both strategies on 23 years of real gold prices (2003–2026), with spread, slippage and
            overnight financing:
          </p>
          <ul>
            <li>
              <strong>Daily trend:</strong> profitable both in the years used to build it (2003–2018) and in years it
              never saw (2019–2026). Breakout: 79 trades, profit factor 2.14. Pullback: 178 trades, profit factor 1.53.
            </li>
            <li>
              <strong>4-hour trend:</strong> roughly break-even in 2003–2018 (208 trades, profit factor 1.02) and
              profitable in 2019–2026 (110 trades, profit factor 2.12). Most of its profit came from gold&apos;s rise
              since 2019.
            </li>
            <li>
              Both made money mostly by being in gold while it rose. Performance compares them with simply holding
              gold over the same years.
            </li>
          </ul>
          <p>
            The <strong>Performance</strong> button shows each strategy&apos;s backtest at your account size, and the
            Trades tab its paper trades so far. The public <Link href="/results">results page</Link> shows the paper
            record and backtest to anyone, without signing in.
          </p>
        </section>

        <section className="how-warning">
          <h2>Risks</h2>
          <ul>
            <li>These signals are not financial advice, and past results don&apos;t promise future ones.</li>
            <li>Gold is volatile; you can lose money, including more than you expect if prices gap past a stop.</li>
            <li>Your broker&apos;s prices and spreads differ slightly from the free prices used here.</li>
            <li>Try signals on a demo account first, and only risk money you can afford to lose.</li>
          </ul>
        </section>
      </article>
    </main>
  );
}
