import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { Feather } from "@expo/vector-icons";
import { BrandButton, BrandMark } from "@/components/Brand";
import { TradeTicket } from "@/components/TradeTicket";
import { CommentSection } from "@/components/CommentSection";
import { MarketComparisonChart } from "@/components/MarketComparisonChart";
import { MarketOutcomeRows } from "@/components/MarketOutcomeRows";
import { MatchupBanner } from "@/components/MatchupBanner";
import { OutcomeIdentity } from "@/components/OutcomeIdentity";
import { LanguageMenu } from "@/components/LanguageMenu";
import { chartRangeLabel, pointChange, sourceLabel } from "@/src/locale";
import { MarketSourcePanels } from "@/components/MarketSourcePanels";
import { api } from "@/src/api/client";
import { C, catMeta, timeUntil } from "@/src/theme";
import { useLanguage } from "@/src/i18n";
import { useTrading } from "@/src/session/TradingContext";
import { Market, marketTitle, outcomeTitle, probabilityLabel, simulationMultiplier } from "@/src/market";
import { outcomeVisuals } from "@/src/outcomeVisuals";
import { PolymarketData, cents, sourceDate, usd } from "@/src/polymarket";
import { shareContent } from "@/src/utils/useShare";

type Detail = Market & { description?: string | null; description_pt?: string | null; description_zh?: string | null; resolution_note?: string | null };
const WINDOWS = ["1h", "6h", "1d", "1w", "1m", "max"];
const SERIF = Platform.OS === "android" ? "serif" : "Georgia";

