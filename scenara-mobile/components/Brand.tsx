import { ReactNode, useId } from "react";
import { ActivityIndicator, Pressable, StyleProp, Text, ViewStyle } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Defs, LinearGradient as SvgGradient, Path, Stop } from "react-native-svg";
import { C } from "@/src/theme";

export function BrandMark({ size = 38 }: { size?: number }) {
  const id = "brand" + useId().replace(/:/g, "");
  return <Svg width={size} height={size * 1.15} viewBox="0 0 40 48">
    <Defs><SvgGradient id={id} x1="0" y1="0" x2="1" y2="0"><Stop offset="0" stopColor={C.BLUE} /><Stop offset="0.5" stopColor={C.PURPLE} /><Stop offset="1" stopColor={C.PINK} /></SvgGradient></Defs>
    <Path d="M4 4 L20 36 L36 4" stroke={"url(#" + id + ")"} strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M8 10 L20 30 L32 10" stroke={"url(#" + id + ")"} strokeWidth="3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
    <Path d="M12 16 L20 28 L28 16" stroke={"url(#" + id + ")"} strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" />
  </Svg>;
}

export function BrandButton({ children, onPress, disabled = false, loading = false, style }: {
  children: ReactNode; onPress(): void; disabled?: boolean; loading?: boolean; style?: StyleProp<ViewStyle>;
}) {
  return <Pressable accessibilityRole="button" disabled={disabled || loading} onPress={onPress} style={[{ borderRadius: 5, overflow: "hidden", opacity: disabled || loading ? 0.5 : 1 }, style]}>
    <LinearGradient colors={[C.BLUE, C.PURPLE, C.PINK]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ minHeight: 46, paddingHorizontal: 20, paddingVertical: 14, alignItems: "center", justifyContent: "center" }}>
      {loading ? <ActivityIndicator color="white" /> : <Text style={{ color: "white", fontFamily: "DMSans_700Bold", fontSize: 12 }}>{children}</Text>}
    </LinearGradient>
  </Pressable>;
}
