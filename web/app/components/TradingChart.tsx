"use client";

import {
  BarSeries,
  CandlestickSeries,
  ColorType,
  CrosshairMode,
  HistogramSeries,
  LineSeries,
  LineStyle,
  TickMarkType,
  createChart,
  createSeriesMarkers,
  type BarData,
  type IChartApi,
  type LineData,
  type IPriceLine,
  type ISeriesApi,
  type ISeriesMarkersPluginApi,
  type MouseEventParams,
  type SeriesDataItemTypeMap,
  type SeriesMarker,
  type SeriesType,
  type Time,
  type UTCTimestamp,
} from "lightweight-charts";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { bollinger, ema, rsi, sma, type Point } from "../lib/indicators";
import { TF_SECONDS, fetchCandles } from "../lib/market";
import { useRealMinutes, withRealPrices } from "../lib/useRealMinutes";
import type { Candle, OpeningRange, Position, SignalEvent } from "../lib/types";

export type Theme = "dark" | "light";

// Chart colours per theme (the chart draws on a canvas, so it can't use the page's CSS variables)
const PALETTES = {
  dark: {
    text: "#8FA3B8",
    grid: "rgba(143, 163, 184, 0.08)",
    separator: "rgba(143, 163, 184, 0.18)",
    label: "#16283D",
    up: "#34C08A",
    down: "#EF5B5B",
    volUp: "rgba(52, 192, 138, 0.35)",
    volDown: "rgba(239, 91, 91, 0.35)",
    gold: "#D9A84E",
    fast: "#D9A84E",
    slow: "#B7C6D6",
    trend: "#4E6A88",
    band: "#7C6BC4",
    range: "#8FA3B8",
    drawing: "#E8EEF4",
  },
  light: {
    text: "#5B6F86",
    grid: "rgba(30, 50, 75, 0.07)",
    separator: "rgba(30, 50, 75, 0.16)",
    label: "#13243A",
    up: "#148A5E",
    down: "#D23C3C",
    volUp: "rgba(20, 138, 94, 0.28)",
    volDown: "rgba(210, 60, 60, 0.28)",
    gold: "#A87412",
    fast: "#B8841F",
    slow: "#4E6A88",
    trend: "#8FA3B8",
    band: "#6A58B8",
    range: "#5B6F86",
    drawing: "#13243A",
  },
};

// Chart times are already shifted to the display time zone, so format them as UTC: 12-hour clock
const axisDate = (t: number, opts: Intl.DateTimeFormatOptions) =>
  new Date(t * 1000).toLocaleDateString("en-US", { timeZone: "UTC", ...opts });
const axisTime = (t: number) =>
  new Date(t * 1000).toLocaleTimeString("en-US", { timeZone: "UTC", hour: "numeric", minute: "2-digit", hour12: true });

function tickLabel(time: Time, type: TickMarkType) {
  const t = time as number;
  if (type === TickMarkType.Year) return axisDate(t, { year: "numeric" });
  if (type === TickMarkType.Month) return axisDate(t, { month: "short" });
  if (type === TickMarkType.DayOfMonth) return axisDate(t, { month: "short", day: "numeric" });
  return axisTime(t);
}

type ChartType = "candles" | "bars" | "line";
type Tool = "cursor" | "hline" | "trend";
type Toggles = {
  emaFast: boolean;
  emaSlow: boolean;
  emaTrend: boolean;
  bb: boolean;
  rsi: boolean;
  volume: boolean;
  range: boolean;
  levels: boolean;
  markers: boolean;
  grid: boolean;
};
type Settings = { tf: string | null; type: ChartType; show: Toggles };
type Anchor = { t: number; p: number }; // UTC seconds, price
type Drawing = { id: string; kind: "hline"; price: number } | { id: string; kind: "trend"; a: Anchor; b: Anchor };
type Bar = { t: number; o: number; h: number; l: number; c: number };

const SETTINGS_KEY = "gold-chart-settings";
const DEFAULT_SETTINGS: Settings = {
  tf: null, // null = the bot's trading timeframe
  type: "candles",
  show: {
    emaFast: true,
    emaSlow: true,
    emaTrend: true,
    bb: false,
    rsi: false,
    volume: true,
    range: true,
    levels: true,
    markers: true,
    grid: true,
  },
};
const VISIBLE_BARS = 140;
const REFRESH_MS = 15_000;
const INITIAL_CANDLES = 1000; // what a timeframe opens with
const REFRESH_CANDLES = 200; // the newest candles, re-read every 15 s
const OLDER_BATCH = 1000; // added each time you scroll near the left edge
const MAX_CANDLES = 20_000; // enough years of daily candles; keeps the browser fast
const LOAD_OLDER_AT = 40; // load more when fewer than this many candles are left of the view

// Chart preferences and drawings are per-browser conveniences; the page works without them.
function loadSettings(): Settings {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "null");
    return saved ? { ...DEFAULT_SETTINGS, ...saved, show: { ...DEFAULT_SETTINGS.show, ...saved.show } } : DEFAULT_SETTINGS;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function loadDrawings(symbol: string): Drawing[] {
  try {
    return JSON.parse(localStorage.getItem(`gold-chart-drawings-${symbol}`) ?? "[]");
  } catch {
    return [];
  }
}

