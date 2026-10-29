import { useEffect, useState } from "react";
import { Image, Text, View } from "react-native";
import { OutcomeVisual } from "@/src/outcomeVisuals";

export function OutcomeIdentity({ visual, size = 32 }: { visual: OutcomeVisual; size?: number }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [visual.logo]);
  return <View style={{ width: size, height: size, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: visual.color + "14", flexShrink: 0 }}>
    {visual.logo && !failed ? <Image accessibilityLabel={visual.abbreviation} source={{ uri: visual.logo }} onError={() => setFailed(true)} resizeMode="contain" style={{ width: size * .86, height: size * .86 }} /> : <Text style={{ color: visual.color, fontFamily: "DMSans_700Bold", fontSize: size * (["✓", "×"].includes(visual.abbreviation) ? .5 : .27) }}>{visual.abbreviation}</Text>}
  </View>;
}
