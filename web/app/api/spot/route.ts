export const runtime = "nodejs";

// Swissquote's public XAUUSD spot quote. Browsers can't call it directly (no CORS), so it goes via here.
const SPOT_URL = "https://forex-data-feed.swissquote.com/public-quotes/bboquotes/instrument/XAU/USD";

type Profile = { spreadProfile: string; bid: number; ask: number };
const TIERS = ["elite", "prime", "premium", "standard"]; // tightest spread first

/** GET /api/spot -> { bid, ask } of real XAUUSD */
export async function GET() {
  try {
    const res = await fetch(SPOT_URL, { cache: "no-store", signal: AbortSignal.timeout(5000) });
    if (!res.ok) throw new Error(`Swissquote answered ${res.status}`);
    const data = await res.json();
    // The tightest of Swissquote's free price tiers (elite ~$0.50 vs standard ~$0.70 on gold)
    const profiles: Profile[] = (data as { spreadProfilePrices: Profile[] }[]).flatMap((x) => x.spreadProfilePrices);
    const rank = (x: Profile) => {
      const i = TIERS.indexOf(x.spreadProfile);
      return (i < 0 ? 9 : i) * 1000 + (x.ask - x.bid);
    };
    const p = [...profiles].sort((a, b) => rank(a) - rank(b))[0];
    return Response.json(
      { bid: Math.round(p.bid * 100) / 100, ask: Math.round(p.ask * 100) / 100 },
      // Let Vercel's CDN share one answer for a few seconds, however many tabs are open
      { headers: { "Cache-Control": "public, s-maxage=5, stale-while-revalidate=10" } },
    );
  } catch (error) {
    return Response.json({ error: `Spot price unavailable: ${(error as Error).message}` }, { status: 502 });
  }
}
