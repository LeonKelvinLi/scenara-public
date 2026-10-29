import { localeFor } from "./locale";

export type NewsArticle = { title: string; description: string; url: string; image: string; published: string; source: string; source_url: string };

export function latestHeadlines(rows: unknown, now = Date.now()): NewsArticle[] {
  if (!Array.isArray(rows)) return [];
  const seen = new Set<string>();
  return rows.filter((row): row is NewsArticle => {
    if (!row || typeof row.title !== "string" || !row.title.trim() || typeof row.url !== "string") return false;
    try { if (!["https:", "http:"].includes(new URL(row.url).protocol)) return false; } catch { return false; }
    const published = Date.parse(row.published);
    if (Number.isFinite(published) && now - published > 48 * 60 * 60 * 1000) return false;
    const key = row.title.trim().toLocaleLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(row => ({ title: row.title.trim(), description: row.description || "", url: row.url, image: row.image || "", published: row.published || "", source: row.source || "", source_url: row.source_url || "" }))
    .sort((a, b) => (Date.parse(b.published) || 0) - (Date.parse(a.published) || 0)).slice(0, 4);
}

export function newsAge(published: string, language: string, now = Date.now()): string {
  const timestamp = Date.parse(published);
  if (!Number.isFinite(timestamp)) return "";
  const minutes = Math.max(0, Math.floor((now - timestamp) / 60_000));
  return new Intl.RelativeTimeFormat(localeFor(language), { numeric: "auto" }).format(
    minutes < 60 ? -minutes : minutes < 1440 ? -Math.floor(minutes / 60) : -Math.floor(minutes / 1440),
    minutes < 60 ? "minute" : minutes < 1440 ? "hour" : "day",
  );
}