export default function MarketDetailScreen() {
  const router = useRouter();
  const { eventId: rawId, eventSnapshot } = useLocalSearchParams<{ eventId: string; eventSnapshot?: string }>();
  const eventId = Number(rawId);
  const { language } = useLanguage();
  const { isAuthenticated, account } = useTrading();
  const { width } = useWindowDimensions();
  const desktop = width >= 1040;
  const copy = (en: string, pt: string, zh: string) => language === "pt" ? pt : language === "zh" ? zh : en;
  const [market, setMarket] = useState<Detail | null>(() => { try { const value = eventSnapshot ? JSON.parse(eventSnapshot) : null; return value?.id === eventId && Array.isArray(value.scenarios) ? value : null; } catch { return null; } });
  const [data, setData] = useState<PolymarketData | null>(null);
  const [interval, setIntervalValue] = useState("1d");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [ticket, setTicket] = useState<number | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const chartWidth = Math.min(width, 1320) - (desktop ? 72 + 344 : 36) - 42;
  const refreshRef = useRef<() => void>(() => {});
  const translationPending = useRef(false);

  useEffect(() => {
    let active = true;
    setIsAdmin(false);
    if (isAuthenticated) api.get("/auth/me").then(response => { if (active) setIsAdmin(!!response.data.is_admin); }).catch(() => {});
    return () => { active = false; };
  }, [isAuthenticated]);

  useFocusEffect(useCallback(() => {
    if (!Number.isInteger(eventId) || eventId <= 0) { setMarket(null); setLoading(false); return; }
    let active = true;
    let running = false;
    let lastRefresh = 0;
    const fastUntil = Date.now() + 45_000;
    const controller = new AbortController();
    const refresh = async () => {
      if (running) return;
      running = true; setLoading(true);
      const [event, source] = await Promise.allSettled([
        api.get(`/events/${eventId}`, { params: { lang: language }, signal: controller.signal }),
        api.get(`/events/${eventId}/polymarket`, { params: { interval, lang: language }, timeout: 25_000, signal: controller.signal }),
      ]);
      if (!active) return;
      if (event.status === "fulfilled") {
        setMarket(event.value.data);
        setSelectedId(current => event.value.data.scenarios.some((s: any) => s.id === current) ? current : event.value.data.scenarios[0]?.id ?? null);
      }
      if (source.status === "fulfilled") setData(source.value.data);
      setError(source.status === "rejected" || event.status === "rejected");
      setLoading(false); running = false; lastRefresh = Date.now();
    };
    refreshRef.current = () => { void refresh(); };
    void refresh();
    const poll = setInterval(() => {
      const delay = translationPending.current && Date.now() < fastUntil ? 5_000 : 30_000;
      if (Date.now() - lastRefresh >= delay) void refresh();
    }, 5_000);
    return () => { active = false; controller.abort(); clearInterval(poll); };
  }, [eventId, language, interval]));

  const activeData = data?.event_id === eventId && (data.language || "en") === language ? data : null;
  const source = activeData?.market;
  const effective = useMemo(() => market ? { ...market, scenarios: market.scenarios.map(s => {
    const quoted = data?.event_id === eventId ? data.outcomes.find(o => o.scenario_id === s.id) : null;
    return quoted?.probability != null ? { ...s, probability: quoted.probability } : s;
  }) } : null, [market, data, eventId]);
  const selected = effective?.scenarios.find(s => s.id === selectedId) ?? effective?.scenarios[0];
  const visuals = outcomeVisuals(effective?.scenarios || [], source?.event?.teams);
  const selectedVisual = visuals.find(visual => visual.id === selected?.id);
  const outcome = activeData?.outcomes.find(o => o.scenario_id === selected?.id);
  const series = data?.event_id === eventId && data.interval === interval ? (effective?.scenarios || []).map((scenario, index) => ({ id: scenario.id, title: outcomeTitle(scenario, language), color: visuals[index].color, points: data.outcomes.find(row => row.scenario_id === scenario.id)?.history || [] })) : [];
  const missingHistory = series.filter(row => row.points.length < 2).map(row => row.title);
  const closed = market?.status !== "open" || source?.closed || source?.accepting_orders === false || (!!market?.closes_at && new Date(market.closes_at + (market.closes_at.endsWith("Z") ? "" : "Z")).getTime() <= Date.now());
  const canTrade = !closed && data?.event_id === eventId && !data.stale && !error && outcome?.probability != null;
  const savedRulesMatch = !source?.rules || source.rules === market?.description;
  const rules = language === "pt" ? source?.localized_rules || (savedRulesMatch ? market?.description_pt : undefined) : language === "zh" ? source?.localized_rules || (savedRulesMatch ? market?.description_zh : undefined) : source?.rules || market?.description;
  const matchup = source?.event?.teams?.length === 2;
  translationPending.current = language !== "en" && (!market || !(language === "pt" ? market.title_pt : market.title_zh) || (!!source?.rules && !rules));

  if (!effective || effective.id !== eventId) return <View style={s.screen}><View style={s.top}><Pressable accessibilityRole="button" onPress={() => router.replace("/(tabs)")}><Text style={s.link}>← {copy("Markets", "Mercados", "市场")}</Text></Pressable></View><View style={s.empty}>{loading ? <ActivityIndicator color={C.PURPLE} /> : <Text style={s.body}>{copy("This market could not be loaded.", "Não foi possível carregar este mercado.", "无法加载此市场。")}</Text>}</View></View>;

  return <View style={s.screen}>
    <View style={s.top}>
      <Pressable accessibilityRole="link" accessibilityLabel={copy("Back to markets", "Voltar aos mercados", "返回市场")} onPress={() => router.canGoBack() ? router.back() : router.replace("/(tabs)")} style={s.nav}><Feather name="arrow-left" size={18} color={C.TEXT_SUB} /><BrandMark size={21} /><Text style={s.wordmark}>SCENARA</Text></Pressable>
      <View style={[s.nav, { gap: 4 }]}>{width >= 768 && <Text style={s.muted}>{copy("MARKET DESK", "PAINEL DE MERCADO", "市场工作台")}</Text>}<LanguageMenu /><Pressable accessibilityRole="button" accessibilityLabel={copy("Share market", "Compartilhar mercado", "分享市场")} onPress={() => void shareContent({ title: marketTitle(effective, language), message: `${marketTitle(effective, language)} · ${probabilityLabel(selected?.probability ?? 0, language)}%`, url: `${Platform.OS === "web" ? window.location.origin : "https://scenara.vercel.app"}/market-detail?eventId=${eventId}` })} style={s.icon}><Feather name="share-2" size={16} color={C.TEXT_SUB} /></Pressable><Pressable accessibilityRole="button" accessibilityLabel={copy("Refresh market data", "Atualizar mercado", "刷新市场数据")} onPress={() => refreshRef.current()} style={s.icon}><Feather name="refresh-cw" size={16} color={C.TEXT_SUB} /></Pressable></View>
    </View>
    <ScrollView contentContainerStyle={[s.page, { paddingHorizontal: desktop ? 36 : 18 }]}>
      <View style={[s.row, { marginBottom: 16 }]}>
        <View style={s.nav}><Text style={s.eyebrow}>{(language === "pt" ? catMeta(effective.category).label_pt : language === "zh" ? catMeta(effective.category).label_zh : catMeta(effective.category).label).toUpperCase()}</Text><View style={s.badge}><View style={[s.dot, { backgroundColor: closed ? C.TEXT_MID : C.GREEN }]} /><Text style={s.muted}>{closed ? copy("CLOSED", "ENCERRADO", "已关闭") : "POLYMARKET"}</Text></View></View>
        {source?.url && <Pressable accessibilityRole="link" onPress={() => void Linking.openURL(source.url!)}><Text style={s.link}>{copy("View source", "Ver fonte", "查看来源")} ↗</Text></Pressable>}
      </View>
      <View style={[s.row, { alignItems: "flex-start", gap: 20, marginBottom: 14 }]}><View style={{ flex: 1, minWidth: 0 }}><Text accessibilityRole="header" style={[s.title, { fontSize: desktop ? 36 : 27 }]}>{matchup ? sourceLabel(source?.event?.title || "", language) || marketTitle(effective, language) : marketTitle(effective, language)}</Text>{matchup && source?.event?.title !== effective.title && <Text style={[s.body, { marginTop: 6 }]}>{marketTitle(effective, language)}</Text>}</View>{!matchup && effective.image_url && <Image source={{ uri: effective.image_url }} style={{ width: desktop ? 64 : 48, height: desktop ? 64 : 48, borderRadius: 8 }} />}</View>
      <View style={[s.row, { justifyContent: "flex-start", flexWrap: "wrap", marginBottom: 24 }]}>
        <Text style={s.muted}>{copy("Source updated", "Fonte atualizada", "来源更新于")} {sourceDate(source?.fetched_at || effective.external_synced_at, language, true)}</Text>
        <Text style={s.muted}>· {timeUntil(effective.closes_at, language as any) || copy("No closing date", "Sem data de encerramento", "暂无结束日期")}</Text>
        {(language === "en" ? source?.tags || [] : source?.localized_tags || []).slice(0, 2).map(tag => <View key={tag} style={s.badge}><Text style={s.muted}>{tag}</Text></View>)}
      </View>
      {(error || data?.stale) && <View style={s.notice}><Text accessibilityRole="alert" style={s.body}>{copy("Source refresh is unavailable. Showing the last available data; orders resume when fresh quotes return.", "Fonte indisponível. Mostrando os últimos dados; ordens voltam com cotações atualizadas.", "来源暂时无法刷新，显示最近数据。报价恢复后可继续模拟交易。")}</Text></View>}
      <View style={{ flexDirection: desktop ? "row" : "column", alignItems: "flex-start", gap: 24 }}>
        <View style={{ flex: 1, width: "100%", minWidth: 0 }}>
          {matchup && source && <MatchupBanner source={source} language={language} compact={width < 600} />}
          <View style={s.panel}>
            <View style={[s.row, { marginBottom: 16 }]}><Text style={s.caption}>{copy("PROBABILITY · BOTH OUTCOMES", "PROBABILIDADE · AMBOS OS RESULTADOS", "概率 · 双方结果")}</Text>{loading && <ActivityIndicator color={C.PURPLE} size="small" />}</View>
            <View style={{ flexDirection: "row", gap: 16, marginBottom: 16 }}>{effective.scenarios.map((scenario, index) => <View key={scenario.id} style={{ flex: 1, minWidth: 0, borderLeftWidth: 2, borderLeftColor: visuals[index].color, paddingLeft: 10 }}><View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}><View style={[s.dot, { backgroundColor: visuals[index].color }]} /><Text numberOfLines={1} style={[s.body, { flex: 1, color: C.TEXT_SUB, fontSize: width < 380 ? 11 : 13 }]}>{outcomeTitle(scenario, language)}</Text></View><Text style={{ color: visuals[index].color, fontFamily: "DMSans_700Bold", fontSize: width < 380 ? 28 : 38, letterSpacing: -1 }}>{probabilityLabel(scenario.probability, language)}<Text style={{ fontSize: width < 380 ? 17 : 22 }}>%</Text></Text></View>)}</View>
            <MarketComparisonChart series={series} width={Math.max(160, chartWidth)} height={width < 600 ? 252 : 310} language={language} />
            <View style={[s.row, { flexWrap: "wrap", marginTop: 14, gap: 8 }]}><Text style={[s.muted, { fontSize: 10 }]}>{copy("Price history", "Histórico de preços", "价格历史")}</Text><View style={{ flexDirection: "row", gap: 2 }}>{WINDOWS.map(window => <Pressable accessibilityRole="button" accessibilityLabel={`${copy("Chart range", "Período do gráfico", "图表范围")} ${chartRangeLabel(window, language)}`} accessibilityState={{ selected: interval === window }} key={window} onPress={() => setIntervalValue(window)} style={[s.range, interval === window && { backgroundColor: C.SURFACE }]}><Text style={{ color: interval === window ? C.TEXT : C.TEXT_MID, fontSize: 10, fontFamily: "DMSans_500Medium" }}>{chartRangeLabel(window, language)}</Text></Pressable>)}</View></View>
            <Text style={[s.muted, { marginTop: 10, fontSize: 10, lineHeight: 16 }]}>{copy("Actual token history. End labels show the last chart price; quotes above refresh every 30 seconds.", "Histórico real. Rótulos finais mostram o último preço do gráfico; cotações acima atualizam a cada 30 segundos.", "真实代币历史。曲线末端为最近历史价格，上方报价每 30 秒刷新。")}</Text>
            {!loading && missingHistory.length > 0 && <Text style={[s.muted, { marginTop: 8 }]}>{copy("History unavailable", "Histórico indisponível", "暂无历史数据")}: {missingHistory.join(", ")}</Text>}
          </View>
          <MarketOutcomeRows market={effective} visuals={visuals} language={language} wide={width >= 600} changeDay={source?.change_day} selectedId={selected?.id} canTrade={canTrade} onSelect={setSelectedId} onPredict={id => { setSelectedId(id); setTicket(id); }} />
          <MarketSourcePanels key={`${eventId}-${language}`} data={activeData} outcome={outcome} rules={rules} onSelectOutcome={setSelectedId} colors={visuals} />
          {market?.resolution_note && <Text style={s.body}>{market.resolution_note}</Text>}
          <View style={{ marginTop: 26 }}><CommentSection eventId={eventId} language={language} /></View>
        </View>
        <View style={{ width: desktop ? 320 : "100%", gap: 18 }}>
          <View style={s.panel}><Text style={s.eyebrow}>{copy("MAKE YOUR CALL", "FAÇA SUA PREVISÃO", "做出预测")}</Text><Text style={[s.section, { marginTop: 10, marginBottom: 18 }]}>{copy("Where do you stand?", "Qual é a sua visão?", "您的判断是什么？")}</Text>
            {effective.scenarios.map((scenario, i) => <Pressable accessibilityRole="button" accessibilityLabel={`${copy("Select", "Selecionar", "选择")} ${outcomeTitle(scenario, language)}`} accessibilityState={{ selected: selected?.id === scenario.id }} key={scenario.id} onPress={() => setSelectedId(scenario.id)} style={[s.choice, selected?.id === scenario.id && { borderColor: visuals[i].color, backgroundColor: visuals[i].color + "10" }]}><View style={s.row}><OutcomeIdentity visual={visuals[i]} size={27} /><Text numberOfLines={2} style={[s.body, { flex: 1 }]}>{outcomeTitle(scenario, language)}</Text><Text style={{ color: visuals[i].color, fontSize: 22, fontFamily: "DMSans_700Bold" }}>{probabilityLabel(scenario.probability, language)}%</Text></View><View style={s.track}><View style={{ height: 3, width: `${Math.max(0, Math.min(100, scenario.probability))}%`, backgroundColor: visuals[i].color }} /></View></Pressable>)}
            {selected && <View style={[s.row, { paddingVertical: 12 }]}><Text style={s.muted}>{copy("$10 prediction · if correct", "$10 simulados · se acertar", "投入 $10 · 预测正确")}</Text><Text style={[s.link, { color: selectedVisual?.color }]}>{usd(10 * simulationMultiplier(selected.probability), false, language)}</Text></View>}
            <BrandButton disabled={!canTrade || !selected} onPress={() => selected && setTicket(selected.id)} style={{ marginTop: 6 }}>{closed ? copy("Market closed", "Mercado encerrado", "市场已关闭") : isAuthenticated ? copy("Open simulated position →", "Abrir posição simulada →", "开立模拟仓位 →") : copy("Try a prediction →", "Faça uma previsão →", "试试预测 →")}</BrandButton>
            <Text style={[s.muted, { marginTop: 14, textAlign: "center", lineHeight: 18 }]}>{copy("Start with $10,000 virtual funds. No deposits or real-money trades.", "Comece com $10.000 virtuais. Sem depósitos ou dinheiro real.", "使用 10,000 美元虚拟资金起步，无需存款，不涉及真实资金。")}</Text>
            {isAuthenticated && <View style={[s.row, { borderTopWidth: 1, borderTopColor: C.BORDER, marginTop: 16, paddingTop: 14 }]}><Text style={s.muted}>{copy("Practice balance", "Saldo simulado", "模拟余额")}</Text><Text style={s.link}>{usd(Number(account?.balance ?? 0), false, language)}</Text></View>}
          </View>
          <View style={s.panel}><Text style={s.section}>{copy("Market snapshot", "Resumo do mercado", "市场快照")}</Text>{[[copy("Last trade", "Último negócio", "最近成交"), cents(source?.last_trade_price, language)], [copy("24h movement", "Movimento 24h", "24 小时变动"), source?.change_day == null ? "—" : pointChange(source.change_day, language)], [copy("7d volume", "Volume 7d", "7 天交易量"), usd(source?.volume_week, true, language)], [copy("30d volume", "Volume 30d", "30 天交易量"), usd(source?.volume_month, true, language)], [copy("Source status", "Status na fonte", "来源状态"), source?.accepting_orders ? copy("Accepting orders", "Aceitando ordens", "接受订单") : closed ? copy("Closed", "Encerrado", "已关闭") : "—"]].map(([label, value]) => <View key={label} style={s.bookRow}><Text style={s.muted}>{label}</Text><Text style={s.link}>{value}</Text></View>)}<Text style={[s.muted, { marginTop: 10, lineHeight: 18 }]}>{copy("Crowd consensus, not a guarantee. Bid and ask prices can differ from displayed probability.", "Consenso do mercado, sem garantia. Compra e venda podem diferir da probabilidade exibida.", "概率反映市场共识，不代表保证。买卖报价可能与显示概率不同。")}</Text></View>
        </View>
      </View>
      <Text style={[s.muted, { textAlign: "center", marginTop: 30 }]}>{copy("Market data: Polymarket · Simulation: Scenara", "Dados: Polymarket · Simulação: Scenara", "市场数据：Polymarket · 模拟：Scenara")}</Text>
      {isAdmin && <Pressable accessibilityRole="link" onPress={() => router.push("/admin")} style={{ alignItems: "center", marginTop: 18 }}><Text style={s.link}>{copy("Admin resolution tools →", "Ferramentas de resolução →", "管理员判定工具 →")}</Text></Pressable>}
    </ScrollView>
    {!desktop && <View style={{ paddingHorizontal: 18, paddingVertical: 12, backgroundColor: C.CARD, borderTopWidth: 1, borderTopColor: C.BORDER, flexDirection: "row", alignItems: "center", gap: 12 }}>{selectedVisual && <OutcomeIdentity visual={selectedVisual} size={30} />}<View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={1} style={s.muted}>{selected ? outcomeTitle(selected, language) : ""}</Text><Text style={[s.section, { color: selectedVisual?.color }]}>{probabilityLabel(selected?.probability ?? 0, language)}%</Text></View><BrandButton disabled={!canTrade || !selected} onPress={() => selected && setTicket(selected.id)}>{closed ? copy("Market closed", "Mercado encerrado", "市场已关闭") : copy("Predict →", "Prever →", "预测 →")}</BrandButton></View>}
    <TradeTicket market={ticket != null ? effective : null} visuals={visuals} initialOutcome={ticket ?? undefined} onClose={() => setTicket(null)} />
  </View>;
}

