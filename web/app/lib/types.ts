export type Side = "BUY" | "SELL";

export type Candle = {
  t: number; // candle open time, UTC seconds
  o: number;
  h: number;
  l: number;
  c: number;
  v: number; // tick volume
};

/** Suggested position size for a signal, from the account settings in config.py */
export type Sizing = {
  lots: number;
  risk: number; // account money lost if the stop is hit
  reward: number; // account money made if the target is hit
  risk_percent: number;
  verdict: "ok" | "high" | "skip";
  note: string;
};

export type Position = {
  trade_id?: string; // the id of the signal that opened it
  size?: Sizing;
  pnl_usd?: number | null;
  side: Side;
  entry: number;
  sl: number;
  tp: number;
  atr: number;
  rsi: number;
  opened: number;
  pnl: number;
  reason?: string;
  expires?: number | null; // UTC seconds: closes at session end
};

/** When trades can be placed. Times are UTC seconds; range_* and close are null for the EMA strategy. */
export type TradeWindow = {
  name: string;
  tz?: string | null; // the exchange's own time zone (session breakout only)
  range_start: number | null;
  range_end: number | null;
  first_entry: number;
  last_entry: number;
  close: number | null;
  state: "range" | "trading" | "later";
  traded: boolean;
};

export type OpeningRange ={ hi: number; lo: number; label: string; forming: boolean };

export type SignalEvent = {
  id: string;
  type: "open" | "close";
  side: Side;
  price: number;
  time: number;
  sl?: number;
  tp?: number;
  entry?: number;
  pnl?: number;
  reason?: string;
  size?: Sizing;
  lots?: number | null;
  pnl_usd?: number | null;
  session?: string; // e.g. "New York"
  trade_id?: string | null; // a close points at the id of the open it ends
};

/** One replayed trade from publish_backtest.py. Times are UTC seconds; pnl is $ per oz after spread. */
export type BacktestTrade = {
  t: number;
  x: number;
  side: Side;
  entry: number;
  sl: number;
  tp: number;
  exit: number;
  pnl: number;
  reason: string;
};

export type Backtest = {
  generated: number;
  strategy: { id: string; name: string; summary: string };
  timeframe: string;
  from: number;
  to: number;
  spread: number;
  source: string;
  trades: BacktestTrade[];
};

export type Condition = { label: string; ok: boolean };

export type LiveState = {
  symbol: string;
  timeframe: string;
  demo: boolean;
  updated: number;
  bid: number;
  ask: number;
  strategy: { id: "orb" | "ema"; name: string; summary: string };
  display: { tz: string; label: string; short?: string; offset: number };
  windows: TradeWindow[];
  account: { balance: number; risk_percent: number; max_risk_percent: number; oz_per_lot: number; min_lot: number };
  candle_minutes: number;
  session: { open: boolean; message: string; hours: string };
  range: OpeningRange | null;
  news: { title: string; time: number; paused: boolean } | null;
  news_week?: { time: number; title: string }[]; // this week's high-impact US releases (UTC seconds)
  news_pause_minutes?: number;
  loss_pause?: { reason: string; until: number } | null; // loss limits pausing new signals
  indicators: {
    ema_fast: number;
    ema_slow: number;
    ema_trend: number;
    rsi: number;
    atr: number;
    periods: [number, number, number];
  };
  conditions: Record<Side, Condition[]>;
  position: Position | null;
  history: SignalEvent[];
  chart: { timeframes: string[]; default: string };
};
