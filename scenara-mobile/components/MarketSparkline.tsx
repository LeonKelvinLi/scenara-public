import { useId, useState } from "react";
import { View } from "react-native";
import Svg, { Defs, LinearGradient, Path, Stop } from "react-native-svg";
import { C } from "@/src/theme";

export type SparkPoint = { probability: number; recorded_at: string };

export function MarketSparkline({ points = [], width: givenWidth, height = 32, color = C.BLUE, language = "en" }: { points?: SparkPoint[]; width?: number; height?: number; color?: string; language?: string }) {
  const [measured, setMeasured] = useState(200);
  const id = "spark" + useId().replace(/:/g, "");
  const width = givenWidth ?? measured;
  const valid = points.filter(p => Number.isFinite(p.probability) && Number.isFinite(new Date(p.recorded_at).getTime()));
  if (valid.length < 2) return null;
  const low = Math.min(...valid.map(p => p.probability));
  const high = Math.max(...valid.map(p => p.probability));
  const span = Math.max(high - low, 2);
  const start = new Date(valid[0].recorded_at).getTime();
  const time = Math.max(1, new Date(valid[valid.length - 1].recorded_at).getTime() - start);
  const path = valid.map((p, i) => `${i ? "L" : "M"} ${((new Date(p.recorded_at).getTime() - start) / time * (width - 4) + 2).toFixed(1)} ${(height - 4 - ((p.probability - (low + high - span) / 2) / span) * (height - 8)).toFixed(1)}`).join(" ");
  return <View accessibilityLabel={language === "pt" ? "Tendência real de preços da Polymarket em 24 horas" : language === "zh" ? "Polymarket 24小时真实价格走势" : "Actual 24-hour Polymarket price trend"} onLayout={event => setMeasured(Math.max(20, event.nativeEvent.layout.width))} style={{ width: givenWidth ?? "100%", height }}><Svg width={width} height={height}><Defs><LinearGradient id={id} x1="0" y1="0" x2="0" y2="1"><Stop offset="0" stopColor={color} stopOpacity={0.18} /><Stop offset="1" stopColor={color} stopOpacity={0} /></LinearGradient></Defs><Path d={`${path} L ${width - 2} ${height} L 2 ${height} Z`} fill={`url(#${id})`} /><Path d={path} fill="none" stroke={color} strokeWidth={1.6} /></Svg></View>;
}
