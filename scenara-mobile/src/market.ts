import { localeFor, sourceLabel } from "./locale";

export type MarketOutcome = {
  id: number;
  title: string;
  title_pt?: string | null;
  title_zh?: string | null;
  probability: number;
  status: string;
};

export type Market = {
  id: number;
  title: string;
  title_pt?: string | null;
  title_zh?: string | null;
  category: string;
  status: string;
  closes_at: string | null;
  scenarios: MarketOutcome[];
  image_url?: string | null;
  external_volume?: number | null;
  is_featured?: boolean;
  external_source?: string | null;
  external_url?: string | null;
  external_synced_at?: string | null;
  external_liquidity?: number | null;
  external_data?: { volume_24h?: number | null; change_day?: number | null; accepting_orders?: boolean | null; fetched_at?: string | null } | null;
};

export function marketTitle(market: Market, language: string): string {
  if (language === "pt") return market.title_pt || "Traduzindo mercado…";
  if (language === "zh") return market.title_zh || "正在翻译市场…";
  return market.title;
}

export function outcomeTitle(outcome: MarketOutcome, language: string): string {
  if (language === "pt") return sourceLabel(outcome.title, language) !== outcome.title ? sourceLabel(outcome.title, language) : outcome.title_pt || outcome.title;
  if (language === "zh") return sourceLabel(outcome.title, language) !== outcome.title ? sourceLabel(outcome.title, language) : outcome.title_zh || outcome.title;
  return outcome.title;
}

export function compactAmount(amount: number, language = "en"): string {
  return new Intl.NumberFormat(localeFor(language), { notation: "compact", maximumFractionDigits: 1 }).format(amount);
}

// Match the API's locked odds, including its 2% simulation fee.
export function simulationMultiplier(probability: number): number {
  return Math.round(98 / Math.max(1, Math.min(99, probability)) * 10_000) / 10_000;
}

export function probabilityLabel(probability: number, language = "en"): string {
  return new Intl.NumberFormat(localeFor(language), { maximumFractionDigits: 1 }).format(probability);
}
