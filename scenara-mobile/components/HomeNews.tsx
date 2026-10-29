import { useCallback, useEffect, useRef, useState } from "react";
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Feather } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import { api } from "@/src/api/client";
import { useLanguage } from "@/src/i18n";
import { latestHeadlines, NewsArticle, newsAge } from "@/src/news";
import { C } from "@/src/theme";

export function HomeNews({ refreshKey = 0 }: { refreshKey?: number }) {
  const { language } = useLanguage();
  const router = useRouter();
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const [feed, setFeed] = useState<{ language: string; articles: NewsArticle[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const refresh = useRef<() => void>(() => {});
  const copy = (en: string, pt: string, zh: string) => language === "pt" ? pt : language === "zh" ? zh : en;
  const articles = feed?.language === language ? feed.articles : [];

  useFocusEffect(useCallback(() => {
    let active = true, running = false;
    const controller = new AbortController();
    const load = async () => {
      if (running) return;
      running = true; setLoading(true);
      try {
        const response = await api.get("/news/single", { params: { category: "all", lang: language, max_results: 20 }, signal: controller.signal, timeout: 25_000 });
        if (active) { setFeed({ language, articles: latestHeadlines(response.data.articles) }); setFailed(false); }
      } catch { if (active && !controller.signal.aborted) setFailed(true); }
      finally { running = false; if (active) setLoading(false); }
    };
    refresh.current = () => { void load(); };
    void load();
    const timer = setInterval(() => void load(), 90_000);
    return () => { active = false; controller.abort(); clearInterval(timer); };
  }, [language]));
  useEffect(() => { if (refreshKey) refresh.current(); }, [refreshKey]);

  const open = (article: NewsArticle) => router.push({ pathname: "/news-detail", params: { ...article } });
  const metadata = (article: NewsArticle) => <View style={s.metaRow}><Text numberOfLines={1} style={s.source}>{article.source}</Text><Text style={s.age}>{newsAge(article.published, language)}</Text></View>;
  const lead = articles[0];
  return <View testID="home-news" style={s.section}>
    <View style={s.header}>
      <View><Text style={s.eyebrow}>{copy("THE DAILY BRIEFING", "PANORAMA DO DIA", "每日简报")}</Text><Text accessibilityRole="header" style={s.title}>{copy("In the headlines.", "Nas manchetes.", "今日头条。")}</Text></View>
      <Pressable accessibilityRole="link" onPress={() => router.push("/(tabs)/news")} style={s.all}><Text style={s.link}>{copy("All news", "Todas as notícias", "全部新闻")}</Text><Feather name="arrow-up-right" size={15} color={C.TEXT_SUB} /></Pressable>
    </View>
    {lead ? <View style={[s.stories, { flexDirection: wide ? "row" : "column" }]}>
      <Pressable accessibilityRole="link" accessibilityLabel={lead.title} onPress={() => open(lead)} style={({ hovered }: any) => [s.lead, { flex: wide ? 1.15 : undefined, backgroundColor: hovered ? C.SURFACE : C.CARD }]}>
        <LinearGradient colors={[C.BLUE, C.PURPLE, C.PINK]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={s.accent} />
        <View style={s.leadTop}><Text style={s.leadLabel}>{copy("TOP STORY", "EM DESTAQUE", "焦点新闻")}</Text><Feather name="arrow-up-right" size={18} color={C.TEXT_MID} /></View>
        <Text numberOfLines={wide ? 4 : 3} style={[s.headline, { fontSize: wide ? 28 : 24, lineHeight: wide ? 35 : 31 }]}>{lead.title}</Text>
        {!!lead.description && <Text numberOfLines={2} style={s.description}>{lead.description}</Text>}
        {metadata(lead)}
      </Pressable>
      {articles.length > 1 && <View style={[s.more, wide && { flex: 1 }]}>{articles.slice(1).map((article, index) => <Pressable accessibilityRole="link" accessibilityLabel={article.title} key={article.url} onPress={() => open(article)} style={({ hovered }: any) => [s.story, index > 0 && { borderTopWidth: 1, borderTopColor: C.BORDER }, hovered && { backgroundColor: C.SURFACE }]}>
        <Text style={s.number}>{String(index + 2).padStart(2, "0")}</Text><View style={{ flex: 1, minWidth: 0 }}><Text numberOfLines={2} style={s.storyTitle}>{article.title}</Text>{metadata(article)}</View><Feather name="arrow-up-right" size={14} color={C.TEXT_MID} />
      </Pressable>)}</View>}
    </View> : <View style={s.empty}>{loading ? <><ActivityIndicator color={C.PURPLE} /><Text style={s.age}>{copy("Gathering the latest headlines…", "Buscando as últimas notícias…", "正在获取最新新闻…")}</Text></> : <><Feather name="file-text" size={20} color={C.TEXT_MID} /><Text style={s.description}>{copy("Headlines are temporarily unavailable.", "As notícias estão temporariamente indisponíveis.", "新闻暂时不可用。")}</Text><Pressable accessibilityRole="button" onPress={() => refresh.current()} style={s.retry}><Text style={s.link}>{copy("Try again", "Tentar novamente", "重试")}</Text></Pressable></>}</View>}
    {failed && !!articles.length && <Text accessibilityRole="alert" style={s.age}>{copy("Showing the last loaded headlines. Pull to refresh.", "Exibindo as últimas notícias carregadas. Puxe para atualizar.", "正在显示上次加载的新闻，下拉可刷新。")}</Text>}
  </View>;
}

const s = StyleSheet.create({
  section: { marginBottom: 26 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 16, marginBottom: 15, flexWrap: "wrap" },
  eyebrow: { fontFamily: "DMSans_500Medium", fontSize: 9, letterSpacing: 1.4, color: C.PURPLE, marginBottom: 6 },
  title: { fontFamily: Platform.OS === "android" ? "serif" : "Georgia", color: C.TEXT, fontSize: 26, lineHeight: 33, letterSpacing: -0.6 },
  all: { flexDirection: "row", alignItems: "center", gap: 8, minHeight: 44 },
  link: { fontFamily: "DMSans_500Medium", fontSize: 12, color: C.TEXT_SUB },
  stories: { gap: 14, alignItems: "stretch" },
  lead: { borderWidth: 1, borderColor: C.BORDER, borderRadius: 6, overflow: "hidden", padding: 22, minWidth: 0, justifyContent: "space-between", gap: 14 },
  accent: { position: "absolute", left: 0, right: 0, top: 0, height: 2 },
  leadTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  leadLabel: { color: C.TEXT_MID, fontFamily: "DMSans_500Medium", fontSize: 9, letterSpacing: 1.2 },
  headline: { fontFamily: Platform.OS === "android" ? "serif" : "Georgia", color: C.TEXT, letterSpacing: -0.5 },
  description: { fontFamily: "DMSans_400Regular", fontSize: 12, lineHeight: 20, color: C.TEXT_SUB },
  metaRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 10, rowGap: 3, marginTop: 8 },
  source: { flexShrink: 1, fontFamily: "DMSans_500Medium", fontSize: 10, color: C.TEXT_SUB },
  age: { fontFamily: "DMSans_400Regular", fontSize: 10, lineHeight: 17, color: C.TEXT_MID },
  more: { borderWidth: 1, borderColor: C.BORDER, borderRadius: 6, overflow: "hidden", minWidth: 0, backgroundColor: C.CARD },
  story: { flex: 1, minHeight: 85, padding: 15, flexDirection: "row", alignItems: "center", gap: 13 },
  number: { fontFamily: "DMSans_500Medium", fontSize: 12, color: C.PURPLE },
  storyTitle: { fontFamily: "DMSans_500Medium", fontSize: 13, lineHeight: 20, color: C.TEXT },
  empty: { minHeight: 130, flexDirection: "row", alignItems: "center", justifyContent: "center", flexWrap: "wrap", gap: 12, padding: 20, borderWidth: 1, borderColor: C.BORDER, borderRadius: 6 },
  retry: { minHeight: 44, justifyContent: "center", paddingHorizontal: 12 },
});
