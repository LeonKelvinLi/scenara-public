import { localeFor } from "./locale";
export type BookLevel = { price: number; size: number; value: number };
export type SourceTeam = { name: string; alias?: string; abbreviation?: string; logo?: string | null; color?: string | null; ordering?: string | null };
export type SourceOutcome = {
  scenario_id: number | null; outcome: string; token_id: string; probability: number | null;
  book_available: boolean; history_available: boolean; book_timestamp?: string;
  bids: BookLevel[]; asks: BookLevel[];
  history: { probability: number; recorded_at: string; source: string }[];
};
export type PolymarketData = {
  event_id: number; source: string; stale: boolean; interval: string; language?: string;
  market: {
    market_id: string; question?: string; url?: string; rules?: string; localized_rules?: string | null; localized_tags?: string[]; resolution_source?: string;
    volume?: number | null; volume_24h?: number | null; volume_week?: number | null;
    volume_month?: number | null; volume_year?: number | null; liquidity?: number | null;
    open_interest?: number | null;
    change_hour?: number | null; change_day?: number | null; change_week?: number | null; change_month?: number | null;
    best_bid?: number | null; best_ask?: number | null; spread?: number | null; last_trade_price?: number | null;
    minimum_order_size?: number | null; tick_size?: number | null;
    starts_at?: string | null; ends_at?: string | null; created_at?: string | null; updated_at?: string | null; fetched_at?: string;
    game_starts_at?: string | null;
    accepting_orders?: boolean; closed?: boolean; resolution_status?: string | null;
    tags?: string[];
    event?: { id?: string; title?: string; localized_title?: string | null; open_interest?: number | null; comment_count?: number | null; volume?: number | null; volume_24h?: number | null; liquidity?: number | null; teams?: SourceTeam[]; game_starts_at?: string | null; sport?: { name?: string; slug?: string } };
  };
  outcomes: SourceOutcome[];
  related_markets: { market_id?: string; local_event_id?: number | null; title: string; localized_title?: string | null; outcome?: string | null; market_type?: string | null; probability: number | null; closed: boolean; volume: number | null; url?: string }[];
  trades_available: boolean;
  trades: { side: string; outcome: string; price: number | null; size: number | null; timestamp: number }[];
};

export function usd(value?: number | null, compact = true, language = "en"): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(localeFor(language), { style: "currency", currency: "USD", notation: compact ? "compact" : "standard", maximumFractionDigits: compact ? 1 : 2 }).format(value);
}

export function cents(value?: number | null, language = "en"): string {
  return value == null || !Number.isFinite(value) ? "—" : `${new Intl.NumberFormat(localeFor(language), { maximumFractionDigits: 2 }).format(value * 100)}¢`;
}

export function sourceDate(value?: string | null, language = "en", includeTime = false): string {
  if (!value) return "—";
  const date = new Date(/(Z|[+-]\d\d:\d\d)$/.test(value) ? value : value + "Z");
  if (!Number.isFinite(date.getTime())) return "—";
  return date.toLocaleString(language === "pt" ? "pt-BR" : language === "zh" ? "zh-CN" : "en-US", includeTime ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" } : { month: "short", day: "numeric", year: "numeric" });
}
