import { BrandButton, BrandMark } from "@/components/Brand";
import { LinearGradient } from "expo-linear-gradient";
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Image, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, useWindowDimensions } from "react-native";
import { Feather } from "@expo/vector-icons";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { api } from "@/src/api/client";
import { C, catMeta, timeUntil } from "@/src/theme";
import { Market, MarketOutcome, compactAmount, marketTitle, outcomeTitle, probabilityLabel } from "@/src/market";
import { useLanguage } from "@/src/i18n";
import { useTrading } from "@/src/session/TradingContext";
import { HomeNews } from "@/components/HomeNews";
import { TradeTicket } from "@/components/TradeTicket";
import { MarketSparkline, SparkPoint } from "@/components/MarketSparkline";
import { usd } from "@/src/polymarket";
import { pointChange } from "@/src/locale";
import { SidebarContext } from "./_layout";

const SERIF = Platform.OS === "android" ? "serif" : "Georgia";
const PAGE_SIZE = 60;
const CATEGORIES = ["all", "politics", "economy", "crypto", "sports", "technology", "geopolitics", "esports", "elections", "finance", "culture", "weather"];

function Outcome({ outcome, language, index, onPress }: { outcome: MarketOutcome; language: string; index: number; onPress(): void }) {
  const color = index === 0 ? C.GREEN : C.RED;
  return <Pressable accessibilityRole="button" accessibilityLabel={outcomeTitle(outcome, language) + ", " + probabilityLabel(outcome.probability, language) + (language === "pt" ? " por cento. Abrir posição." : language === "zh" ? "%。开仓。" : " percent. Open position.")} onPress={onPress} style={({ hovered, pressed }: any) => [s.outcome, { backgroundColor: hovered || pressed ? C.SURFACE : "transparent" }]}>
    <Text numberOfLines={1} style={{ flex: 1, fontFamily: "DMSans_500Medium", fontSize: 12, color }}>{outcomeTitle(outcome, language)}</Text>
    <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 14, color }}>{probabilityLabel(outcome.probability, language)}%</Text>
  </Pressable>;
}

function MarketCard({ market, language, onOpen, onTrade, points }: { market: Market; language: string; onOpen(): void; onTrade(outcome: number): void; points?: SparkPoint[] }) {
  const category = catMeta(market.category);
  const change = market.external_data?.change_day;
  const first = market.scenarios[0];
  const label = (en: string, pt: string, zh: string) => language === "pt" ? pt : language === "zh" ? zh : en;
  return <View style={s.card}>
    <Pressable accessibilityRole="button" onPress={onOpen} style={{ flexDirection: "row", alignItems: "flex-start", gap: 12 }}>
      {!!market.image_url && <Image source={{ uri: market.image_url }} style={{ width: 42, height: 42, borderRadius: 6, backgroundColor: C.SURFACE }} />}
      <View style={{ flex: 1 }}><View style={[s.row, { marginBottom: 6 }]}><Text style={[s.eyebrow, { fontSize: 8 }]}>{(language === "pt" ? category.label_pt : language === "zh" ? category.label_zh : category.label).toUpperCase()}</Text><Feather name="arrow-up-right" size={13} color={C.TEXT_MID} /></View><Text numberOfLines={2} style={s.cardTitle}>{marketTitle(market, language)}</Text></View>
    </Pressable>
    <View style={[s.row, { marginVertical: 13, minHeight: 38, flexWrap: "wrap" }]}><View style={{ flexDirection: "row", alignItems: "baseline", gap: 7 }}><Text style={{ color: C.TEXT, fontSize: 27, fontFamily: "DMSans_700Bold", letterSpacing: -0.8 }}>{probabilityLabel(first?.probability ?? 0, language)}%</Text><Text numberOfLines={1} style={[s.meta, { maxWidth: 75 }]}>{first ? outcomeTitle(first, language) : ""}</Text></View><View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>{change != null && <Text style={{ color: change >= 0 ? C.GREEN : C.RED, fontFamily: "DMSans_500Medium", fontSize: 11 }}>{change > 0 ? "↗ " : change < 0 ? "↘ " : ""}{pointChange(change, language)}</Text>}<MarketSparkline language={language} points={points} width={68} color={(change ?? 0) >= 0 ? C.GREEN : C.RED} /></View></View>
    <View style={{ flexDirection: "row", gap: 10 }}>{market.scenarios.slice(0, 2).map((outcome, index) => <Outcome key={outcome.id} {...{ outcome, language, index }} onPress={() => onTrade(outcome.id)} />)}</View>
    <View style={s.cardFooter}><View><Text style={s.meta}>{label("24h volume", "Volume 24h", "24 小时交易量")}</Text><Text style={s.smallValue}>{usd(market.external_data?.volume_24h, true, language)}</Text></View><View><Text style={s.meta}>{label("Liquidity", "Liquidez", "流动性")}</Text><Text style={s.smallValue}>{usd(market.external_liquidity, true, language)}</Text></View><View style={{ alignItems: "flex-end" }}><Text style={s.meta}>{timeUntil(market.closes_at, language as any) || "Polymarket"}</Text><Text style={[s.meta, { color: C.PURPLE }]}>Polymarket ↗</Text></View></View>
  </View>;
}

