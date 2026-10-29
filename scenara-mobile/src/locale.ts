export const localeFor = (language = "en") => language === "pt" ? "pt-BR" : language === "zh" ? "zh-CN" : "en-US";
export function defaultLanguage(locale = "en"): "en" | "pt" | "zh" {
  return locale.toLowerCase().startsWith("pt") ? "pt" : locale.toLowerCase().startsWith("zh") ? "zh" : "en";
}
const labels: Record<string, [string, string]> = {
  yes: ["Sim", "是"], no: ["Não", "否"], over: ["Mais", "大于"], under: ["Menos", "小于"], draw: ["Empate", "平局"], tie: ["Empate", "平局"], other: ["Outro", "其他"],
  buy: ["Compra", "买入"], sell: ["Venda", "卖出"], sports: ["Esportes", "体育"], games: ["Jogos", "比赛"], politics: ["Política", "政治"], elections: ["Eleições", "选举"], "military strikes": ["Ações militares", "军事行动"], monthly: ["Mensal", "每月"], baseball: ["Beisebol", "棒球"], basketball: ["Basquete", "篮球"],
};
export function sourceLabel(text: string | null | undefined, language: string): string {
  text = text || "";
  if (language === "en") return text;
  const known = labels[text.trim().toLowerCase()];
  if (known) return known[language === "pt" ? 0 : 1];
  return text.replace(/\bvs\.?\s/gi, language === "pt" ? "x " : "对阵 ")
    .replace(/^Spread\s*:?\s*/i, language === "pt" ? "Handicap " : "让分 ")
    .replace(/^O\/U\s*/i, language === "pt" ? "Mais/menos " : "大小盘 ");
}
export function chartRangeLabel(range: string, language: string): string {
  if (range === "max") return language === "pt" ? "TUDO" : language === "zh" ? "全部" : "ALL";
  const labels = language === "pt" ? { "1h": "1H", "6h": "6H", "1d": "1D", "1w": "1S", "1m": "1M" } : language === "zh" ? { "1h": "1小时", "6h": "6小时", "1d": "1天", "1w": "1周", "1m": "1月" } : {};
  return labels[range as keyof typeof labels] || range.toUpperCase();
}
export function pointChange(value: number, language: string): string {
  return `${value > 0 ? "+" : ""}${new Intl.NumberFormat(localeFor(language), { maximumFractionDigits: 1 }).format(value)} ${language === "pt" ? "p.p." : language === "zh" ? "个百分点" : "pp"}`;
}
