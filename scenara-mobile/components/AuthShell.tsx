import { BrandMark } from "./Brand";
import { ReactNode } from "react";
import { Platform, Pressable, ScrollView, Text, View, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { C } from "@/src/theme";
import { useLanguage } from "@/src/i18n";

export function AuthShell({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  const wide = width >= 900;
  const router = useRouter();
  const { language, setLanguage } = useLanguage();
  const copy = (en: string, pt: string, zh: string) => language === "pt" ? pt : language === "zh" ? zh : en;
  const serif = Platform.OS === "android" ? "serif" : "Georgia";
  return <ScrollView style={{ flex: 1, backgroundColor: C.BG }} contentContainerStyle={{ flexGrow: 1 }}>
    <View style={{ minHeight: 76, paddingHorizontal: wide ? 48 : 24, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomWidth: 1, borderBottomColor: C.BORDER }}>
      <Pressable accessibilityRole="link" onPress={() => router.replace("/(tabs)")} style={{ flexDirection: "row", alignItems: "center", gap: 12 }}><BrandMark size={24} /><Text style={{ color: C.TEXT, fontFamily: "DMSans_700Bold", letterSpacing: 2.5, fontSize: 14 }}>SCENARA</Text></Pressable>
      <View style={{ flexDirection: "row", gap: 16 }}>{(["en", "pt", "zh"] as const).map(lang => <Pressable accessibilityRole="button" key={lang} onPress={() => void setLanguage(lang)} style={{ minHeight: 44, justifyContent: "center" }}><Text style={{ color: lang === language ? C.TEXT : C.TEXT_MID, fontSize: 11, fontFamily: "DMSans_500Medium" }}>{lang === "zh" ? "中文" : lang.toUpperCase()}</Text></Pressable>)}</View>
    </View>
    <View style={{ flex: 1, flexDirection: wide ? "row" : "column", maxWidth: 1280, alignSelf: "center", width: "100%" }}>
      {wide && <View style={{ flex: 1, padding: 64, justifyContent: "center", borderRightWidth: 1, borderRightColor: C.BORDER }}>
        <Text style={{ color: C.PURPLE, fontFamily: "DMSans_500Medium", fontSize: 10, letterSpacing: 2, marginBottom: 25 }}>{copy("AN INDEPENDENT POINT OF VIEW", "UM PONTO DE VISTA INDEPENDENTE", "独立的视角")}</Text>
        <Text style={{ color: C.TEXT, fontFamily: serif, fontSize: 51, lineHeight: 59, letterSpacing: -1.5, marginBottom: 34 }}>{copy("What you think.\nWhat happens.", "O que você pensa.\nO que acontece.", "您的判断。\n世界的答案。")}</Text>
        {[
          [copy("Real events", "Eventos reais", "真实事件"), copy("Explore the questions the world is asking.", "Explore as perguntas que o mundo está fazendo.", "探索世界正在关注的问题。")],
          [copy("Virtual funds", "Saldo virtual", "虚拟资金"), copy("Start with $10,000. No deposits or real money.", "Comece com $10.000. Sem depósitos ou dinheiro real.", "从 10,000 美元起步，无需存款或真实资金。")],
          [copy("Your track record", "Seu histórico", "您的预测记录"), copy("See how your judgement holds up over time.", "Veja como suas previsões evoluem com o tempo.", "观察您的判断如何经受时间检验。")],
        ].map(([title, body], index) => <View key={title} style={{ flexDirection: "row", gap: 20, borderTopWidth: 1, borderTopColor: C.BORDER, paddingVertical: 20 }}><Text style={{ color: C.PURPLE, fontFamily: serif, fontSize: 17 }}>{"0" + (index + 1)}</Text><View style={{ flex: 1 }}><Text style={{ color: C.TEXT, fontFamily: "DMSans_500Medium", fontSize: 13, marginBottom: 5 }}>{title}</Text><Text style={{ color: C.TEXT_SUB, fontFamily: "DMSans_400Regular", fontSize: 12, lineHeight: 20 }}>{body}</Text></View></View>)}
      </View>}
      <View style={{ flex: 1, padding: wide ? 48 : 22, paddingTop: wide ? 48 : 32, justifyContent: "center" }}>{children}<Pressable accessibilityRole="link" onPress={() => router.replace("/(tabs)")} style={{ alignSelf: "center", minHeight: 44, justifyContent: "center", marginTop: 18 }}><Text style={{ color: C.TEXT_SUB, fontFamily: "DMSans_400Regular", fontSize: 12 }}>← {copy("Back to markets", "Voltar aos mercados", "返回市场")}</Text></Pressable></View>
    </View>
  </ScrollView>;
}