function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage unavailable (private window etc.) - settings just won't persist
  }
}

/** Candles from `a` and `b` combined by time (`b` wins where both have the same candle), oldest first. */
function mergeCandles(a: Candle[], b: Candle[]) {
  const byTime = new Map<number, Candle>();
  for (const k of a) byTime.set(k.t, k);
  for (const k of b) byTime.set(k.t, k);
  return [...byTime.values()].sort((x, y) => x.t - y.t).slice(-MAX_CANDLES);
}

/**
 * Candles for the selected timeframe straight from Binance (unadjusted PAXG). Starts with the latest
 * INITIAL_CANDLES, refreshes the newest ones every 15 s, and `loadOlder()` adds earlier history when
 * you scroll back - like MetaTrader. Between refreshes the newest candle follows the live price.
 */
function useCandles(tf: string) {
  const [data, setData] = useState<{ tf: string; candles: Candle[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const current = useRef<{ tf: string; candles: Candle[] } | null>(null);
  const busy = useRef(false);
  const exhausted = useRef(false);

  useEffect(() => {
    current.current = data;
  }, [data]);

  useEffect(() => {
    let stopped = false;
    exhausted.current = false;
    const load = async (first: boolean) => {
      try {
        const fresh = await fetchCandles(tf, first ? INITIAL_CANDLES : REFRESH_CANDLES, 0);
        if (stopped) return;
        setData((prev) => (prev?.tf === tf && !first ? { tf, candles: mergeCandles(prev.candles, fresh) } : { tf, candles: fresh }));
        setError(null);
      } catch (e) {
        if (!stopped) setError(`Can't load ${tf} candles right now (${(e as Error).message}). Retrying…`);
      }
    };
    load(true);
    const id = setInterval(() => load(false), REFRESH_MS);
    return () => {
      stopped = true;
      clearInterval(id);
    };
  }, [tf]);

  const loadOlder = useCallback(async () => {
    const now = current.current;
    if (busy.current || exhausted.current || !now || now.tf !== tf || now.candles.length === 0) return;
    if (now.candles.length >= MAX_CANDLES) return;
    busy.current = true;
    setLoadingOlder(true);
    try {
      const older = await fetchCandles(tf, OLDER_BATCH, 0, now.candles[0].t);
      if (older.length === 0) exhausted.current = true;
      else setData((prev) => (prev?.tf === tf ? { tf, candles: mergeCandles(older, prev.candles) } : prev));
    } catch {
      // try again on the next scroll
    } finally {
      busy.current = false;
      setLoadingOlder(false);
    }
  }, [tf]);

  return { candles: data?.tf === tf ? data.candles : null, error, loadOlder, loadingOlder };
}

/** setData when the dataset changed, otherwise update just the newest point (keeps zoom and scroll). */
function sync<T extends SeriesType>(
  api: ISeriesApi<T>,
  data: SeriesDataItemTypeMap<Time>[T][],
  key: string,
  keys: Map<unknown, string>,
) {
  if (data.length === 0) return;
  if (keys.get(api) === key) {
    api.update(data[data.length - 1]);
  } else {
    api.setData(data);
    keys.set(api, key);
  }
}

const price2 = (n: number) => n.toFixed(2);

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
      {children}
    </svg>
  );
}