export default function MarketsScreen() {
  const router = useRouter();
  const { language } = useLanguage();
  const { isAuthenticated, account } = useTrading();
  const { open: openMenu } = useContext(SidebarContext);
  const { width } = useWindowDimensions();
  const desktop = width >= 1040;
  const twoColumns = width >= 740;
  const threeColumns = width >= 1500;
  const pt = language === "pt", zh = language === "zh";
  const copy = (en: string, portuguese: string, chinese: string) => pt ? portuguese : zh ? chinese : en;
  const [markets, setMarkets] = useState<Market[]>([]);
  const [category, setCategory] = useState("all");
  const [search, setSearch] = useState("");
  const [closingSoon, setClosingSoon] = useState(false);
  const [boardSort, setBoardSort] = useState("active");
  const [sparks, setSparks] = useState<Record<number, SparkPoint[]>>({});
  const [stats, setStats] = useState<{ traders: number; volume_24h: number; open_markets?: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [more, setMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState(false);
  const [updated, setUpdated] = useState<Date | null>(null);
  const [ticket, setTicket] = useState<{ market: Market; outcome?: number } | null>(null);
  const [newsRefreshKey, setNewsRefreshKey] = useState(0);
  const marketsRef = useRef<Market[]>([]);
  const sequence = useRef(0);
  const abort = useRef<AbortController | null>(null);
  const busy = useRef(false);

  const load = useCallback(async (append = false) => {
    if (append && busy.current) return;
    abort.current?.abort();
    const controller = new AbortController();
    abort.current = controller;
    const request = ++sequence.current;
    busy.current = true;
    if (append) setLoadingMore(true);
    else if (!marketsRef.current.length) setLoading(true);
    try {
      const response = await api.get("/events/", { params: {
        status: "open", limit: PAGE_SIZE, offset: append ? marketsRef.current.length : 0,
        lang: language, ...(category !== "all" ? { category } : {}),
      }, signal: controller.signal });
      if (request !== sequence.current) return;
      const rows: Market[] = Array.isArray(response.data) ? response.data : [];
      const next = append ? [...marketsRef.current, ...rows.filter(row => !marketsRef.current.some(previous => previous.id === row.id))] : rows;
      marketsRef.current = next;
      setMarkets(next); setMore(rows.length === PAGE_SIZE); setError(false); setUpdated(new Date());
    } catch {
      if (request === sequence.current && !controller.signal.aborted) setError(true);
    } finally {
      if (request === sequence.current) {
        busy.current = false;
        setLoading(false); setRefreshing(false); setLoadingMore(false);
      }
    }
  }, [category, language]);

  useFocusEffect(useCallback(() => {
    marketsRef.current = []; setMarkets([]); setLoading(true);
    void load();
    let lastRefresh = Date.now(), fastUntil = 0, wasPending = false;
    const poll = setInterval(() => {
      const pending = language !== "en" && marketsRef.current.some(market => !(language === "pt" ? market.title_pt : market.title_zh));
      if (pending && !wasPending) fastUntil = Date.now() + 45_000;
      wasPending = pending;
      if (!busy.current && Date.now() - lastRefresh >= (pending && Date.now() < fastUntil ? 5_000 : 60_000)) {
        lastRefresh = Date.now(); void load();
      }
    }, 5_000);
    return () => { clearInterval(poll); ++sequence.current; abort.current?.abort(); busy.current = false; };
  }, [load, language]));

  useFocusEffect(useCallback(() => {
    let active = true;
    const fetchStats = () => api.get("/accounts/live-stats", { timeout: 60_000 }).then(response => { if (active) setStats(response.data); }).catch(() => {});
    void fetchStats();
    const poll = setInterval(fetchStats, 90_000);
    return () => { active = false; clearInterval(poll); };
  }, []));

  const visible = useMemo(() => {
    const query = search.trim().toLocaleLowerCase();
    const filtered = markets.filter(market => !query || [market.title, market.title_pt, market.title_zh, market.category].some(value => value?.toLocaleLowerCase().includes(query)));
    return [...filtered].sort((a, b) => closingSoon ? (a.closes_at ? new Date(a.closes_at).getTime() : Infinity) - (b.closes_at ? new Date(b.closes_at).getTime() : Infinity) : boardSort === "moves" ? Math.abs(b.external_data?.change_day ?? 0) - Math.abs(a.external_data?.change_day ?? 0) : boardSort === "liquid" ? (b.external_liquidity ?? 0) - (a.external_liquidity ?? 0) : (b.external_data?.volume_24h ?? 0) - (a.external_data?.volume_24h ?? 0));
  }, [markets, search, closingSoon, boardSort]);
  const featured = useMemo(() => {
    if (category !== "all" || search.trim() || closingSoon) return null;
    return [...markets].filter(market => market.category !== "esports").sort((a, b) => Number(b.is_featured) - Number(a.is_featured) || (b.external_volume ?? 0) - (a.external_volume ?? 0))[0] ?? markets[0] ?? null;
  }, [markets, category, search, closingSoon]);
  const openMarket = (market: Market) => router.push({ pathname: "/market-detail", params: { eventId: String(market.id), eventSnapshot: JSON.stringify(market) } });
  const first = featured?.scenarios[0];
  const locale = pt ? "pt-BR" : zh ? "zh-CN" : "en-US";
  const pulse = [...markets].sort((a, b) => Math.abs(b.external_data?.change_day ?? 0) - Math.abs(a.external_data?.change_day ?? 0)).slice(0, 3);
  const sparkIds = [...new Set([featured?.id, ...visible.slice(0, 19).map(m => m.id)].filter((id): id is number => !!id))].join(",");
  const refreshStamp = updated?.getTime();
  useEffect(() => {
    if (!sparkIds) return;
    const controller = new AbortController();
    api.get("/events/polymarket/sparklines", { params: { ids: sparkIds }, signal: controller.signal, timeout: 25_000 }).then(response => {
      if (!controller.signal.aborted) setSparks(previous => ({ ...previous, ...Object.fromEntries((response.data.series ?? []).map((row: any) => [row.event_id, row.points])) }));
    }).catch(() => {});
    return () => controller.abort();
  }, [sparkIds, refreshStamp]);

  return <View style={{ flex: 1, backgroundColor: C.BG }}>
    <View style={[s.topBar, { paddingHorizontal: desktop ? 38 : 20 }]}>
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>
        {!desktop && <Pressable accessibilityRole="button" accessibilityLabel="Open navigation" onPress={openMenu} style={s.iconButton}><Feather name="menu" size={20} color={C.TEXT} /></Pressable>}
        {!desktop && <BrandMark size={21} />}
        <Text style={s.topLabel}>{desktop ? copy("PREDICTION MARKETS", "MERCADOS DE PREVISÃO", "预测市场") : "SCENARA"}</Text>
        {(desktop || width >= 380) && <View style={s.tag}><Text style={s.tagText}>{copy("SIMULATION", "SIMULAÇÃO", "模拟")}</Text></View>}
      </View>
      {isAuthenticated ? <Pressable accessibilityRole="button" onPress={() => router.push("/(tabs)/portfolio")} style={{ alignItems: "flex-end" }}><Text style={s.meta}>{copy("Your balance", "Seu saldo", "您的余额")}</Text><Text style={{ color: C.TEXT, fontFamily: "DMSans_700Bold", fontSize: 16 }}>{usd(Number(account?.balance ?? 0), false, language)}</Text></Pressable> :
        <Pressable accessibilityRole="button" onPress={() => router.push("/login")} style={{ flexDirection: "row", gap: 10, alignItems: "center", minHeight: 44 }}><Text style={s.link}>{copy("Sign in", "Entrar", "登录")}</Text><Feather name="arrow-up-right" size={16} color={C.TEXT} /></Pressable>}
    </View>
    <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[s.page, { paddingHorizontal: desktop ? 38 : 20 }]} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => { setRefreshing(true); setNewsRefreshKey(value => value + 1); void load(); }} tintColor={C.PURPLE} />}>
      <View style={[s.row, { alignItems: "flex-start", marginBottom: 18 }]}>
        <View style={{ flex: 1 }}>
          <Text style={s.eyebrow}>{new Intl.DateTimeFormat(locale, { weekday: "long", month: "long", day: "numeric" }).format(new Date()).toUpperCase()}</Text>
          <Text accessibilityRole="header" style={[s.title, { fontSize: desktop ? 36 : 30, lineHeight: desktop ? 44 : 37 }]}>{copy("The world, in probabilities.", "O mundo, em probabilidades.", "以概率，洞察世界。")}</Text>
          <Text style={s.subtitle}>{copy("Follow the odds. Make your call. Build a track record.", "Acompanhe as chances. Faça sua previsão. Construa seu histórico.", "关注概率，做出判断，积累预测记录。")}</Text>
        </View>
        {desktop && <View style={{ flexDirection: "row", alignItems: "center", gap: 7 }}><View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: C.GREEN }} /><Text style={s.meta}>{copy("Market feed", "Feed de mercados", "市场动态")}</Text></View>}
      </View>
      <HomeNews refreshKey={newsRefreshKey} />
      {!isAuthenticated && <View style={s.welcome}><View style={{ flex: 1, minWidth: desktop ? 220 : 0 }}><Text style={[s.link, { marginBottom: 5 }]}>{desktop ? copy("An edge starts with a point of view.", "Toda vantagem começa com um ponto de vista.", "优势始于独立判断。") : copy("Your first $10,000 is virtual.", "Seu primeiro $10.000 é virtual.", "10,000 美元虚拟资金起步。") }</Text>{desktop && <Text style={s.meta}>{desktop ? copy("01 Explore real markets   →   02 Predict with $10,000 virtual funds   →   03 Track your results", "01 Explore mercados reais   →   02 Preveja com $10.000 virtuais   →   03 Acompanhe os resultados", "01 探索真实市场   →   02 使用 10,000 美元虚拟资金预测   →   03 追踪表现") : copy("Start with $10,000 virtual funds. No deposits.", "Comece com $10.000 virtuais. Sem depósitos.", "使用 10,000 美元虚拟资金起步，无需存款。") }</Text>}</View><BrandButton onPress={() => router.push("/register")}>{desktop ? copy("Start free →", "Começar grátis →", "免费开始 →") : copy("Start →", "Começar →", "开始 →") }</BrandButton></View>}
      {!!markets.length && <View style={s.boardStats}>{[
        [copy("OPEN MARKETS", "MERCADOS ABERTOS", "开放市场"), `${stats?.open_markets ?? markets.length}`],
        [copy("24H VOLUME · THIS BOARD", "VOLUME 24H · NESTE PAINEL", "24 小时交易量 · 此看板"), usd(markets.reduce((sum, m) => sum + (m.external_data?.volume_24h ?? 0), 0), true, language)],
        [copy("LIQUIDITY · THIS BOARD", "LIQUIDEZ · NESTE PAINEL", "流动性 · 此看板"), usd(markets.reduce((sum, m) => sum + (m.external_liquidity ?? 0), 0), true, language)],
        [copy("MARKET DATA", "DADOS DE MERCADO", "市场数据"), "Polymarket"],
      ].filter((_, i) => desktop || i < 2).map(([label, value]) => <View key={label} style={{ flex: 1, minWidth: 125, paddingVertical: 12 }}><Text style={[s.meta, { fontSize: 8, letterSpacing: 0.7 }]}>{label}</Text><Text style={{ color: C.TEXT, fontFamily: "DMSans_700Bold", fontSize: 19, marginTop: 5 }}>{value}</Text></View>)}</View>}
      <View style={{ flexDirection: "row", gap: 12, marginBottom: 8 }}>
        <View style={s.search}><Feather name="search" size={17} color={C.TEXT_MID} /><TextInput accessibilityLabel={copy("Search markets", "Buscar mercados", "搜索市场")} placeholder={copy("Find a market…", "Encontre um mercado…", "寻找市场…")} placeholderTextColor={C.TEXT_MID} value={search} onChangeText={setSearch} style={s.searchInput} />{!!search && <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setSearch("")} style={s.iconButton}><Feather name="x" size={16} color={C.TEXT_MID} /></Pressable>}</View>
        <Pressable accessibilityRole="button" accessibilityState={{ selected: closingSoon }} onPress={() => setClosingSoon(value => !value)} style={s.sort}><Feather name="sliders" size={15} color={C.TEXT_SUB} /><Text style={s.link}>{closingSoon ? copy("Closing soon", "Encerram em breve", "即将结束") : copy("Explore", "Explorar", "探索")}</Text></Pressable>
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.categories}>
        {CATEGORIES.map(key => { const meta = catMeta(key); const title = key === "all" ? copy("All markets", "Todos", "全部市场") : pt ? meta.label_pt : zh ? meta.label_zh : meta.label; return <Pressable accessibilityRole="button" accessibilityState={{ selected: category === key }} key={key} onPress={() => { setCategory(key); setSearch(""); }} style={[s.category, category === key && { borderBottomColor: C.TEXT }]}><Text style={[s.categoryText, category === key && { color: C.TEXT }]}>{title}</Text></Pressable>; })}
      </ScrollView>
      {loading ? <View style={s.loading}><ActivityIndicator color={C.PURPLE} /><Text style={s.subtitle}>{copy("Gathering the latest markets…", "Buscando os mercados mais recentes…", "正在获取最新市场…")}</Text></View> : error && !markets.length ? <View style={s.loading}><Feather name="cloud-off" color={C.TEXT_MID} size={30} /><Text style={s.subtitle}>{copy("The market feed is taking a moment.", "O feed está demorando um pouco.", "市场数据暂时不可用。")}</Text><Pressable accessibilityRole="button" onPress={() => void load()} style={s.primary}><Text style={s.primaryText}>{copy("Try again", "Tentar novamente", "重试")}</Text></Pressable></View> : <>
        {error && <Text accessibilityRole="alert" style={{ color: C.RED, marginBottom: 16 }}>{copy("Couldn’t refresh. Showing the last loaded markets.", "Não foi possível atualizar. Mostrando os últimos mercados.", "刷新失败，正在显示上次加载的市场。")}</Text>}
        {desktop && featured && first && <View style={[s.leadRow, { flexDirection: desktop ? "row" : "column" }]}>
          <View style={s.lead}>
            <View style={s.row}><Text style={[s.eyebrow, { color: C.PURPLE }]}>{copy("IN FOCUS", "EM FOCO", "焦点")}</Text><Text style={s.meta}>{pt ? catMeta(featured.category).label_pt : zh ? catMeta(featured.category).label_zh : catMeta(featured.category).label}</Text></View>
            <Pressable accessibilityRole="button" onPress={() => openMarket(featured)} style={{ marginTop: 12, marginBottom: 12 }}><Text style={[s.leadTitle, { fontSize: desktop ? 25 : 23 }]}>{marketTitle(featured, language)}</Text></Pressable>
            <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 12 }}><View><Text style={s.leadPercent}>{probabilityLabel(first.probability, language)}<Text style={{ fontSize: 26 }}>%</Text></Text><Text style={s.meta}>{outcomeTitle(first, language)} · {copy("market probability", "probabilidade do mercado", "市场概率")}</Text></View><View style={{ flex: 1, maxWidth: 300, marginHorizontal: 18 }}><MarketSparkline language={language} points={sparks[featured.id]} height={48} /></View>{!!featured.image_url && <Image source={{ uri: featured.image_url }} style={{ width: 56, height: 56, borderRadius: 4 }} />}</View>
            <View style={{ height: 4, backgroundColor: C.SURFACE, marginBottom: 12 }}><LinearGradient colors={[C.BLUE, C.PURPLE, C.PINK]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 4, width: (first.probability + "%") as any }} /></View>
            <View style={{ flexDirection: "row", gap: 10 }}>{featured.scenarios.slice(0, 2).map((outcome, index) => <Outcome key={outcome.id} {...{ outcome, language, index }} onPress={() => setTicket({ market: featured, outcome: outcome.id })} />)}</View>
            <View style={s.cardFooter}><Text style={s.meta}>{usd(featured.external_data?.volume_24h, true, language)} / 24h · {usd(featured.external_liquidity, true, language)} {copy("liquidity", "liquidez", "流动性")} · {timeUntil(featured.closes_at, language as any)}</Text><Pressable accessibilityRole="button" onPress={() => openMarket(featured)}><Text style={s.link}>{copy("Read the market", "Ver o mercado", "查看市场")} ↗</Text></Pressable></View>
          </View>
          <View style={[s.note, { width: desktop ? 310 : "100%" }]}>
            <View style={[s.row, { marginBottom: 8 }]}><Text style={s.eyebrow}>{copy("MARKET PULSE", "PULSO DO MERCADO", "市场脉动")}</Text><Feather name="trending-up" size={16} color={C.PURPLE} /></View>
            {pulse.map((market, i) => <Pressable key={market.id} accessibilityRole="button" onPress={() => openMarket(market)} style={s.pulseRow}><Text style={{ color: C.PURPLE, fontFamily: SERIF, fontSize: 21, width: 18 }}>{i + 1}</Text><View style={{ flex: 1 }}><Text numberOfLines={2} style={{ color: C.TEXT, fontFamily: "DMSans_500Medium", fontSize: 12, lineHeight: 18 }}>{marketTitle(market, language)}</Text><Text style={[s.meta, { marginTop: 4 }]}>{usd(market.external_data?.volume_24h, true, language)} / 24h</Text></View><View style={{ alignItems: "flex-end" }}><Text style={{ color: C.TEXT, fontSize: 17, fontFamily: "DMSans_700Bold" }}>{probabilityLabel(market.scenarios[0]?.probability ?? 0, language)}%</Text><Text style={{ color: (market.external_data?.change_day ?? 0) >= 0 ? C.GREEN : C.RED, fontSize: 10, marginTop: 4 }}>{market.external_data?.change_day == null ? "" : pointChange(market.external_data.change_day, language)}</Text></View></Pressable>)}
            <Text style={[s.meta, { marginTop: 10 }]}>{copy("Biggest 24h moves on this board", "Maiores movimentos de 24h neste painel", "此看板 24 小时最大变动")}</Text>
          </View>
        </View>}
        <View style={[s.row, { marginBottom: 18 }]}><Text accessibilityRole="header" style={s.sectionTitle}>{copy("The market board", "Painel de mercados", "市场看板")}</Text><Text style={s.meta}>{visible.length}{more ? "+" : ""} {copy("markets", "mercados", "个市场")}</Text></View>
        {!visible.length && <View style={s.loading}><Text style={s.subtitle}>{search ? copy("No matches. Try another search.", "Nenhum resultado. Tente outra busca.", "没有匹配结果，请尝试其他关键词。") : copy("No open markets in this category yet.", "Ainda não há mercados abertos nesta categoria.", "此类别暂无开放市场。")}</Text></View>}
        <View style={{ flexDirection: "row", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>{[["active", copy("Most active", "Mais ativos", "最活跃")], ["moves", copy("Biggest moves", "Maiores movimentos", "最大变动")], ["liquid", copy("Most liquid", "Maior liquidez", "最高流动性")]].map(([key, label]) => <Pressable accessibilityRole="button" accessibilityState={{ selected: !closingSoon && boardSort === key }} key={key} onPress={() => { setBoardSort(key); setClosingSoon(false); }} style={[s.filterPill, !closingSoon && boardSort === key && { backgroundColor: C.SURFACE, borderColor: C.BORDER_P }]}><Text style={s.link}>{label}</Text></Pressable>)}<Pressable accessibilityRole="button" accessibilityState={{ selected: closingSoon }} onPress={() => setClosingSoon(true)} style={[s.filterPill, closingSoon && { backgroundColor: C.SURFACE, borderColor: C.BORDER_P }]}><Text style={s.link}>{copy("Closing soon", "Encerram em breve", "即将结束")}</Text></Pressable></View>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 12 }}>{visible.map(market => <View key={market.id} style={{ flexGrow: 1, flexBasis: threeColumns ? "30%" : twoColumns ? "45%" : "100%", maxWidth: threeColumns ? "33.333%" : twoColumns ? "50%" : "100%" }}><MarketCard {...{ market, language }} points={sparks[market.id]} onOpen={() => openMarket(market)} onTrade={outcome => setTicket({ market, outcome })} /></View>)}</View>
        {more && <Pressable accessibilityRole="button" disabled={loadingMore} onPress={() => void load(true)} style={s.loadMore}>{loadingMore ? <ActivityIndicator color={C.TEXT} /> : <Text style={s.link}>{copy("More markets", "Mais mercados", "更多市场")} ↓</Text>}</Pressable>}
        <View style={[s.row, { marginTop: 28, flexWrap: "wrap" }]}><Text style={s.meta}>{copy("Crowd probabilities from Polymarket. All positions are simulated.", "Probabilidades do Polymarket. Todas as posições são simuladas.", "群体概率来自 Polymarket，所有仓位均为模拟。")}</Text>{updated && <Text style={s.meta}>{copy("Updated", "Atualizado", "更新于")} {updated.toLocaleTimeString(locale, { hour: "2-digit", minute: "2-digit" })}</Text>}</View>
        {stats && <View style={{ flexDirection: "row", gap: 24, flexWrap: "wrap", marginTop: 28, borderTopWidth: 1, borderTopColor: C.BORDER, paddingTop: 20 }}><Text style={s.meta}>{stats.traders} {copy("registered traders", "traders registrados", "位注册交易者")}</Text><Text style={s.meta}>{"$"}{compactAmount(stats.volume_24h, language)} {copy("simulated volume / 24h", "volume simulado / 24h", "模拟交易量 / 24小时")}</Text></View>}
      </>}
    </ScrollView>
    <TradeTicket market={ticket?.market ?? null} initialOutcome={ticket?.outcome} onClose={() => setTicket(null)} />
  </View>;
}

