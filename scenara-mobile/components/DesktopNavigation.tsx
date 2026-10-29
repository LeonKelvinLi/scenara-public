import { BrandButton, BrandMark } from "./Brand";
import { Feather } from "@expo/vector-icons";
import { usePathname, useRouter } from "expo-router";
import { Pressable, Text, View } from "react-native";
import { C } from "@/src/theme";
import { usd } from "@/src/polymarket";
import { useLanguage } from "@/src/i18n";
import { useTrading } from "@/src/session/TradingContext";

export function DesktopNavigation() {
  const router = useRouter();
  const path = usePathname();
  const { language, setLanguage } = useLanguage();
  const { isAuthenticated, account, authUser } = useTrading();
  const pt = language === "pt", zh = language === "zh";
  const copy = (en: string, portuguese: string, chinese: string) => pt ? portuguese : zh ? chinese : en;
  const links = [
    { path: "/", icon: "grid", label: copy("Markets", "Mercados", "市场") },
    { path: "/portfolio", icon: "briefcase", label: copy("Portfolio", "Carteira", "投资组合") },
    { path: "/news", icon: "file-text", label: copy("The briefing", "Notícias", "简报") },
    { path: "/leaderboard", icon: "bar-chart-2", label: copy("Leaderboard", "Ranking", "排行榜") },
    { path: "/settings", icon: "sliders", label: copy("Settings", "Ajustes", "设置") },
  ];
  return <View style={{ width: 216, backgroundColor: "#0B0E16", borderRightWidth: 1, borderRightColor: C.BORDER, paddingHorizontal: 22, paddingTop: 24, paddingBottom: 24 }}>
    <Pressable accessibilityRole="button" accessibilityLabel="Scenara home" onPress={() => router.push("/(tabs)")} style={{ marginBottom: 30 }}>
      <BrandMark size={38} />
      <Text style={{ color: C.TEXT, fontFamily: "DMSans_700Bold", letterSpacing: 2.5, fontSize: 15, marginTop: 8 }}>SCENARA</Text>
      <Text style={{ color: C.TEXT_MID, fontFamily: "DMSans_400Regular", fontSize: 10, marginTop: 6 }}>{copy("An independent point of view.", "Um ponto de vista independente.", "独立的视角。")}</Text>
    </Pressable>
    <Text style={{ color: C.TEXT_MID, fontSize: 9, fontFamily: "DMSans_500Medium", letterSpacing: 1.6, marginBottom: 15 }}>{copy("YOUR DESK", "SEU PAINEL", "您的工作台")}</Text>
    <View style={{ gap: 4 }}>{links.map(link => {
      const selected = link.path === "/" ? path === "/" || path === "/(tabs)" : path.endsWith(link.path);
      return <Pressable key={link.path} accessibilityRole="link" accessibilityState={{ selected }} onPress={() => router.push((link.path === "/" ? "/(tabs)" : link.path) as any)} style={({ hovered }: any) => ({ flexDirection: "row", gap: 12, alignItems: "center", minHeight: 42, paddingHorizontal: 10, borderRadius: 3, backgroundColor: selected || hovered ? "#171D2A" : "transparent", borderLeftWidth: 2, borderLeftColor: selected ? C.PURPLE : "transparent" })}>
        <Feather name={link.icon as any} size={17} color={selected ? C.PURPLE : C.TEXT_SUB} />
        <Text style={{ color: selected ? C.TEXT : C.TEXT_SUB, fontFamily: selected ? "DMSans_700Bold" : "DMSans_500Medium", fontSize: 12 }}>{link.label}</Text>
      </Pressable>;
    })}</View>
    <View style={{ marginTop: 24, paddingTop: 18, borderTopWidth: 1, borderTopColor: C.BORDER, gap: 18 }}>
      <Pressable accessibilityRole="link" onPress={() => router.push("/daily-challenge")}><Text style={{ color: C.TEXT_SUB, fontSize: 11, fontFamily: "DMSans_400Regular" }}>{copy("Daily challenge", "Desafio diário", "每日挑战")} ↗</Text></Pressable>
      <Pressable accessibilityRole="link" onPress={() => router.push("/how-it-works")}><Text style={{ color: C.TEXT_SUB, fontSize: 11, fontFamily: "DMSans_400Regular" }}>{copy("How it works", "Como funciona", "使用说明")} ↗</Text></Pressable>
    </View>
    <View style={{ flex: 1, minHeight: 30 }} />
    <View style={{ paddingTop: 18, borderTopWidth: 1, borderTopColor: C.BORDER }}>
      <Text style={{ color: C.TEXT_MID, fontFamily: "DMSans_500Medium", fontSize: 9, letterSpacing: 1.2, marginBottom: 8 }}>{isAuthenticated ? copy("PRACTICE BALANCE", "SALDO SIMULADO", "模拟余额") : copy("A PLACE TO START", "UM PONTO DE PARTIDA", "从这里开始")}</Text>
      <Text style={{ color: C.TEXT, fontFamily: "Georgia", fontSize: 24, marginBottom: 5 }}>{usd(Number(isAuthenticated ? account?.balance ?? 0 : 10_000), false, language)}</Text>
      <Text numberOfLines={1} style={{ color: C.TEXT_MID, fontFamily: "DMSans_400Regular", fontSize: 11, marginBottom: 12 }}>{isAuthenticated ? authUser?.display_name : copy("Virtual funds. Real perspective.", "Saldo virtual. Perspectiva real.", "虚拟资金，真实视角。")}</Text>
      {!isAuthenticated && <BrandButton onPress={() => router.push("/register")} style={{ marginBottom: 12 }}>{copy("Create an account", "Criar uma conta", "注册账户")} →</BrandButton>}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 14 }}>{(["en", "pt", "zh"] as const).map(lang => <Pressable accessibilityRole="button" accessibilityLabel={lang === "en" ? "English" : lang === "pt" ? "Português" : "中文"} accessibilityState={{ selected: language === lang }} key={lang} onPress={() => void setLanguage(lang)} style={{ minHeight: 30, justifyContent: "center" }}><Text style={{ color: language === lang ? C.TEXT : C.TEXT_MID, fontFamily: language === lang ? "DMSans_700Bold" : "DMSans_400Regular", fontSize: 10 }}>{lang === "zh" ? "中文" : lang.toUpperCase()}</Text></Pressable>)}</View>
    </View>
  </View>;
}
