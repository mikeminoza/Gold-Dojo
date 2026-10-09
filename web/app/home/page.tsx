import type { Metadata } from "next";
import Link from "next/link";
import { loadPublicResults, type PublicResults, type PublicStrategy } from "../lib/publicResults";
import { BreakoutStory, GlobeArt, ShrineWalk } from "./Scenes";
import type { ReactNode } from "react";
import "./landing.css";

const DESCRIPTION =
  "Gold Dojo shows paper-tested buy signals for gold (XAUUSD) from two long-only trend strategies, with the full record in public. It never places trades.";

export const metadata: Metadata = {
  title: "Gold Dojo: gold trend signals, paper-tested",
  description: DESCRIPTION,
  openGraph: {
    title: "Gold Dojo: gold trend signals, paper-tested",
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

/** One row per strategy from the live paper test: the running total, and how many trades it covers. */
function PaperRow({ s, tz }: { s: PublicStrategy; tz: string }) {
  const count = s.rules.reduce((n, r) => n + r.count, 0);
  const total = s.rules.reduce((n, r) => n + r.totalR, 0);
  const since = s.started ? ` since ${day(s.started, tz)}` : "";
  return (
    <li className="landing-record-row">
      <span className="landing-record-name">{s.name}</span>
      <span className="landing-record-figure" data-sign={count === 0 ? "none" : total >= 0 ? "up" : "down"}>
        {count === 0 ? "No trades yet" : fmtR(total)}
      </span>
      <span className="landing-record-detail">
        {count === 0
          ? `Paper test running${since}.`
          : `${count} closed paper ${count === 1 ? "trade" : "trades"}${since}.`}
      </span>
    </li>
  );
}

function Record({ data }: { data: PublicResults | null }) {
  const live = data?.strategies.filter((s) => s.started || s.rules.length > 0) ?? [];
  return (
    <section className="landing-section" data-ground="horizon" aria-labelledby="record-title">
      <div className="landing-intro">
        <h2 id="record-title">The record is public</h2>
        <p className="landing-lead">
          Every paper trade goes on the results page when it closes, losses included, next to the backtest.
        </p>
        <p>Results are counted in R. 1R is the amount risked on one trade, so +2R means twice the risk was won.</p>
      </div>
      {live.length > 0 ? (
        <ul className="landing-record-rows" aria-label="Live paper test so far">
          {live.map((s) => (
            <PaperRow key={s.name} s={s} tz={data?.tz ?? "UTC"} />
          ))}
        </ul>
      ) : (
        <p className="landing-quiet">The live paper numbers can&apos;t be loaded right now. The results page has them.</p>
      )}
      <p className="landing-after">
        <Link href="/results" className="landing-link">
          Open the full results
        </Link>
      </p>
    </section>
  );
}

/**
 * The words for one stop on the shrine walk: shown just after passing gate k, beside the path
 * (left, right, or low in the centre), over a soft dark wash so they read against the scene.
 */
function Stop({ k, place, title, children }: { k: number; place: "left" | "right" | "center"; title: string; children: ReactNode }) {
  return (
    <div className="landing-stop" data-stop={k} data-place={place}>
      <div className="landing-wrap">
        <div className="landing-stop-panel">
          <h2>{title}</h2>
          {children}
        </div>
      </div>
    </div>
  );
}

function Brand() {
  return (
    <Link href="/" className="landing-brand" aria-label="Gold Dojo">
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
        <div className="landing-wrap landing-top-row">
          <Brand />
          <nav aria-label="Account" className="landing-nav">
            <Link href="/results">Results</Link>
            <Link href="/login">Sign in</Link>
            <Link href="/login?mode=register" className="landing-btn landing-btn-primary landing-btn-small">
              Create account
            </Link>
          </nav>
        </div>
      </header>

      <main id="main">
        <ShrineWalk>
          <div className="landing-stop landing-stop-opening" data-stop="0">
            <div className="landing-wrap">
              <div className="landing-hero-copy">
                <h1 id="hero-title">Follow gold&apos;s long trends, not its noise.</h1>
                <p>
                  Gold Dojo shows paper-tested buy signals for gold (XAUUSD) from two trend strategies. It never
                  places trades, and every result is public.
                </p>
                <div className="landing-actions">
                  <Link href="/login?mode=register" className="landing-btn landing-btn-primary">
                    Create account
                  </Link>
                  <Link href="/results" className="landing-btn landing-btn-quiet">
                    See the results
                  </Link>
                </div>
              </div>
            </div>
          </div>

          <Stop k={1} place="left" title="Signals, not trades">
            <p>
              Gold Dojo watches gold (XAUUSD) and posts buy signals from two long-only trend strategies. It never
              places a trade for you.
            </p>
            <p>Every signal is paper-tested in the open, and every result is public, losses included.</p>
          </Stop>

          <Stop k={2} place="right" title="Daily trend strategy">
            <p>
              The main one. It buys when a day closes above the highest price of the previous 100 days, or when gold
              dips to its 20-day average in an uptrend and closes back above it. About 10 trades a year.
            </p>
            <dl className="landing-stop-figures">
              <div>
                <dt>Breakout</dt>
                <dd>79 trades, profit factor 2.14</dd>
              </div>
              <div>
                <dt>Pullback</dt>
                <dd>178 trades, profit factor 1.53</dd>
              </div>
            </dl>
            <p>Profitable in both backtest periods: 2003 to 2018, and the unseen 2019 to 2026.</p>
            <p className="landing-stop-note">Profit factor is money won divided by money lost. Above 1 made money.</p>
          </Stop>

          <Stop k={3} place="left" title="4-hour trend strategy">
            <p>
              The faster one. It buys when a 4-hour candle closes above the highest price of the previous 100
              four-hour candles. About 14 trades a year, with a profit factor of 1.39 over 318 backtest trades.
            </p>
            <p>
              To be plain about it: it roughly broke even from 2003 to 2018, and made its money from 2019 to 2026,
              mostly from gold&apos;s strong rise.
            </p>
          </Stop>

          <Stop k={4} place="center" title="How every trade is managed">
            <ul className="landing-stop-rules">
              <li>Buy at the next open after the signal.</li>
              <li>The stop starts 2 × ATR below the entry, or 3 × ATR on the 4-hour strategy.</li>
              <li>It trails up under the highest price and never moves down.</li>
              <li>No profit target: the trailing stop ends the trade.</li>
              <li>Each paper trade risks 1% of the account.</li>
            </ul>
          </Stop>

          <Stop k={5} place="right" title="Every trade, win or lose, goes into the public record.">
            <p>The live paper test so far is just below, next to the backtest it has to live up to.</p>
          </Stop>
        </ShrineWalk>

        <div className="landing-grounds">
          <Record data={data} />

          <section className="landing-section" data-ground="mist" aria-labelledby="story-title">
            <div className="landing-intro">
              <h2 id="story-title">How a breakout becomes a trade</h2>
              <p className="landing-lead">
                The main rule doesn&apos;t predict. It waits for gold to break out, buys, and lets a trailing stop
                decide when the trend is over.
              </p>
            </div>
            <BreakoutStory />
          </section>

          <section className="landing-section landing-alerts" data-ground="waves" aria-labelledby="alerts-title">
            <div className="landing-alerts-copy">
              <h2 id="alerts-title">Signals reach you where you are</h2>
              <p className="landing-lead">Gold trades around the clock, so the signals come to you.</p>
              <ul className="landing-channels">
                <li>
                  <h3>Telegram channel</h3>
                  <p>Every signal is posted the moment a rule fires. The channel is public.</p>
                </li>
                <li>
                  <h3>Phone notifications</h3>
                  <p>Members can get each signal as a notification on their phone.</p>
                </li>
                <li>
                  <h3>Ask Dojo</h3>
                  <p>
                    An AI helper you message on Telegram: ask what the strategies are waiting for, how the paper test is
                    going, or what R and ATR mean. It explains; it doesn&apos;t advise.
                  </p>
                </li>
              </ul>
              <p>
                Members also get the live chart, built from real XAU/USD candles from Twelve Data with Swissquote live
                prices, and the members&apos; chat.
              </p>
              {data?.telegram && (
                <a className="landing-btn landing-btn-quiet" href={data.telegram} target="_blank" rel="noopener noreferrer">
                  Join the Telegram channel
                </a>
              )}
            </div>
            <GlobeArt />
          </section>

          <section className="landing-section landing-final" data-ground="lantern" aria-labelledby="final-title">
            <h2 id="final-title">Watch the rules work before you trust them.</h2>
            <p className="landing-lead">
              Create an account for the live chart, the alerts and the members&apos; chat. Or check the public record
              first.
            </p>
            <div className="landing-actions">
              <Link href="/login?mode=register" className="landing-btn landing-btn-primary">
                Create account
              </Link>
              <Link href="/results" className="landing-btn landing-btn-quiet">
                See the results
              </Link>
            </div>
            <p className="landing-small">Everything is a paper test with no real money. Nothing here is financial advice.</p>
          </section>
        </div>
      </main>

      <footer className="landing-foot">
        <div className="landing-wrap landing-foot-row">
          <p>Signals only. Gold Dojo never places trades.</p>
          <p>Paper test, not financial advice.</p>
        </div>
      </footer>
    </div>
  );
}
