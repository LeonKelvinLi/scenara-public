import { Pressable, Text, View } from "react-native";
import { Market, outcomeTitle, probabilityLabel, simulationMultiplier } from "@/src/market";
import { OutcomeVisual } from "@/src/outcomeVisuals";
import { localeFor, pointChange } from "@/src/locale";
import { C } from "@/src/theme";
import { OutcomeIdentity } from "./OutcomeIdentity";

export function MarketOutcomeRows({ market, visuals, language, wide, changeDay, selectedId, canTrade, onSelect, onPredict }: {
  market: Market; visuals: OutcomeVisual[]; language: string; wide: boolean; changeDay?: number | null;
  selectedId?: number; canTrade: boolean; onSelect(id: number): void; onPredict(id: number): void;
}) {
  const copy = (en: string, pt: string, zh: string) => language === "pt" ? pt : language === "zh" ? zh : en;
  return <View style={{ marginTop: 20 }}>
    <View style={{ flexDirection: "row", paddingBottom: 8, alignItems: "center", justifyContent: "space-between" }}><Text style={{ color: C.TEXT, fontFamily: "DMSans_500Medium", fontSize: 15 }}>{copy("Choose your outcome", "Escolha seu resultado", "选择预测结果")}</Text><Text style={{ color: C.TEXT_MID, fontSize: 10 }}>{copy("SIMULATED", "SIMULADO", "模拟")}</Text></View>
    {market.scenarios.map((outcome, index) => {
      const visual = visuals[index], change = changeDay == null ? null : changeDay * (index === 0 ? 1 : -1);
      return <View key={outcome.id} style={{ flexDirection: "row", alignItems: "center", gap: wide ? 18 : 10, borderTopWidth: 1, borderTopColor: C.BORDER, paddingVertical: 16 }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${copy("Inspect", "Ver resultado", "查看结果")} ${outcomeTitle(outcome, language)}`} accessibilityState={{ selected: selectedId === outcome.id }} onPress={() => onSelect(outcome.id)} style={{ flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center", gap: 10 }}>
          <OutcomeIdentity visual={visual} size={wide ? 38 : 28} />
          <Text numberOfLines={2} style={{ flex: 1, color: C.TEXT, fontFamily: "DMSans_500Medium", fontSize: wide ? 15 : 12 }}>{outcomeTitle(outcome, language)}</Text>
        </Pressable>
        <View style={{ alignItems: "flex-end" }}><Text style={{ color: visual.color, fontFamily: "DMSans_700Bold", fontSize: wide ? 28 : 21 }}>{probabilityLabel(outcome.probability, language)}%</Text>{wide && change != null && <Text style={{ color: change >= 0 ? C.GREEN : C.RED, fontSize: 10 }}>{pointChange(change, language)} · 24h</Text>}</View>
        {wide && <View style={{ minWidth: 52, alignItems: "flex-end" }}><Text style={{ color: C.TEXT_SUB, fontFamily: "DMSans_500Medium", fontSize: 14 }}>{simulationMultiplier(outcome.probability).toLocaleString(localeFor(language), { minimumFractionDigits: 2, maximumFractionDigits: 2 })}×</Text><Text style={{ color: C.TEXT_MID, fontSize: 9 }}>{copy("if correct", "se acertar", "预测正确")}</Text></View>}
        <Pressable accessibilityRole="button" accessibilityLabel={`${copy("Predict", "Prever", "预测")} ${outcomeTitle(outcome, language)}`} disabled={!canTrade} onPress={() => onPredict(outcome.id)} style={{ opacity: canTrade ? 1 : .4, minHeight: 44, minWidth: wide ? 112 : 66, paddingHorizontal: wide ? 16 : 10, alignItems: "center", justifyContent: "center", borderRadius: 5, borderWidth: 1, borderColor: visual.color + "70", backgroundColor: visual.color + "1c" }}><Text style={{ color: visual.color, fontFamily: "DMSans_700Bold", fontSize: 12 }}>{copy("Predict", "Prever", "预测")} ↗</Text></Pressable>
      </View>;
    })}
  </View>;
}