const s = StyleSheet.create({
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 12 },
  topBar: { minHeight: 64, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: C.BORDER, gap: 12 },
  topLabel: { color: C.TEXT, fontFamily: "DMSans_700Bold", fontSize: 10, letterSpacing: 1.5 },
  tag: { paddingHorizontal: 7, paddingVertical: 4, backgroundColor: C.SURFACE, borderRadius: 2 },
  tagText: { fontFamily: "DMSans_500Medium", fontSize: 8, letterSpacing: 1, color: C.TEXT_SUB },
  iconButton: { minWidth: 36, minHeight: 44, alignItems: "center", justifyContent: "center" },
  page: { paddingTop: 24, paddingBottom: 44, maxWidth: 1440, width: "100%", alignSelf: "center" },
  eyebrow: { fontFamily: "DMSans_500Medium", fontSize: 10, letterSpacing: 1.4, color: C.TEXT_MID },
  title: { fontFamily: SERIF, fontWeight: "400", color: C.TEXT, letterSpacing: -1.6, marginTop: 12, marginBottom: 9 },
  subtitle: { fontFamily: "DMSans_400Regular", color: C.TEXT_SUB, fontSize: 14, lineHeight: 23 },
  search: { flex: 1, flexDirection: "row", alignItems: "center", borderWidth: 1, borderColor: C.BORDER, borderRadius: 4, paddingLeft: 15, backgroundColor: C.CARD },
  searchInput: { flex: 1, minWidth: 0, fontFamily: "DMSans_400Regular", fontSize: 13, color: C.TEXT, padding: 14 },
  sort: { minHeight: 46, flexDirection: "row", gap: 10, alignItems: "center", paddingHorizontal: 15, borderWidth: 1, borderColor: C.BORDER, borderRadius: 4 },
  categories: { borderBottomWidth: 1, borderBottomColor: C.BORDER, marginBottom: 28, flexGrow: 0 },
  category: { minHeight: 52, justifyContent: "center", paddingRight: 25, marginRight: 3, borderBottomWidth: 2, borderBottomColor: "transparent" },
  categoryText: { fontFamily: "DMSans_500Medium", fontSize: 12, color: C.TEXT_MID },
  leadRow: { gap: 18, marginBottom: 24, alignItems: "stretch" },
  lead: { flex: 1, backgroundColor: C.CARD, borderWidth: 1, borderColor: C.BORDER, borderRadius: 6, padding: 20 },
  leadTitle: { color: C.TEXT, fontFamily: SERIF, lineHeight: 32, letterSpacing: -0.5 },
  leadPercent: { fontFamily: "DMSans_500Medium", fontSize: 44, letterSpacing: -2, lineHeight: 54, color: C.PURPLE },
  note: { padding: 18, borderWidth: 1, borderColor: C.BORDER, backgroundColor: C.CARD, borderRadius: 6 },
  noteTitle: { fontFamily: SERIF, color: C.TEXT, fontSize: 31, lineHeight: 38, letterSpacing: -0.6, marginBottom: 14 },
  noteBody: { color: C.TEXT_SUB, fontFamily: "DMSans_400Regular", fontSize: 13, lineHeight: 23, marginBottom: 24 },
  primary: { minHeight: 46, backgroundColor: C.PURPLE, paddingHorizontal: 21, paddingVertical: 14, borderRadius: 4, alignItems: "center", justifyContent: "center" },
  primaryText: { color: "white", fontFamily: "DMSans_700Bold", fontSize: 12 },
  sectionTitle: { fontFamily: SERIF, color: C.TEXT, fontSize: 27, letterSpacing: -0.4 },
  card: { flex: 1, padding: 16, backgroundColor: C.CARD, borderRadius: 5, borderWidth: 1, borderColor: C.BORDER },
  cardTitle: { flex: 1, color: C.TEXT, fontSize: 14, lineHeight: 21, fontFamily: "DMSans_500Medium", letterSpacing: -0.25 },
  outcome: { flex: 1, minWidth: 0, minHeight: 39, paddingHorizontal: 10, paddingVertical: 9, borderWidth: 1, borderColor: C.BORDER, borderRadius: 4, flexDirection: "row", gap: 8, alignItems: "center", justifyContent: "space-between" },
  cardFooter: { borderTopWidth: 1, borderTopColor: C.BORDER, marginTop: 12, paddingTop: 10, flexDirection: "row", gap: 10, justifyContent: "space-between", alignItems: "center" },
  meta: { fontFamily: "DMSans_400Regular", fontSize: 10, lineHeight: 17, color: C.TEXT_MID },
  link: { fontFamily: "DMSans_500Medium", color: C.TEXT, fontSize: 12 },
  smallValue: { fontFamily: "DMSans_500Medium", fontSize: 12, color: C.TEXT_SUB, marginTop: 3 },
  welcome: { flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 14, padding: 16, marginBottom: 16, borderWidth: 1, borderColor: C.BORDER_P, borderRadius: 6, backgroundColor: "rgba(124,92,252,0.06)" },
  boardStats: { flexDirection: "row", flexWrap: "wrap", gap: 12, borderTopWidth: 1, borderBottomWidth: 1, borderColor: C.BORDER, marginBottom: 18 },
  filterPill: { borderWidth: 1, borderColor: C.BORDER, borderRadius: 4, minHeight: 34, paddingHorizontal: 12, justifyContent: "center" },
  pulseRow: { flexDirection: "row", alignItems: "center", gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: C.BORDER },
  loadMore: { borderWidth: 1, borderColor: C.BORDER, padding: 17, marginTop: 24, alignItems: "center", borderRadius: 4 },
  loading: { minHeight: 260, gap: 18, alignItems: "center", justifyContent: "center", paddingHorizontal: 15 },
});
