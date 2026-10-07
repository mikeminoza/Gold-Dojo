import type { Metadata } from "next";
import Link from "next/link";
import AuthShell from "../components/AuthShell";
import { loadPublicResults, type PublicRule, type PublicStrategy } from "../lib/publicResults";

export const metadata: Metadata = {
  title: "Results · Gold Dojo",
  description: "Gold Dojo's paper-test record and 23-year backtest for its two gold trend strategies.",
};

// Re-read the results at most every 5 minutes (open to everyone, so it's served from the cache)
export const revalidate = 300;

const fmtR = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(2)}R`;
const tone = (n: number | null) => (n == null || n === 0 ? undefined : n > 0 ? "profit" : "loss");

function dateIn(tz: string) {
  return (t: number, year = true) => {
    const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", ...(year ? { year: "numeric" } : {}) };
    try {
      return new Date(t * 1000).toLocaleDateString("en-US", { ...opts, timeZone: tz });
    } catch {
      return new Date(t * 1000).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
    }
  };
}

/** The running total of R after each closed paper trade, as a small line chart. */
function CumulativeR({ rs, name }: { rs: number[]; name: string }) {
  if (rs.length < 2) return <p className="results-empty">The line shows once there are two closed trades.</p>;
  const points = rs.reduce<number[]>((acc, v) => [...acc, acc[acc.length - 1] + v], [0]);
  const W = 300;
  const H = 90;
  const hi = Math.max(0, ...points);
  const lo = Math.min(0, ...points);
  const span = hi - lo || 1;
  const x = (i: number) => (i / (points.length - 1)) * W;
  const y = (v: number) => 6 + ((hi - v) / span) * (H - 12);
  const end = points[points.length - 1];
  return (
    <svg
      className="results-curve"
      data-tone={tone(end)}
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={`${name}: running total ${fmtR(end)} after ${rs.length} paper trades`}
    >
      <line className="results-zero" x1={0} x2={W} y1={y(0)} y2={y(0)} />
      <polyline points={points.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />
    </svg>
  );
}

function RuleCard({ rule, date }: { rule: PublicRule; date: (t: number, year?: boolean) => string }) {
  return (
    <li className="results-rule">
      <h3>{rule.name}</h3>
      <dl className="results-stats">
        <div>
          <dt>Paper trades</dt>
          <dd>{rule.count}</dd>
        </div>
        <div>
          <dt>Won</dt>
          <dd>{rule.winRate != null ? `${rule.winRate}%` : "–"}</dd>
        </div>
        <div>
          <dt>Total</dt>
          <dd data-tone={tone(rule.totalR)}>{fmtR(rule.totalR)}</dd>
        </div>
        <div>
          <dt>Profit factor</dt>
          <dd>{rule.profitFactor != null ? rule.profitFactor.toFixed(2) : "–"}</dd>
        </div>
      </dl>
      <CumulativeR rs={rule.rs} name={rule.name} />
      {rule.recent.length > 0 && (
        <ul className="results-recent" aria-label={`${rule.name}: latest closed paper trades`}>
          {rule.recent.slice(0, 6).map((t) => (
            <li key={`${t.closed}-${t.r}`}>
              <span>{date(t.closed)}</span>
              <strong data-tone={tone(t.r)}>{fmtR(t.r)}</strong>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function Strategy({ s, date }: { s: PublicStrategy; date: (t: number, year?: boolean) => string }) {
  const b = s.backtest;
  return (
    <section className="results-strategy">
      <h2>{s.name}</h2>
      <p className="results-since">
        {s.started ? `Paper test since ${date(s.started)}.` : "The paper test hasn't started yet."}
      </p>
      {s.rules.length > 0 && (
        <ul className="results-rules">
          {s.rules.map((rule) => (
            <RuleCard key={rule.id} rule={rule} date={date} />
          ))}
        </ul>
      )}
      {b && b.rules.length > 0 && (
        <div className="results-backtest">
          <h3>
            Backtest, {new Date(b.from * 1000).getUTCFullYear()}–{new Date(b.to * 1000).getUTCFullYear()}
          </h3>
          <div className="results-table">
            <table className="results-split">
              <thead>
                <tr>
                  <th scope="col">Rule</th>
                  <th scope="col">Trades</th>
                  <th scope="col">Won</th>
                  <th scope="col">Profit factor</th>
                  <th scope="col">Total</th>
                  <th scope="col">Worst drop</th>
                  <th scope="col">Avg nights</th>
                </tr>
              </thead>
              <tbody>
                {b.rules.map((x) => (
                  <tr key={x.id}>
                    <th scope="row">{x.name}</th>
                    <td>{x.count}</td>
                    <td>{x.winRate != null ? `${x.winRate}%` : "–"}</td>
                    <td>{x.profitFactor != null ? x.profitFactor.toFixed(2) : "–"}</td>
                    <td data-tone={tone(x.totalR)}>{x.totalR != null ? fmtR(x.totalR) : "–"}</td>
                    <td>{x.worstDropR != null ? fmtR(-Math.abs(x.worstDropR)) : "–"}</td>
                    <td>{x.avgNights != null ? Math.round(x.avgNights) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="results-small">
            Replayed on real XAUUSD prices{b.source ? ` (${b.source})` : ""} with spread, slippage and overnight
            financing.
            {b.hold &&
              ` Simply holding gold over the same years: ${b.hold.returnPct > 0 ? "+" : ""}${b.hold.returnPct.toFixed(0)}%, with a worst drop of ${b.hold.worstDropPct.toFixed(0)}%.`}
          </p>
        </div>
      )}
    </section>
  );
}

/** Open to everyone: the paper-test record and backtest summary, with no live signal or open trade. */
export default async function Results() {
  const data = await loadPublicResults();
  const date = dateIn(data?.tz ?? "UTC");
  return (
    <AuthShell>
      <article className="how-card results-card">
        <h1>Paper-test results</h1>
        <p className="how-lead">
          Gold Dojo&apos;s two long-only gold trend strategies, tracked on paper since they started, next to their
          23-year backtest. Results are in <strong>R</strong>: 1R is the amount risked on a trade, so +2R made twice
          the risk and −1R lost it.
        </p>
        <p className="how-notice">
          <strong>Paper test, no real money.</strong> These are the trades the rules would have made; past results,
          paper or backtest, are no promise of future ones. Nothing here is financial advice.
        </p>

        {data ? (
          data.strategies.map((s) => <Strategy key={s.name} s={s} date={date} />)
        ) : (
          <p className="results-empty">The results can&apos;t be loaded right now. Try again in a few minutes.</p>
        )}

        <section className="how-warning">
          <h2>Read this before trusting the numbers</h2>
          <ul>
            <li>A few dozen paper trades say little: a good or bad run can be luck.</li>
            <li>Both strategies made most of their money by riding gold&apos;s long rise, and may do poorly if gold stops trending.</li>
            <li>Paper prices and costs are estimates; a real broker&apos;s fills, spreads and financing differ.</li>
          </ul>
        </section>

        <p className="results-foot">
          {data?.updated ? `Updated ${date(data.updated)}. ` : ""}
          Members see the live signals: <Link href="/login">sign in or create an account</Link>.
        </p>
      </article>
    </AuthShell>
  );
}
