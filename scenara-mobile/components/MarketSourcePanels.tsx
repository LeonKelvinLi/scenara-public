import { useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { C } from "@/src/theme";
import { useLanguage } from "@/src/i18n";
import { PolymarketData, SourceOutcome, cents, sourceDate, usd } from "@/src/polymarket";
import { probabilityLabel } from "@/src/market";
import { OutcomeVisual } from "@/src/outcomeVisuals";
import { useRouter } from "expo-router";
import { localeFor, sourceLabel } from "@/src/locale";

export function SourceMetric({ label, value, note }: { label: string; value: string; note?: string }) {
  return <View style={s.metric}><Text style={s.caption}>{label}</Text><Text style={s.metricValue}>{value}</Text>{note && <Text style={s.muted}>{note}</Text>}</View>;
}

export function MarketSourcePanels({ data, outcome, rules, colors = [], onSelectOutcome }: { data: PolymarketData | null; outcome?: SourceOutcome; rules?: string | null; colors?: OutcomeVisual[]; onSelectOutcome?(id: number): void }) {
  const { language } = useLanguage();
  const router = useRouter();
  const copy = (en: string, pt: string, zh: string) => language === "pt" ? pt : language === "zh" ? zh : en;
  const [tab, setTab] = useState("overview");
  const [expandedRules, setExpandedRules] = useState(false);
  const [originalRules, setOriginalRules] = useState(false);
  const source = data?.market;
  const relatedMarkets = (data?.related_markets || []).filter(row => language === "en" || row.localized_title || sourceLabel(row.title, language) !== row.title);
  const displayedRules = originalRules || language === "en" ? source?.rules || rules : rules;
  return <>
    <View style={s.metrics}>
      <SourceMetric label={copy("24H VOLUME", "VOLUME 24H", "24 小时交易量")} value={usd(source?.volume_24h, true, language)} />
      <SourceMetric label={copy("TOTAL VOLUME", "VOLUME TOTAL", "总交易量")} value={usd(source?.volume, true, language)} />
      <SourceMetric label={copy("LIQUIDITY", "LIQUIDEZ", "流动性")} value={usd(source?.liquidity, true, language)} />
      <SourceMetric label={copy("OPEN INTEREST", "INTERESSE ABERTO", "未平仓量")} value={usd(source?.open_interest, true, language)} note={copy("Open market positions", "Posições abertas no mercado", "市场未平仓仓位")} />
    </View>
    <View style={s.tabs}>{[["overview", copy("Overview", "Visão geral", "概览")], ["book", copy("Order book", "Livro de ordens", "订单簿")], ["trades", copy("Recent trades", "Negócios recentes", "最近成交")]].map(([key, label]) => <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: tab === key }} onPress={() => setTab(key)} style={[s.tab, tab === key && { borderBottomColor: C.PURPLE }]}><Text style={[s.link, { color: tab === key ? C.TEXT : C.TEXT_MID }]}>{label}</Text></Pressable>)}</View>
    {tab === "overview" && <View style={s.panel}>
      <Text style={s.section}>{copy("What decides this market", "O que decide este mercado", "市场如何判定")}</Text>
      {originalRules && <Text style={[s.caption, { marginTop: 12 }]}>{copy("Original English rules", "Regras originais em inglês", "英文原始规则")}</Text>}
      <Text numberOfLines={expandedRules ? undefined : 7} style={[s.body, { lineHeight: 24, marginTop: 14 }]}>{displayedRules || copy("Full resolution rules are available on the source market.", "A tradução das regras está sendo preparada. Você pode consultar o original abaixo.", "正在准备规则翻译，您可以查看下方原文。")}</Text>
      {(displayedRules || "").length > 500 && <Pressable accessibilityRole="button" accessibilityState={{ expanded: expandedRules }} onPress={() => setExpandedRules(value => !value)} style={{ minHeight: 44, justifyContent: "center" }}><Text style={[s.link, { color: C.PURPLE }]}>{expandedRules ? copy("Show less ↑", "Mostrar menos ↑", "收起 ↑") : copy("Read full rules ↓", "Ler regras completas ↓", "查看完整规则 ↓")}</Text></Pressable>}
      {language !== "en" && source?.rules && <Pressable accessibilityRole="button" onPress={() => setOriginalRules(value => !value)} style={{ minHeight: 44, justifyContent: "center" }}><Text style={s.muted}>{originalRules ? copy("Show translation", "Mostrar tradução", "显示翻译") : copy("Machine translation · View English original", "Tradução automática · Ver original em inglês", "机器翻译 · 查看英文原文")}</Text></Pressable>}
      {language !== "en" && <Pressable accessibilityRole="link" onPress={() => void Linking.openURL("https://scenara.vercel.app/translation-notices.txt")} style={{ minHeight: 32, justifyContent: "center" }}><Text style={[s.muted, { fontSize: 10 }]}>{copy("Translation credits", "Créditos da tradução", "翻译来源")}</Text></Pressable>}
      {source?.resolution_source && <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(source.resolution_source!)} style={{ marginTop: 16 }}><Text style={s.link}>{copy("Resolution reference", "Referência da resolução", "判定依据")} ↗</Text></Pressable>}
      <View style={[s.metrics, { marginBottom: 0 }]}><SourceMetric label={copy("OPENED", "ABERTO EM", "开始日期")} value={sourceDate(source?.starts_at, language)} /><SourceMetric label={copy("CLOSES", "ENCERRA EM", "结束日期")} value={sourceDate(source?.ends_at, language, true)} /></View>
    </View>}
    {tab === "book" && <View style={s.panel}>
      <View style={s.row}><Text style={s.section}>{sourceLabel(outcome?.outcome || "", language)} · {copy("Order book", "Livro de ordens", "订单簿")}</Text><Text style={s.muted}>Polymarket</Text></View>
      {onSelectOutcome && <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 14 }}>{data?.outcomes.filter(row => row.scenario_id != null).map(row => {
        const color = colors.find(visual => visual.id === row.scenario_id)?.color || C.BLUE;
        return <Pressable accessibilityRole="button" accessibilityLabel={`${copy("Order book for", "Livro de ordens de", "订单簿")} ${sourceLabel(row.outcome, language)}`} accessibilityState={{ selected: row.scenario_id === outcome?.scenario_id }} key={row.scenario_id} onPress={() => onSelectOutcome(row.scenario_id!)} style={{ borderRadius: 4, borderWidth: 1, borderColor: row.scenario_id === outcome?.scenario_id ? color : C.BORDER, minHeight: 40, paddingHorizontal: 12, justifyContent: "center", backgroundColor: row.scenario_id === outcome?.scenario_id ? color + "12" : C.CARD }}><Text style={[s.link, { color }]}>{sourceLabel(row.outcome, language)}</Text></Pressable>;
      })}</View>}
      {outcome?.book_available ? <>
        <View style={s.metrics}><SourceMetric label={copy("BEST BID", "MELHOR COMPRA", "最高买价")} value={cents(outcome.bids[0]?.price, language)} /><SourceMetric label={copy("BEST ASK", "MELHOR VENDA", "最低卖价")} value={cents(outcome.asks[0]?.price, language)} /><SourceMetric label={copy("SPREAD", "DIFERENÇA", "买卖价差")} value={outcome.bids[0] && outcome.asks[0] ? cents(outcome.asks[0].price - outcome.bids[0].price, language) : "—"} /></View>
        <View style={{ flexDirection: "row", gap: 24 }}>{[{ label: copy("BIDS", "COMPRAS", "买单"), levels: outcome.bids, color: C.GREEN }, { label: copy("ASKS", "VENDAS", "卖单"), levels: outcome.asks, color: C.RED }].map(({ label, levels, color }) => <View key={label} style={{ flex: 1 }}><View style={s.row}><Text style={[s.caption, { color }]}>{label}</Text><Text style={s.caption}>{copy("SHARES", "COTAS", "份额")}</Text></View>{levels.map((level, i) => <View key={i} style={s.bookRow}><Text style={{ color, fontSize: 12 }}>{cents(level.price, language)}</Text><Text style={s.body}>{new Intl.NumberFormat(localeFor(language), { notation: "compact", maximumFractionDigits: 1 }).format(level.size)}</Text></View>)}{!levels.length && <Text style={s.muted}>{copy("No resting orders", "Sem ordens", "暂无挂单")}</Text>}</View>)}</View>
        <Text style={[s.muted, { marginTop: 18 }]}>{copy("Public source orders. Scenara positions use virtual funds.", "Ordens públicas da fonte. No Scenara, o saldo é virtual.", "来源公开订单。Scenara 仓位仅使用虚拟资金。")}</Text>
      </> : <Text style={[s.body, { marginTop: 16 }]}>{copy("Order book unavailable for this outcome.", "Livro indisponível para este resultado.", "此结果的订单簿暂不可用。")}</Text>}
    </View>}
    {tab === "trades" && <View style={s.panel}>
      <View style={s.row}><Text style={s.section}>{copy("Recent source trades", "Negócios recentes na fonte", "来源最近成交")}</Text><Text style={s.muted}>Polymarket</Text></View>
      <View style={[s.bookRow, { marginTop: 12 }]}>{[copy("OUTCOME", "RESULTADO", "结果"), copy("PRICE", "PREÇO", "价格"), copy("VALUE", "VALOR", "金额")].map(label => <Text key={label} style={[s.caption, { flex: 1 }]}>{label}</Text>)}</View>
      {data?.trades.map((trade, i) => <View key={`${trade.timestamp}-${i}`} style={s.bookRow}><View style={{ flex: 1 }}><Text style={[s.body, { color: colors.find(visual => visual.id === data.outcomes.find(row => row.outcome === trade.outcome)?.scenario_id)?.color || C.TEXT }]}>{sourceLabel(trade.outcome, language)}</Text><Text style={[s.muted, { fontSize: 9 }]}>{sourceLabel(trade.side, language)} · {new Date(trade.timestamp * 1000).toLocaleTimeString(localeFor(language), { hour: "2-digit", minute: "2-digit" })}</Text></View><Text style={[s.body, { flex: 1 }]}>{cents(trade.price, language)}</Text><Text style={[s.body, { flex: 1 }]}>{trade.price != null && trade.size != null ? usd(trade.price * trade.size, true, language) : "—"}</Text></View>)}
      {!data?.trades.length && <Text style={[s.body, { marginTop: 12 }]}>{copy("No source trades available yet.", "Nenhum negócio da fonte disponível.", "暂无来源成交数据。")}</Text>}
    </View>}
    {!!data?.related_markets.length && <View style={[s.panel, { marginTop: 20 }]}>
      <Text style={s.section}>{copy("More markets in this event", "Mais mercados deste evento", "此事件的更多市场")}</Text><Text style={[s.muted, { marginTop: 6, marginBottom: 12 }]}>{language === "en" ? source?.event?.title : source?.event?.localized_title || ""}</Text>
      {relatedMarkets.slice(0, 10).map((related, i) => <Pressable accessibilityRole="link" key={i} onPress={() => related.local_event_id ? router.push({ pathname: "/market-detail", params: { eventId: related.local_event_id } }) : related.url && void Linking.openURL(related.url)} style={s.bookRow}><View style={{ flex: 1 }}><Text numberOfLines={2} style={s.body}>{related.localized_title || sourceLabel(related.title, language)}{related.closed ? ` · ${copy("Closed", "Encerrado", "已关闭")}` : ""}</Text><Text style={[s.muted, { marginTop: 4, fontSize: 10 }]}>{usd(related.volume, true, language)} {copy("volume", "volume", "交易量")}</Text></View><View style={{ alignItems: "flex-end", maxWidth: "45%" }}><Text style={[s.section, { color: C.BLUE }]}>{related.probability == null ? "—" : probabilityLabel(related.probability, language) + "%"} ↗</Text>{related.outcome && !["yes", "no"].includes(related.outcome.toLowerCase()) && <Text numberOfLines={1} style={[s.muted, { marginTop: 4, fontSize: 10 }]}>{sourceLabel(related.outcome, language)}</Text>}</View></Pressable>)}
    </View>}
  </>;
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  caption: { color: C.TEXT_MID, fontFamily: "DMSans_500Medium", fontSize: 9, letterSpacing: 0.8 },
  muted: { color: C.TEXT_MID, fontFamily: "DMSans_400Regular", fontSize: 11 },
  body: { color: C.TEXT_SUB, fontFamily: "DMSans_400Regular", fontSize: 13, lineHeight: 20 },
  link: { color: C.TEXT, fontFamily: "DMSans_500Medium", fontSize: 12 },
  section: { color: C.TEXT, fontFamily: "DMSans_500Medium", fontSize: 16 },
  panel: { padding: 20, borderWidth: 1, borderColor: C.BORDER, borderRadius: 7, backgroundColor: C.CARD },
  metrics: { flexDirection: "row", flexWrap: "wrap", borderWidth: 1, borderColor: C.BORDER, backgroundColor: C.CARD, borderRadius: 6, marginTop: 18, marginBottom: 22 },
  metric: { flex: 1, minWidth: 125, padding: 16, gap: 8 },
  metricValue: { fontFamily: "DMSans_500Medium", fontSize: 20, color: C.TEXT },
  tabs: { flexDirection: "row", flexWrap: "wrap", gap: 14, borderBottomWidth: 1, borderBottomColor: C.BORDER, marginBottom: 18 },
  tab: { minHeight: 44, justifyContent: "center", borderBottomWidth: 2, borderBottomColor: "transparent" },
  bookRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: C.BORDER },
});
