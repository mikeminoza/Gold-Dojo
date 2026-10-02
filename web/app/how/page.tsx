import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "How it works · Golden Skibidi" };

/** Plain-English explanation of the signals, the strategy, sizing and the risks. */
export default function How() {
  return (
    <main className="how">
      <article className="how-card">
        <p className="how-back">
          <Link href="/">← Back to the signals</Link>
        </p>
        <h1>How Golden Skibidi works</h1>
        <p className="how-lead">
          A bot watches the gold price (XAUUSD) and posts <strong>Buy</strong> and <strong>Sell</strong> signals
          here. It never places trades: you decide whether to follow a signal, in your own broker account.
        </p>

        <section>
          <h2>The strategy: New York session breakout</h2>
          <ol>
            <li>
              <strong>Wait for New York to open</strong> at 8:30 AM New York time. That&apos;s 8:30 PM in the
              Philippines while the US is on summer time (March to early November), and 9:30 PM in the US winter.
            </li>
            <li>
              <strong>Mark the opening range:</strong> the highest and lowest price of the first 60 minutes.
            </li>
            <li>
              <strong>Check the daily trend:</strong> is gold above or below its average of the last 50 days? The bot
              only buys in an uptrend and only sells in a downtrend.
            </li>
            <li>
              <strong>Signal on a breakout:</strong> when a 30-minute candle closes above the range in an uptrend
              (Buy) or below it in a downtrend (Sell).
            </li>
            <li>
              <strong>Stop loss and target:</strong> the stop goes on the other side of the range (but no further than one typical
              30-minute candle, and no closer than half of one), and the take-profit is twice that distance away, so a win earns about
              twice what a loss costs.
            </li>
            <li>
              <strong>One trade per session,</strong> closed at the end of the session (3 hours after the open) if
              neither the stop nor the target has been hit.
            </li>
            <li>
              <strong>News pause:</strong> no new signals within 30 minutes of major US news (jobs reports,
              inflation, Fed decisions), when prices jump around unpredictably.
            </li>
          </ol>
        </section>

        <section>
          <h2>Reading a signal</h2>
          <dl className="how-terms">
            <div>
              <dt>Buy / Sell / Wait</dt>
              <dd>The big word on the right. Wait means no trade is open.</dd>
            </div>
            <div>
              <dt>Entry</dt>
              <dd>The price when the signal was given.</dd>
            </div>
            <div>
              <dt>Stop loss (SL)</dt>
              <dd>Where the trade is closed at a loss if price goes the wrong way.</dd>
            </div>
            <div>
              <dt>Take profit (TP)</dt>
              <dd>Where the trade is closed in profit.</dd>
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
            Set your own balance and risk on your <Link href="/profile">profile</Link>; every lot size and result on
            the site follows it. The smallest size is 0.01 lot, so on small accounts a trade can risk more than you
            chose; the signal then says so.
          </p>
        </section>

        <section>
          <h2>How it has done</h2>
          <p>
            The <strong>Performance</strong> button shows two things: the bot&apos;s live signals so far, and a{" "}
            <strong>backtest</strong>, the same rules replayed on gold prices since 2020. Be aware: in that backtest
            the strategy lost money from 2020 to 2024 and only made money in 2025–26, during a strong gold rally.
            Results over many trades matter; any single trade, win or loss, tells you little. Win rates around 40%
            are normal for this kind of strategy, because wins are bigger than losses.
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
