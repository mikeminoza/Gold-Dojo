import { safeLink } from "../lib/links";

/** The paper-plane mark (also exported from Preferences as TelegramIcon); a plain SVG, so the server can render it. */
function PaperPlane({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" aria-hidden>
      <path d="M21 4L3 11l6 2 2 6 3-4 5 4 2-15zM9 13l12-9" />
    </svg>
  );
}

/**
 * "Get the signals on Telegram": the bot's public channel, plus Ask Dojo (the private chat) if it's on.
 * No hooks, so the sign-in and public results pages can render it on the server; the dashboard passes
 * onHide for a small × that hides it on that browser. Shows nothing without a channel link.
 */
export default function TelegramCta({
  url,
  botUrl,
  onHide,
}: {
  url: string | null | undefined;
  botUrl?: string | null;
  onHide?: () => void;
}) {
  const channel = safeLink(url);
  const ask = safeLink(botUrl);
  if (!channel) return null;
  return (
    <section className="tg-cta" aria-labelledby="tg-cta-title">
      <span className="tg-cta-mark" aria-hidden>
        <PaperPlane size={20} />
      </span>
      <div className="tg-cta-text">
        <h2 id="tg-cta-title">Get the signals on Telegram</h2>
        <p>
          Every Daily trend and 4-hour trend paper trade, &lsquo;signal coming&rsquo; warnings and a Sunday summary,
          straight to your phone.
        </p>
        <div className="tg-cta-actions">
          <a className="tg-cta-join" href={channel} target="_blank" rel="noopener noreferrer">
            <PaperPlane />
            Join the channel
          </a>
          {ask && (
            <a className="tg-cta-ask" href={ask} target="_blank" rel="noopener noreferrer">
              Ask Dojo
            </a>
          )}
        </div>
      </div>
      {onHide && (
        <button type="button" className="tg-cta-hide" aria-label="Hide the Telegram card" title="Hide" onClick={onHide}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      )}
    </section>
  );
}
