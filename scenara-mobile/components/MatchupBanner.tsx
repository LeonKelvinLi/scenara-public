import { Text, View } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { PolymarketData, sourceDate } from "@/src/polymarket";
import { outcomeVisuals } from "@/src/outcomeVisuals";
import { C } from "@/src/theme";
import { OutcomeIdentity } from "./OutcomeIdentity";

export function MatchupBanner({ source, language, compact }: { source: PolymarketData["market"]; language: string; compact: boolean }) {
  const teams = source.event?.teams || [];
  if (teams.length !== 2) return null;
  const visuals = outcomeVisuals(teams.map((team, index) => ({ id: index, title: team.name, probability: 0, status: "open" })), teams);
  const start = source.event?.game_starts_at || source.game_starts_at;
  return <LinearGradient colors={[visuals[0].color + "18", C.BG, visuals[1].color + "18"]} start={{ x: 0, y: .5 }} end={{ x: 1, y: .5 }} style={{ borderRadius: 8, borderWidth: 1, borderColor: C.BORDER, paddingVertical: compact ? 18 : 24, paddingHorizontal: compact ? 12 : 28, marginBottom: 22 }}>
    <View style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", gap: compact ? 12 : 40 }}>
      {teams.map((team, index) => <View key={team.name} style={{ flex: 1, minWidth: 0, alignItems: "center", gap: 10 }}>
        <OutcomeIdentity visual={visuals[index]} size={compact ? 46 : 62} />
        <Text numberOfLines={2} style={{ color: C.TEXT, fontFamily: "DMSans_700Bold", fontSize: compact ? 13 : 18, textAlign: "center" }}>{team.name}</Text>
      </View>).flatMap((team, index) => index === 0 ? [team, <View key="schedule" style={{ alignItems: "center", maxWidth: compact ? 100 : 180, gap: 7 }}>
        <Text style={{ color: C.TEXT_MID, letterSpacing: 2, fontFamily: "DMSans_700Bold", fontSize: 10 }}>{source.event?.sport?.name || "VS"}</Text>
        <Text style={{ color: C.TEXT_SUB, textAlign: "center", fontFamily: "DMSans_500Medium", fontSize: compact ? 11 : 13 }}>{start ? sourceDate(start, language, true) : "VS"}</Text>
      </View>] : [team])}
    </View>
  </LinearGradient>;
}