export default function TradingChart({
  symbol,
  bid,
  priceTime,
  gap,
  tzLabel,
  timeframes,
  defaultTf,
  offset,
  history,
  range,
  position,
  periods,
  theme,
  onTimeframe,
  replay,
  onExitReplay,
  alertPrices = [],
  dailyTrend,
}: {
  theme: Theme; // the chart is remounted when this changes
  symbol: string;
  bid: number;
  priceTime: number; // UTC seconds of the live price
  gap: number | null; // PAXG-above-spot gap, candles shift down by it; null = not measured yet
  tzLabel: string; // e.g. "PH time": the time axis is shifted to it
  timeframes: string[];
  defaultTf: string;
  offset: number; // display time zone offset in seconds (the chart library only shows UTC)
  history: SignalEvent[];
  range: OpeningRange | null;
  position: Position | null;
  periods: [number, number, number];
  onTimeframe?: (tf: string) => void; // tells the page which timeframe is showing
  /** A past trade to show: the chart switches to the signal timeframe and frames the trade. */
  replay?: { open: SignalEvent; close?: SignalEvent; label: string } | null;
  onExitReplay?: () => void;
  alertPrices?: number[]; // your price alerts, drawn as dotted lines
  /** Daily trend mode's levels, drawn on the D1 chart: the 100-day high and any open paper trade. */
  dailyTrend?: { hh100: number | null; positions: { entry: number; stop: number }[] } | null;
}) {
  const COLORS = PALETTES[theme];
  const [settings, setSettings] = useState<Settings>(loadSettings);
  const [drawings, setDrawings] = useState<Drawing[]>(() => loadDrawings(symbol));
  const [tool, setTool] = useState<Tool>("cursor");
  const [pending, setPending] = useState<Anchor | null>(null);
  const [hover, setHover] = useState<Bar | null>(null);
  const [mainVersion, setMainVersion] = useState(0);
  const [full, setFull] = useState(false); // full-screen chart
  useEffect(() => {
    if (!full) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFull(false);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [full]);

  const chosenTf = settings.tf && timeframes.includes(settings.tf) ? settings.tf : defaultTf;
  const tf = replay ? defaultTf : chosenTf; // replays use the timeframe the signals come from
  const trendLines = tf === "D1" && Boolean(dailyTrend); // daily trend mode's averages and levels

  // Let the page header show the timeframe you picked (and remember across visits)
  useEffect(() => {
    onTimeframe?.(tf);
  }, [tf, onTimeframe]);
  const { type, show } = settings;
  const { candles: raw, error, loadOlder, loadingOlder } = useCandles(tf);
  // Markers: the recent signals, plus the replayed trade (which may be older than those)
  const shownHistory = useMemo(() => {
    if (!replay) return history;
    const extra = [replay.open, ...(replay.close ? [replay.close] : [])];
    return [...history.filter((e) => !extra.some((x) => x.id === e.id)), ...extra];
  }, [history, replay]);
  const loadOlderRef = useRef(loadOlder);
  useEffect(() => {
    loadOlderRef.current = loadOlder;
  }, [loadOlder]);
  const firstShown = useRef<number | null>(null); // oldest candle on the chart, to keep the view steady

  const box = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const mainRef = useRef<ISeriesApi<"Candlestick" | "Bar" | "Line"> | null>(null);
  const markersRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);
  const indicatorRefs = useRef<Record<string, ISeriesApi<SeriesType>>>({});
  const syncKeys = useRef(new Map<unknown, string>());
  const lines = useRef<{ owner: unknown; list: IPriceLine[] }>({ owner: null, list: [] });
  const trendSeries = useRef<ISeriesApi<"Line">[]>([]);
  const shownTf = useRef<string | null>(null);

  const update = (patch: Partial<Settings>) =>
    setSettings((s) => {
      const next = { ...s, ...patch };
      save(SETTINGS_KEY, next);
      return next;
    });
  const toggle = (key: keyof Toggles) => update({ show: { ...show, [key]: !show[key] } });
  const changeDrawings = (next: Drawing[]) => {
    setDrawings(next);
    save(`gold-chart-drawings-${symbol}`, next);
  };

  // The chart ticks with every live price, between the candle refreshes from the bot:
  // the newest candle follows the price, and when its time is up a new candle starts right away.
  const realMinutes = useRealMinutes();
  const candles = useMemo(() => {
    if (!raw || raw.length === 0 || gap === null) return [];
    const r2 = (n: number) => Math.round(n * 100) / 100;
    const shifted = gap ? raw.map((k) => ({ ...k, o: r2(k.o - gap), h: r2(k.h - gap), l: r2(k.l - gap), c: r2(k.c - gap) })) : raw;
    // Recent candles from the real XAUUSD prices the bot recorded; older ones stay PAXG adjusted to spot
    const fetched = withRealPrices(shifted, realMinutes, TF_SECONDS[tf] ?? 1800);
    const last = fetched[fetched.length - 1];
    const step = fetched.length > 1 ? last.t - fetched[fetched.length - 2].t : 60;
    if (priceTime >= last.t + 2 * step) return fetched; // market closed (e.g. weekend): leave the last candle alone
    if (priceTime >= last.t + step) {
      return [...fetched, { t: last.t + step, o: bid, h: bid, l: bid, c: bid, v: 0 }];
    }
    return [...fetched.slice(0, -1), { ...last, c: bid, h: Math.max(last.h, bid), l: Math.min(last.l, bid) }];
  }, [raw, gap, bid, priceTime, realMinutes, tf]);

  const at = (t: number) => (t + offset) as UTCTimestamp;
  // Identifies the candle set apart from the newest candle: when it changes, series are redrawn in full
  // instead of just updating the newest point. Includes the first candle's prices so a shift of the
  // whole history (e.g. a new PAXG-to-spot adjustment) also redraws.
  const dataKey = candles.length
    ? `${tf}|${candles.length}|${candles[0].t}|${candles[0].o}|${candles[0].c}|${offset}|${realMinutes.size}`
    : "";

  // --- chart ---------------------------------------------------------------
  useEffect(() => {
    if (!box.current) return;
    const c = createChart(box.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "transparent" },
        textColor: COLORS.text,
        fontFamily: "var(--font-text), sans-serif",
        attributionLogo: false,
        panes: { separatorColor: COLORS.separator },
      },
      grid: { vertLines: { color: COLORS.grid }, horzLines: { color: COLORS.grid } },
      crosshair: {
        mode: CrosshairMode.Normal,
        horzLine: { labelBackgroundColor: COLORS.label },
        vertLine: { labelBackgroundColor: COLORS.label },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: {
        borderVisible: false,
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
        tickMarkFormatter: tickLabel,
      },
      localization: {
        // Crosshair label, e.g. "Sep 29 3:15 PM"
        timeFormatter: (time: Time) => `${axisDate(time as number, { month: "short", day: "numeric" })} ${axisTime(time as number)}`,
      },
    });
    const onMove = (p: MouseEventParams<Time>) => {
      const main = mainRef.current;
      const d = main && p.time !== undefined ? p.seriesData.get(main) : undefined;
      if (!d) return setHover(null);
      const t = p.time as number;
      if ("open" in d) {
        const b = d as BarData<Time>;
        setHover({ t, o: b.open, h: b.high, l: b.low, c: b.close });
      } else if ("value" in d) {
        const v = (d as LineData<Time>).value;
        setHover({ t, o: v, h: v, l: v, c: v });
      }
    };
    c.subscribeCrosshairMove(onMove);
    const onRange = (r: { from: number; to: number } | null) => {
      if (r && r.from < LOAD_OLDER_AT) loadOlderRef.current();
    };
    c.timeScale().subscribeVisibleLogicalRangeChange(onRange);
    chartRef.current = c;
    const refs = { indicators: indicatorRefs.current, keys: syncKeys.current };
    return () => {
      c.unsubscribeCrosshairMove(onMove);
      c.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
      chartRef.current = null;
      c.remove();
      Object.keys(refs.indicators).forEach((k) => delete refs.indicators[k]);
      refs.keys.clear();
    };
  }, [COLORS]);

  // Main price series; recreated when the chart type changes
  useEffect(() => {
    const c = chartRef.current;
    if (!c) return;
    const s =
      type === "candles"
        ? c.addSeries(CandlestickSeries, {
            upColor: COLORS.up,
            downColor: COLORS.down,
            wickUpColor: COLORS.up,
            wickDownColor: COLORS.down,
            borderVisible: false,
            priceLineColor: COLORS.gold,
          })
        : type === "bars"
          ? c.addSeries(BarSeries, { upColor: COLORS.up, downColor: COLORS.down, thinBars: false, priceLineColor: COLORS.gold })
          : c.addSeries(LineSeries, { color: COLORS.gold, lineWidth: 2, priceLineColor: COLORS.gold });
    mainRef.current = s;
    markersRef.current = createSeriesMarkers(s, []);
    setMainVersion((v) => v + 1);
    return () => {
      mainRef.current = null;
      markersRef.current = null;
      if (chartRef.current) chartRef.current.removeSeries(s);
    };
  }, [type, COLORS]);

  useEffect(() => {
    chartRef.current?.applyOptions({
      grid: { vertLines: { visible: show.grid }, horzLines: { visible: show.grid } },
    });
  }, [show.grid]);

  // Price data
  useEffect(() => {
    const c = chartRef.current;
    const main = mainRef.current;
    if (!c || !main || candles.length === 0) return;
    const ts = c.timeScale();
    const view = ts.getVisibleLogicalRange();
    const prevFirst = firstShown.current;
    if (type === "line") {
      sync(main as ISeriesApi<"Line">, candles.map((k) => ({ time: at(k.t), value: k.c })), dataKey, syncKeys.current);
    } else {
      const bars = candles.map((k) => ({ time: at(k.t), open: k.o, high: k.h, low: k.l, close: k.c }));
      sync(main as ISeriesApi<"Candlestick">, bars, dataKey, syncKeys.current);
    }
    // New timeframe: show the latest bars at a readable zoom, like MetaTrader
    if (shownTf.current !== tf) {
      shownTf.current = tf;
      ts.setVisibleLogicalRange({ from: candles.length - VISIBLE_BARS, to: candles.length + 4 });
    } else if (view && prevFirst !== null && candles[0].t < prevFirst) {
      // Older candles were added at the start: move the view along so the chart doesn't jump
      const added = candles.findIndex((k) => k.t >= prevFirst);
      if (added > 0) ts.setVisibleLogicalRange({ from: view.from + added, to: view.to + added });
    }
    firstShown.current = candles[0].t;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `at` only depends on offset, part of dataKey
  }, [candles, dataKey, mainVersion, type, tf]);

  // Indicators: create/remove series as they're toggled, then feed them data
  useEffect(() => {
    const c = chartRef.current;
    if (!c) return;
    const refs = indicatorRefs.current;
    const line = { priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false };
    const want: Record<string, [boolean, () => ISeriesApi<SeriesType>]> = {
      emaFast: [show.emaFast, () => c.addSeries(LineSeries, { ...line, color: COLORS.fast, lineWidth: 2 })],
      emaSlow: [show.emaSlow, () => c.addSeries(LineSeries, { ...line, color: COLORS.slow, lineWidth: 2 })],
      emaTrend: [
        show.emaTrend,
        () => c.addSeries(LineSeries, { ...line, color: COLORS.trend, lineWidth: 2, lineStyle: LineStyle.Dashed }),
      ],
      dt20: [trendLines, () => c.addSeries(LineSeries, { ...line, color: COLORS.fast, lineWidth: 1 })],
      dt50: [trendLines, () => c.addSeries(LineSeries, { ...line, color: COLORS.slow, lineWidth: 2 })],
      dt200: [
        trendLines,
        () => c.addSeries(LineSeries, { ...line, color: COLORS.trend, lineWidth: 2, lineStyle: LineStyle.Dashed }),
      ],
      bbUpper: [show.bb, () => c.addSeries(LineSeries, { ...line, color: COLORS.band, lineWidth: 1 })],
      bbMiddle: [
        show.bb,
        () => c.addSeries(LineSeries, { ...line, color: COLORS.band, lineWidth: 1, lineStyle: LineStyle.Dotted }),
      ],
      bbLower: [show.bb, () => c.addSeries(LineSeries, { ...line, color: COLORS.band, lineWidth: 1 })],
      volume: [
        show.volume,
        () => {
          const s = c.addSeries(HistogramSeries, {
            priceScaleId: "volume",
            priceFormat: { type: "volume" },
            priceLineVisible: false,
            lastValueVisible: false,
          });
          c.priceScale("volume").applyOptions({ scaleMargins: { top: 0.84, bottom: 0 } });
          return s;
        },
      ],
      rsi: [
        show.rsi,
        () => {
          const s = c.addSeries(LineSeries, { ...line, color: COLORS.gold, lineWidth: 1, lastValueVisible: true }, 1);
          s.createPriceLine({ price: 70, color: COLORS.range, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: "" });
          s.createPriceLine({ price: 30, color: COLORS.range, lineStyle: LineStyle.Dashed, lineWidth: 1, axisLabelVisible: false, title: "" });
          c.panes()[1]?.setStretchFactor(0.28);
          return s;
        },
      ],
    };
    for (const [name, [on, create]] of Object.entries(want)) {
      if (on && !refs[name]) refs[name] = create();
      if (!on && refs[name]) {
        c.removeSeries(refs[name]);
        syncKeys.current.delete(refs[name]);
        delete refs[name];
      }
    }
    if (!show.rsi && c.panes().length > 1) c.removePane(1);
    // Keep candles clear of the volume bars at the bottom of the price pane
    c.priceScale("right").applyOptions({ scaleMargins: { top: 0.08, bottom: show.volume ? 0.2 : 0.08 } });
  }, [show.emaFast, show.emaSlow, show.emaTrend, show.bb, show.volume, show.rsi, trendLines, COLORS]);

  const studies = useMemo(() => {
    if (candles.length === 0) return null;
    return {
      d20: tf === "D1" ? ema(candles, 20) : [],
      d50: tf === "D1" ? sma(candles, 50) : [],
      d200: tf === "D1" ? sma(candles, 200) : [],
      fast: ema(candles, periods[0]),
      slow: ema(candles, periods[1]),
      trend: ema(candles, periods[2]),
      bb: bollinger(candles),
      rsi: rsi(candles),
    };
  }, [candles, periods, tf]);

  useEffect(() => {
    const refs = indicatorRefs.current;
    if (!studies) return;
    const put = (name: string, points: Point[]) => {
      const s = refs[name] as ISeriesApi<"Line"> | undefined;
      // The key includes the indicator periods, so a settings change redraws the whole line
      const key = `${dataKey}|${name}|${periods.join(",")}`;
      if (s) sync(s, points.map((p) => ({ time: at(p.t), value: p.value })), key, syncKeys.current);
    };
    put("emaFast", studies.fast);
    put("emaSlow", studies.slow);
    put("emaTrend", studies.trend);
    put("bbUpper", studies.bb.upper);
    put("bbMiddle", studies.bb.middle);
    put("bbLower", studies.bb.lower);
    put("rsi", studies.rsi);
    put("dt20", studies.d20);
    put("dt50", studies.d50);
    put("dt200", studies.d200);
    const vol = refs.volume as ISeriesApi<"Histogram"> | undefined;
    if (vol) {
      const bars = candles.map((k) => ({
        time: at(k.t),
        value: k.v,
        color: k.c >= k.o ? COLORS.volUp : COLORS.volDown,
      }));
      sync(vol, bars, `${dataKey}|volume`, syncKeys.current);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `at` only depends on offset, part of dataKey
  }, [studies, dataKey, periods, show.emaFast, show.emaSlow, show.emaTrend, show.bb, show.volume, show.rsi, trendLines, COLORS]);

  // Buy / sell / close markers
  useEffect(() => {
    const m = markersRef.current;
    if (!m) return;
    if (!show.markers || candles.length === 0) {
      m.setMarkers([]);
      return;
    }
    const snap = (t: number) => {
      let hit = candles[0].t;
      for (const k of candles) if (k.t <= t) hit = k.t;
      return hit;
    };
    const markers: SeriesMarker<Time>[] = shownHistory
      .filter((e) => e.time >= candles[0].t)
      .map((e): SeriesMarker<Time> => {
        const buy = e.side === "BUY";
        if (e.type === "open") {
          return {
            time: at(snap(e.time)),
            position: buy ? "belowBar" : "aboveBar",
            shape: buy ? "arrowUp" : "arrowDown",
            color: buy ? COLORS.up : COLORS.down,
            text: buy ? "Buy" : "Sell",
          };
        }
        return {
          time: at(snap(e.time)),
          position: buy ? "aboveBar" : "belowBar",
          shape: "circle",
          color: (e.pnl ?? 0) > 0 ? COLORS.up : COLORS.down,
          text: (e.pnl ?? 0) > 0 ? "Profit" : "Loss",
        };
      })
      .sort((a, b) => (a.time as number) - (b.time as number));
    m.setMarkers(markers);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `at` only depends on offset, part of dataKey
  }, [shownHistory, dataKey, mainVersion, show.markers, COLORS]);

  // Horizontal lines: opening range, trade levels, and horizontal-line drawings
  const levelsKey = replay
    ? `replay|${replay.open.id}`
    : position
      ? `${position.entry}|${position.sl}|${position.tp}`
      : "";
  const rangeKey = range ? `${range.hi}|${range.lo}|${range.forming}` : "";
  const alertKey = `${alertPrices.join(",")}|${tf}|${JSON.stringify(dailyTrend ?? null)}`;
  const hlineKey = drawings
    .filter((d) => d.kind === "hline")
    .map((d) => d.id)
    .join(",");
  useEffect(() => {
    const main = mainRef.current;
    if (!main) return;
    if (lines.current.owner === main) lines.current.list.forEach((l) => main.removePriceLine(l));
    const list: IPriceLine[] = [];
    const add = (price: number, color: string, title: string, lineStyle: LineStyle = LineStyle.Dashed) =>
      list.push(main.createPriceLine({ price, color, title, lineStyle, lineWidth: 1, axisLabelVisible: true }));
    if (show.range && range) {
      const style = range.forming ? LineStyle.Dotted : LineStyle.Dashed;
      add(range.hi, COLORS.range, "Range high", style);
      add(range.lo, COLORS.range, "Range low", style);
    }
    const trade = replay
      ? replay.open.sl != null && replay.open.tp != null
        ? { entry: replay.open.price, sl: replay.open.sl, tp: replay.open.tp }
        : null
      : position;
    if ((show.levels || replay) && trade) {
      add(trade.entry, COLORS.gold, "Entry", LineStyle.Solid);
      add(trade.sl, COLORS.down, "SL");
      add(trade.tp, COLORS.up, "TP");
    }
    for (const d of drawings) if (d.kind === "hline") add(d.price, COLORS.drawing, "", LineStyle.Solid);
    for (const p of alertPrices) add(p, COLORS.drawing, "Alert", LineStyle.Dotted);
    if (trendLines && dailyTrend) {
      if (dailyTrend.hh100 != null) add(dailyTrend.hh100, COLORS.gold, "100-day high", LineStyle.Dotted);
      for (const p of dailyTrend.positions) {
        add(p.entry, COLORS.up, "Trend entry", LineStyle.Solid);
        add(p.stop, COLORS.down, "Trend stop");
      }
    }
    lines.current = { owner: main, list };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the values that change the lines
  }, [rangeKey, levelsKey, hlineKey, alertKey, mainVersion, show.range, show.levels, COLORS]);

  // Replay: frame the trade (fetching older candles first if it's further back than the chart goes)
  const replayShown = useRef<string | null>(null);
  const replayTried = useRef<number | null>(null);
  useEffect(() => {
    const c = chartRef.current;
    if (!c || candles.length === 0) return;
    if (!replay) {
      if (replayShown.current) {
        replayShown.current = null;
        c.timeScale().scrollToRealTime();
      }
      return;
    }
    if (replayShown.current === replay.open.id || loadingOlder) return;
    const step = TF_SECONDS[tf] ?? 1800;
    const from = replay.open.time - 24 * step;
    const to = Math.min((replay.close?.time ?? replay.open.time) + 24 * step, candles[candles.length - 1].t);
    if (candles[0].t > from && replayTried.current !== candles[0].t) {
      replayTried.current = candles[0].t; // if nothing older arrives, show what there is
      void loadOlderRef.current();
      return;
    }
    replayShown.current = replay.open.id;
    c.timeScale().setVisibleRange({ from: at(Math.max(from, candles[0].t)), to: at(to) });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `at` only depends on offset
  }, [replay, candles, tf, loadingOlder]);

  // Trend-line drawings: a two-point line series each, snapped to this timeframe's candles
  const trendKey = drawings
    .filter((d) => d.kind === "trend")
    .map((d) => d.id)
    .join(",");
  const firstT = candles[0]?.t ?? 0;
  useEffect(() => {
    const c = chartRef.current;
    if (!c) return;
    trendSeries.current.forEach((s) => c.removeSeries(s));
    trendSeries.current = [];
    if (candles.length === 0) return;
    const snap = (t: number) =>
      candles.reduce((best, k) => (Math.abs(k.t - t) < Math.abs(best - t) ? k.t : best), candles[0].t);
    for (const d of drawings) {
      if (d.kind !== "trend") continue;
      const pts = [d.a, d.b].map((p) => ({ time: at(snap(p.t)), value: p.p })).sort((x, y) => x.time - y.time);
      if (pts[0].time === pts[1].time) continue;
      const s = c.addSeries(LineSeries, {
        color: COLORS.drawing,
        lineWidth: 2,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        autoscaleInfoProvider: () => null, // drawings shouldn't stretch the price scale
      });
      s.setData(pts);
      trendSeries.current.push(s);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- redraw when drawings, timeframe or window change
  }, [trendKey, tf, firstT, offset, COLORS]);

  // --- drawing tools -------------------------------------------------------
  // The active tool and first trend-line point also live in refs, updated the moment they change,
  // so a click straight after picking a tool is never handled with the previous tool.
  const toolRef = useRef<Tool>("cursor");
  const pendingRef = useRef<Anchor | null>(null);
  const setToolNow = (t: Tool) => {
    toolRef.current = t;
    setTool(t);
  };
  const setPendingNow = (a: Anchor | null) => {
    pendingRef.current = a;
    setPending(a);
  };

  // Clicks are read straight off the chart area (the chart library's own click event can merge two
  // quick clicks), then converted to a candle time and price.
  const onChartClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const c = chartRef.current;
    const main = mainRef.current;
    const active = toolRef.current;
    if (active === "cursor" || !c || !main || !box.current) return;
    const rect = box.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (y > c.panes()[0].getHeight()) return; // clicked the RSI panel or the time axis
    const time = c.timeScale().coordinateToTime(x);
    const priceAt = main.coordinateToPrice(y);
    if (time === null || priceAt === null) return;
    const here = { t: (time as number) - offset, p: priceAt };
    const id = `${Date.now()}`;
    const first = pendingRef.current;
    if (active === "hline") {
      changeDrawings([...drawings, { id, kind: "hline", price: priceAt }]);
      setToolNow("cursor");
    } else if (!first) {
      setPendingNow(here);
    } else {
      changeDrawings([...drawings, { id, kind: "trend", a: first, b: here }]);
      setPendingNow(null);
      setToolNow("cursor");
    }
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        toolRef.current = "cursor";
        pendingRef.current = null;
        setTool("cursor");
        setPending(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pickTool = (t: Tool) => {
    setPendingNow(null);
    setToolNow(toolRef.current === t ? "cursor" : t);
  };

  const zoom = (factor: number) => {
    const ts = chartRef.current?.timeScale();
    const r = ts?.getVisibleLogicalRange();
    if (!ts || !r) return;
    const width = Math.max(12, (r.to - r.from) * factor);
    ts.setVisibleLogicalRange({ from: r.to - width, to: r.to });
  };

  // --- OHLC readout ----------------------------------------------------------
  const last = candles[candles.length - 1];
  const shown: Bar | null = hover ?? (last ? { t: last.t + offset, o: last.o, h: last.h, l: last.l, c: last.c } : null);
  const change = shown ? shown.c - shown.o : 0;

  const hint =
    tool === "hline"
      ? "Click the chart to place a horizontal line. Esc to cancel."
      : tool === "trend"
        ? pending
          ? "Click the second point of the trend line."
          : "Click the first point of the trend line. Esc to cancel."
        : null;

  const indicatorOptions: [keyof Toggles, string][] = [
    ["emaFast", `EMA ${periods[0]}`],
    ["emaSlow", `EMA ${periods[1]}`],
    ["emaTrend", `EMA ${periods[2]}`],
    ["bb", "Bollinger Bands (20, 2)"],
    ["rsi", "RSI (14) panel"],
    ["volume", "Tick volume"],
    ["range", "Opening range"],
    ["levels", "Entry, SL and TP lines"],
    ["markers", "Signal markers"],
    ["grid", "Grid"],
  ];

  return (
    <div className="tc" data-full={full || undefined}>
      <div className="tc-toolbar" role="toolbar" aria-label="Chart tools">
        <div className="tc-group" role="group" aria-label="Timeframe">
          {timeframes.map((t) => (
            <button key={t} type="button" aria-pressed={t === tf} onClick={() => {
                onExitReplay?.();
                update({ tf: t });
              }}>
              {t}
            </button>
          ))}
        </div>

        <div className="tc-group" role="group" aria-label="Chart type">
          <button type="button" aria-pressed={type === "bars"} onClick={() => update({ type: "bars" })} title="Bar chart">
            <Icon>
              <path d="M4 3v10M2 5h2M4 11h2M11 2v10M9 4h2M11 10h2" />
            </Icon>
            <span>Bars</span>
          </button>
          <button
            type="button"
            aria-pressed={type === "candles"}
            onClick={() => update({ type: "candles" })}
            title="Candlesticks"
          >
            <Icon>
              <path d="M5 2v2M5 11v3M11 1v3M11 10v3" />
              <rect x="3.5" y="4" width="3" height="7" />
              <rect x="9.5" y="4" width="3" height="6" fill="currentColor" />
            </Icon>
            <span>Candles</span>
          </button>
          <button type="button" aria-pressed={type === "line"} onClick={() => update({ type: "line" })} title="Line chart">
            <Icon>
              <path d="M1 12l4-5 3 3 4-6 3 3" />
            </Icon>
            <span>Line</span>
          </button>
        </div>

        <details className="tc-menu">
          <summary>Indicators</summary>
          <div className="tc-menu-panel">
            {indicatorOptions.map(([key, label]) => (
              <label key={key}>
                <input type="checkbox" checked={show[key]} onChange={() => toggle(key)} />
                {label}
              </label>
            ))}
          </div>
        </details>

        <div className="tc-group" role="group" aria-label="Drawing tools">
          <button type="button" aria-pressed={tool === "cursor"} onClick={() => pickTool("cursor")} title="Crosshair">
            <Icon>
              <path d="M8 1v14M1 8h14" />
            </Icon>
          </button>
          <button type="button" aria-pressed={tool === "hline"} onClick={() => pickTool("hline")} title="Horizontal line">
            <Icon>
              <path d="M1 8h14" />
              <circle cx="8" cy="8" r="1.5" fill="currentColor" />
            </Icon>
          </button>
          <button type="button" aria-pressed={tool === "trend"} onClick={() => pickTool("trend")} title="Trend line">
            <Icon>
              <path d="M2 13L14 3" />
              <circle cx="2.5" cy="12.5" r="1.5" fill="currentColor" />
              <circle cx="13.5" cy="3.5" r="1.5" fill="currentColor" />
            </Icon>
          </button>
          <button
            type="button"
            onClick={() => changeDrawings([])}
            disabled={drawings.length === 0}
            title="Delete all drawings"
          >
            <Icon>
              <path d="M3 4h10M6 4V2.5h4V4M4.5 4l.7 9.5h5.6l.7-9.5" />
            </Icon>
          </button>
        </div>

        <div className="tc-group" role="group" aria-label="Zoom">
          <button type="button" onClick={() => zoom(1.35)} title="Zoom out">
            <Icon>
              <circle cx="7" cy="7" r="5" />
              <path d="M5 7h4M11 11l3.5 3.5" />
            </Icon>
          </button>
          <button type="button" onClick={() => zoom(0.74)} title="Zoom in">
            <Icon>
              <circle cx="7" cy="7" r="5" />
              <path d="M5 7h4M7 5v4M11 11l3.5 3.5" />
            </Icon>
          </button>
          <button type="button" onClick={() => chartRef.current?.timeScale().fitContent()} title="Show all candles">
            <Icon>
              <path d="M1 5V1h4M11 1h4v4M15 11v4h-4M5 15H1v-4" />
            </Icon>
          </button>
          <button type="button" onClick={() => chartRef.current?.timeScale().scrollToRealTime()} title="Jump to latest">
            <Icon>
              <path d="M3 3l5 5-5 5M9 3l5 5-5 5" />
            </Icon>
          </button>
          <button
            type="button"
            onClick={() => setFull((v) => !v)}
            aria-pressed={full}
            title={full ? "Exit full screen (Esc)" : "Full screen chart"}
          >
            <Icon>
              {full ? <path d="M6 1v5H1M10 1v5h5M6 15v-5H1M10 15v-5h5" /> : <path d="M1 6V1h5M10 1h5v5M15 10v5h-5M6 15H1v-5" />}
            </Icon>
          </button>
        </div>
      </div>

      {/* Drawing needs a pointer; Esc cancels a tool */}
      <div className="tc-body" data-tool={tool} onClick={onChartClick}>
        <div ref={box} className="tc-canvas" />
        {shown && (
          <p className="tc-ohlc" aria-live="off">
            <strong>
              {symbol}, {tf}
            </strong>
            <span>O {price2(shown.o)}</span>
            <span>H {price2(shown.h)}</span>
            <span>L {price2(shown.l)}</span>
            <span>C {price2(shown.c)}</span>
            <span data-dir={change >= 0 ? "up" : "down"}>
              {change >= 0 ? "+" : "−"}
              {price2(Math.abs(change))}
            </span>
            <span className="tc-tz">Times in {tzLabel}</span>
          </p>
        )}
        {hint && <p className="tc-hint">{hint}</p>}
        {replay && (
          <div className="tc-replay" role="status">
            <span>Replay</span>
            <strong>{replay.label}</strong>
            <button type="button" onClick={onExitReplay}>
              Back to live
            </button>
          </div>
        )}
        {loadingOlder && <p className="tc-older">Loading older candles…</p>}
        {(!raw || gap === null) &&
          (error ? (
            <p className="tc-status">{error}</p>
          ) : (
            <div className="tc-skeleton" role="status" aria-label={`Loading ${tf} candles`}>
              {Array.from({ length: 28 }, (_, i) => (
                <i key={i} style={{ height: `${30 + ((i * 37) % 45)}%` }} />
              ))}
            </div>
          ))}
      </div>
    </div>
  );
}
