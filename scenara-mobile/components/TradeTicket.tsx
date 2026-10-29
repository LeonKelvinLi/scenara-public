import { BrandButton } from "./Brand";
import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from "react-native";
import { useRouter } from "expo-router";
import { C } from "@/src/theme";
import { useTrading } from "@/src/session/TradingContext";
import { useLanguage } from "@/src/i18n";
import { Market, marketTitle, outcomeTitle, simulationMultiplier, probabilityLabel } from "@/src/market";
import { localeFor } from "@/src/locale";
import { usd } from "@/src/polymarket";
import { OutcomeVisual, outcomeVisuals } from "@/src/outcomeVisuals";
import { OutcomeIdentity } from "./OutcomeIdentity";

export function TradeTicket({ market, initialOutcome, onClose, visuals }: {
  market: Market | null; initialOutcome?: number; onClose(): void; visuals?: OutcomeVisual[];
}) {
  const router = useRouter();
  const { language } = useLanguage();
  const { isAuthenticated, account, placePrediction } = useTrading();
  const { width, height } = useWindowDimensions();
  const [outcomeId, setOutcomeId] = useState<number | null>(null);
  const [amount, setAmount] = useState("50");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [complete, setComplete] = useState(false);
  const pt = language === "pt";
  const zh = language === "zh";
  useEffect(() => {
    setOutcomeId(initialOutcome ?? market?.scenarios[0]?.id ?? null);
    setAmount("50"); setError(""); setComplete(false);
  }, [market?.id, initialOutcome]);
  if (!market) return null;
  const choices = visuals || outcomeVisuals(market.scenarios);
  const outcome = market.scenarios.find(s => s.id === outcomeId);
  const stake = Number(amount.replace(",", "."));
  const multiplier = outcome ? simulationMultiplier(outcome.probability) : 0;
  const valid = Number.isFinite(stake) && stake >= 1 && stake <= 2000 && (!account || stake <= Number(account.balance));
  const label = (en: string, portuguese: string, chinese: string) => pt ? portuguese : zh ? chinese : en;
  const submit = async () => {
    if (!isAuthenticated) { onClose(); router.push("/register"); return; }
    if (!valid || !outcome || pending) return;
    setPending(true); setError("");
    try {
      const result = await placePrediction(outcome.id, stake);
      if (result.ok) setComplete(true);
      else setError(language === "en" ? result.error || "Could not open this position." : label("Could not open this position. Refresh the market and try again.", "Não foi possível abrir a posição. Atualize o mercado e tente novamente.", "无法开立仓位，请刷新市场后重试。"));
    } finally { setPending(false); }
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => !pending && onClose()}>
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.65)", justifyContent: width < 600 ? "flex-end" : "center", alignItems: "center", padding: width < 600 ? 0 : 24 }}>
        <Pressable accessibilityLabel={label("Close trade ticket", "Fechar ordem simulada", "关闭模拟订单")} onPress={() => !pending && onClose()} style={{ position: "absolute", inset: 0 } as any} />
        <ScrollView accessibilityViewIsModal keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 28 }} style={{ width: "100%", maxWidth: 440, maxHeight: height * 0.94, flexGrow: 0, backgroundColor: C.CARD, borderRadius: 8, borderWidth: 1, borderColor: C.BORDER }}>
          <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 28 }}>
            <Text style={{ fontFamily: "DMSans_700Bold", fontSize: 10, letterSpacing: 2, color: C.TEXT_SUB }}>{label("SIMULATION ORDER", "ORDEM SIMULADA", "模拟订单")}</Text>
            <Pressable accessibilityRole="button" accessibilityLabel={label("Close", "Fechar", "关闭")} disabled={pending} onPress={onClose} style={{ minWidth: 44, minHeight: 44, alignItems: "flex-end", justifyContent: "center" }}><Text style={{ fontSize: 25, color: C.TEXT_SUB }}>×</Text></Pressable>
          </View>
          {complete ? (
            <>
              <Text style={{ fontSize: 38, fontFamily: Platform.OS === "android" ? "serif" : "Georgia", color: C.TEXT, marginBottom: 16 }}>{label("You’re in.", "Posição aberta.", "仓位已开立。")}</Text>
              <Text style={{ color: C.TEXT_SUB, fontFamily: "DMSans_400Regular", lineHeight: 24, marginBottom: 24 }}>{label("Your position is now in your portfolio.", "Sua posição está na carteira.", "您的仓位已加入投资组合。")}</Text>
              <Pressable accessibilityRole="button" onPress={() => { onClose(); router.push("/(tabs)/portfolio"); }} style={{ backgroundColor: C.TEXT, padding: 16, alignItems: "center", borderRadius: 4 }}><Text style={{ color: C.CARD, fontFamily: "DMSans_700Bold" }}>{label("View portfolio →", "Ver carteira →", "查看投资组合 →")}</Text></Pressable>
            </>
          ) : (
            <>
              <Text style={{ color: C.TEXT, fontFamily: Platform.OS === "android" ? "serif" : "Georgia", fontSize: 25, lineHeight: 33, marginBottom: 24 }}>{marketTitle(market, language)}</Text>
              <View style={{ flexDirection: "row", gap: 10, marginBottom: 24 }}>
                {market.scenarios.slice(0, 2).map((s, index) => (
                  <Pressable accessibilityRole="button" accessibilityState={{ selected: s.id === outcomeId }} key={s.id} onPress={() => setOutcomeId(s.id)} style={{ flex: 1, minWidth: 0, padding: 15, borderRadius: 4, borderWidth: 1, borderColor: s.id === outcomeId ? choices[index].color : C.BORDER, backgroundColor: s.id === outcomeId ? choices[index].color + "12" : C.CARD }}>
                    {choices[index].logo && <View style={{ marginBottom: 8 }}><OutcomeIdentity visual={choices[index]} size={28} /></View>}
                    <Text numberOfLines={1} style={{ fontFamily: "DMSans_500Medium", color: C.TEXT, marginBottom: 7 }}>{outcomeTitle(s, language)}</Text>
                    <Text style={{ color: choices[index].color, fontFamily: "DMSans_700Bold", fontSize: 22 }}>{probabilityLabel(s.probability, language)}%</Text>
                  </Pressable>
                ))}
              </View>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 9 }}>
                <Text style={{ color: C.TEXT_SUB, fontFamily: "DMSans_500Medium", fontSize: 12 }}>{label("Your stake", "Seu valor", "投注金额")}</Text>
                {account && <Text style={{ color: C.TEXT_MID, fontSize: 12 }}>{label("Available", "Disponível", "可用")} ${Number(account.balance).toLocaleString(localeFor(language))}</Text>}
              </View>
              <View style={{ flexDirection: "row", alignItems: "center", borderBottomWidth: 1, borderBottomColor: C.TEXT, marginBottom: 12 }}>
                <Text style={{ color: C.TEXT_MID, fontSize: 28 }}>$</Text>
                <TextInput accessibilityLabel={label("Simulation stake", "Valor simulado", "模拟金额")} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" selectTextOnFocus style={{ flex: 1, minWidth: 0, color: C.TEXT, fontSize: 36, fontFamily: "DMSans_500Medium", padding: 12 }} />
              </View>
              <View style={{ flexDirection: "row", gap: 8, marginBottom: 28 }}>{[10, 50, 100, 500].map(value => <Pressable key={value} accessibilityRole="button" onPress={() => setAmount(String(value))} style={{ flex: 1, minHeight: 40, borderWidth: 1, borderColor: C.BORDER, justifyContent: "center", alignItems: "center", borderRadius: 3 }}><Text style={{ color: C.TEXT_SUB, fontFamily: "DMSans_500Medium", fontSize: 12 }}>${value}</Text></Pressable>)}</View>
              <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 22 }}><Text style={{ color: C.TEXT_SUB, fontFamily: "DMSans_400Regular", fontSize: 13 }}>{label("Return if correct", "Retorno se acertar", "预测正确的回报")}</Text><Text style={{ color: C.GREEN, fontFamily: "DMSans_700Bold", fontSize: 18 }}>{usd(valid ? stake * multiplier : 0, false, language)}</Text></View>
              {!!error && <Text accessibilityRole="alert" style={{ color: C.RED, lineHeight: 21, marginBottom: 14 }}>{error}</Text>}
              {isAuthenticated && !valid && <Text style={{ color: C.RED, fontSize: 12, marginBottom: 14 }}>{label("Choose $1–$2,000, within your available balance.", "Escolha $1–$2.000, dentro do saldo disponível.", "请输入 1–2,000 美元，且不超过可用余额。")}</Text>}
              <BrandButton disabled={isAuthenticated && !valid} loading={pending} onPress={submit}>
                {isAuthenticated ? label("Open position →", "Abrir posição →", "开立仓位 →") : label("Create a free account →", "Criar conta gratuita →", "免费注册 →")}
              </BrandButton>
              <Text style={{ color: C.TEXT_MID, fontFamily: "DMSans_400Regular", fontSize: 11, textAlign: "center", lineHeight: 18, marginTop: 14 }}>{label("Virtual funds only. Returns include a 2% simulation fee.", "Somente saldo virtual. Retorno inclui taxa simulada de 2%.", "仅使用虚拟资金。回报包含 2% 的模拟费用。")}</Text>
            </>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}