const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: C.BG }, top: { zIndex: 40, minHeight: 68, paddingHorizontal: 24, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: C.BORDER },
  nav: { flexDirection: "row", alignItems: "center", gap: 12 }, wordmark: { color: C.TEXT, fontFamily: "DMSans_700Bold", letterSpacing: 2, fontSize: 12 }, icon: { minWidth: 40, minHeight: 40, alignItems: "center", justifyContent: "center" },
  page: { width: "100%", maxWidth: 1320, alignSelf: "center", paddingTop: 26, paddingBottom: 42 }, row: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10 },
  title: { flex: 1, color: C.TEXT, fontFamily: SERIF, lineHeight: 44, letterSpacing: -0.7 }, eyebrow: { color: C.PURPLE, fontFamily: "DMSans_700Bold", fontSize: 10, letterSpacing: 1.4 },
  caption: { color: C.TEXT_MID, fontFamily: "DMSans_500Medium", fontSize: 9, letterSpacing: 0.8 }, muted: { color: C.TEXT_MID, fontFamily: "DMSans_400Regular", fontSize: 11 }, body: { color: C.TEXT_SUB, fontFamily: "DMSans_400Regular", fontSize: 13, lineHeight: 20 },
  link: { color: C.TEXT, fontFamily: "DMSans_500Medium", fontSize: 12 }, section: { color: C.TEXT, fontFamily: "DMSans_500Medium", fontSize: 16 }, badge: { flexDirection: "row", alignItems: "center", gap: 6, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 4, backgroundColor: C.SURFACE }, dot: { width: 5, height: 5, borderRadius: 3 },
  panel: { padding: 20, borderWidth: 1, borderColor: C.BORDER, borderRadius: 7, backgroundColor: C.CARD }, chance: { color: C.TEXT, fontFamily: "DMSans_500Medium", fontSize: 58, letterSpacing: -2.5, lineHeight: 74 }, range: { paddingHorizontal: 9, minHeight: 32, alignItems: "center", justifyContent: "center", borderRadius: 4 },
  bookRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12, paddingVertical: 11, borderBottomWidth: 1, borderBottomColor: C.BORDER }, choice: { padding: 13, marginBottom: 10, borderWidth: 1, borderColor: C.BORDER, borderRadius: 5 }, track: { height: 3, backgroundColor: C.SURFACE, marginTop: 12, overflow: "hidden" },
  notice: { borderWidth: 1, borderColor: C.BORDER_P, borderRadius: 5, padding: 14, marginBottom: 20, backgroundColor: C.SURFACE }, empty: { flex: 1, alignItems: "center", justifyContent: "center", padding: 24 },
});
