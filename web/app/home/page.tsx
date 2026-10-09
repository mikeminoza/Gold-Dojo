import type { Metadata } from "next";
import Link from "next/link";
import { loadPublicResults, type PublicResults, type PublicStrategy } from "../lib/publicResults";
import { BreakoutStory, GlobeArt, HeroArt } from "./Scenes";
import "./landing.css";

const DESCRIPTION =
  "Gold Dojo shows paper-tested buy signals for gold (XAUUSD) from two long-only trend strategies, with the full record in public. It never places trades.";

export const metadata: Metadata = {
  title: "Gold Dojo · Gold trend signals, paper-tested",
  description: DESCRIPTION,
  openGraph: {
    title: "Gold Dojo · Gold trend signals, paper-tested",
    description: DESCRIPTION,
    type: "website",
    siteName: "Gold Dojo",
  },
};

const fmtR = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(1)}R`;

function day(t: number, tz: string) {
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
  try {
    return new Date(t * 1000).toLocaleDateString("en-US", { ...opts, timeZone: tz });
  } catch {
    return new Date(t * 1000).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
  }
}

/** One plain sentence per strategy from the live paper test, or nothing if it hasn't started. */
function paperLine(s: PublicStrategy, tz: string) {
  const count = s.rules.reduce((n, r) => n + r.count, 0);
  const total = s.rules.reduce((n, r) => n + r.totalR, 0);
  const since = s.started ? ` since ${day(s.started, tz)}` : "";
  if (count === 0) return `${s.name}: paper test running${since}, no closed trades yet.`;
  return `${s.name}: ${count} closed paper ${count === 1 ? "trade" : "trades"}${since}, ${fmtR(total)} in total.`;
}

function Record({ data }: { data: PublicResults | null }) {
  const lines = data?.strategies.filter((s) => s.started || s.rules.length > 0) ?? [];
  return (
    <section className="landing-record" aria-labelledby="record-title">
      <h2 id="record-title">The record is public</h2>
      <p>
        Every paper trade is listed on the results page as it closes, wins and losses alike, next to the 23-year
        backtest. Results are in R: 1R is the amount risked on a trade.
      </p>
      {lines.length > 0 ? (
        <ul className="landing-record-lines">
          {lines.map((s) => (
            <li key={s.name}>{paperLine(s, data?.tz ?? "UTC")}</li>
          ))}
        </ul>
      ) : (
        <p className="landing-quiet">The live paper numbers can&apos;t be loaded right now; the results page has them.</p>
      )}
      <p>
        <Link href="/results" className="landing-link">
          Open the full results
        </Link>
      </p>
    </section>
  );
}

function Brand() {
  return (
    <Link href="/" className="landing-brand">
      {/* eslint-disable-next-line @next/next/no-img-element -- the site icon, an SVG */}
      <img src="/icon-dark.svg" alt="" width={28} height={28} />
      <span>Gold Dojo</span>
    </Link>
  );
}

/** The public front page: what Gold Dojo is, for visitors. Signed-out visitors see it at "/". */
export default async function Landing() {
  const data = await loadPublicResults();
  return (
    <div className="landing">
      <a className="landing-skip" href="#main">
        Skip to content
      </a>
      <header className="landing-top">
        <Brand />
        <nav aria-label="Account" className="landing-nav">
          <Link href="/results">Results</Link>
          <Link href="/login">Sign in</Link>
          <Link href="/login?mode=register" className="landing-btn landing-btn-primary landing-btn-small">
            Create account
          </Link>
        </nav>
      </header>

      <main id="main">
        <section className="landing-hero" aria-labelledby="hero-title">
          <HeroArt />
          <div className="landing-hero-copy">
            <h1 id="hero-title">Follow gold&apos;s long trends, not its noise.</h1>
            <p>Paper-tested buy signals for XAUUSD from two trend strategies, with the full record in public.</p>
            <div className="landing-actions">
              <Link href="/login?mode=register" className="landing-btn landing-btn-primary">
                Create account
              </Link>
              <Link href="/results" className="landing-btn landing-btn-quiet">
                See the results
              </Link>
            </div>
          </div>
        </section>

        <section className="landing-section" aria-labelledby="story-title">
          <div className="landing-intro">
            <h2 id="story-title">How a breakout becomes a trade</h2>
            <p>
              Gold Dojo never guesses where gold is going. It waits for gold to show a trend, follows it with a stop,
              and lets the stop decide when it&apos;s over. Here is the main rule, one day at a time.
            </p>
          </div>
          <BreakoutStory />
        </section>

        <section className="landing-section" aria-labelledby="strategies-title">
          <div className="landing-intro">
            <h2 id="strategies-title">Two strategies, both long-only</h2>
            <p>
              Both only buy, both use a trailing stop instead of a profit target, and both risk 1% per paper trade.
              They were replayed on 23 years of gold prices, then tested on years they had never seen.
            </p>
          </div>
          <div className="landing-strategies">
            <article>
              <h3>Daily trend</h3>
              <p className="landing-lead">
                The main strategy. Buys when a day closes above the previous 100 days&apos; high, or when, in an
                uptrend (50-day average above the 200-day), price dips to the 20-day average and closes back above
                it.
              </p>
              <dl>
                <div>
                  <dt>Trades</dt>
                  <dd>About 10 a year</dd>
                </div>
                <div>
                  <dt>Stop</dt>
                  <dd>2 × ATR, trailing under the highest price</dd>
                </div>
                <div>
                  <dt>Backtest</dt>
                  <dd>Breakout: 79 trades, profit factor 2.14. Pullback: 178 trades, profit factor 1.53.</dd>
                </div>
              </dl>
              <p>Profitable in both halves: 2003 to 2018, and the unseen 2019 to 2026.</p>
            </article>
            <article>
              <h3>4-hour trend</h3>
              <p className="landing-lead">
                Buys when a 4-hour candle closes above the highest price of the previous 100 four-hour candles.
              </p>
              <dl>
                <div>
                  <dt>Trades</dt>
                  <dd>About 14 a year</dd>
                </div>
                <div>
                  <dt>Stop</dt>
                  <dd>3 × ATR, trailing</dd>
                </div>
                <div>
                  <dt>Backtest</dt>
                  <dd>318 trades, profit factor 1.39.</dd>
                </div>
              </dl>
              <p>
                Honestly: it roughly broke even from 2003 to 2018 and made its money from 2019 to 2026, during gold&apos;s
                big rise. It may struggle if gold stops trending.
              </p>
            </article>
          </div>
        </section>

        <Record data={data} />

        <section className="landing-section landing-alerts" aria-labelledby="alerts-title">
          <div className="landing-alerts-copy">
            <h2 id="alerts-title">Alerts anywhere</h2>
            <p>
              Gold trades around the clock. Signals reach you on Telegram or as phone notifications the moment a rule
              fires.
            </p>
            <p>
              Members also get the live chart, the members&apos; chat, and Ask Dojo, an AI helper you can question on Telegram.
            </p>
            {data?.telegram && (
              <a className="landing-btn landing-btn-quiet" href={data.telegram} target="_blank" rel="noopener noreferrer">
                Join the Telegram channel
              </a>
            )}
          </div>
          <GlobeArt />
        </section>

        <section className="landing-final" aria-labelledby="final-title">
          <h2 id="final-title">Watch the rules work before you trust them.</h2>
          <p>
            Everything is a paper test with no real money, and nothing here is financial advice.
          </p>
          <div className="landing-actions">
            <Link href="/login?mode=register" className="landing-btn landing-btn-primary">
              Create account
            </Link>
            <Link href="/login" className="landing-btn landing-btn-quiet">
              Sign in
            </Link>
          </div>
        </section>
      </main>

      <footer className="landing-foot">
        <p>Signals only. Nothing here places trades.</p>
        <p>Paper test, not financial advice.</p>
      </footer>
    </div>
  );
}
