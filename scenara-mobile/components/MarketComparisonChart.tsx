import { useEffect, useId, useMemo, useState } from "react";
import { PanResponder, Platform, Text, View } from "react-native";
import Svg, { Circle, G, Line, Path, Text as SvgText } from "react-native-svg";
import { C } from "@/src/theme";
import { probabilityLabel } from "@/src/market";
import { localeFor } from "@/src/locale";

export type ComparisonSeries = {
  id: number; title: string; color: string;
  points: { probability: number; recorded_at: string }[];
};
type Sample = { probability: number; time: number };

function stamp(time: number, language: string, full = false) {
  return new Date(time).toLocaleString(language === "pt" ? "pt-BR" : language === "zh" ? "zh-CN" : "en-US", full
    ? { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }
    : { month: "short", day: "numeric" });
}

export function MarketComparisonChart({ series, width, height = 300, language = "en" }: {
  series: ComparisonSeries[]; width: number; height?: number; language?: string;
}) {
  const id = useId();
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  useEffect(() => setHoverTime(null), [series, width]);
  const narrow = width < 500;
  const left = 32, top = 18, bottom = height - 30, right = width - (narrow ? 57 : 110);
  const rows = useMemo(() => series.map(row => ({ ...row, samples: row.points
    .map(point => ({ probability: point.probability, time: new Date(point.recorded_at).getTime() }))
    .filter(point => Number.isFinite(point.time) && Number.isFinite(point.probability) && point.probability >= 0 && point.probability <= 100)
    .sort((a, b) => a.time - b.time) })).filter(row => row.samples.length >= 2), [series]);
  const samples = rows.flatMap(row => row.samples);
  const minTime = samples.length ? Math.min(...samples.map(point => point.time)) : 0;
  const maxTime = samples.length ? Math.max(...samples.map(point => point.time)) : 1;
  const low = samples.length ? Math.min(...samples.map(point => point.probability)) : 0;
  const high = samples.length ? Math.max(...samples.map(point => point.probability)) : 100;
  // A common, labelled scale for both outcomes. A 20pp minimum prevents tiny
  // price moves from looking like full-height swings in balanced markets.
  const span = Math.max(20, (high - low) * 1.2), center = (high + low) / 2;
  const yMin = Math.max(0, Math.floor((center - span / 2) / 5) * 5);
  const yMax = Math.min(100, Math.ceil((center + span / 2) / 5) * 5);
  const x = (time: number) => left + (time - minTime) / Math.max(1, maxTime - minTime) * (right - left);
  const y = (probability: number) => bottom - (probability - yMin) / Math.max(1, yMax - yMin) * (bottom - top);
  const ends = rows.map(row => {
    const point = row.samples[row.samples.length - 1];
    return { ...row, point, actualY: y(point.probability), labelY: y(point.probability) };
  }).sort((a, b) => a.actualY - b.actualY);
  for (let i = 0; i < ends.length; i++) ends[i].labelY = Math.max(top + 16, ends[i].actualY, i > 0 ? ends[i - 1].labelY + (narrow ? 30 : 45) : 0);
  for (let i = ends.length - 1; i >= 0; i--) ends[i].labelY = Math.min(bottom - 6, ends[i].labelY, i < ends.length - 1 ? ends[i + 1].labelY - (narrow ? 30 : 45) : bottom);
  const timeTicks = (narrow ? [0, 1] : [0, .5, 1]).map(fraction => minTime + fraction * (maxTime - minTime));
  const values = rows.flatMap(row => {
    const preceding = row.samples.filter(point => hoverTime != null && point.time <= hoverTime);
    const sample = preceding[preceding.length - 1];
    return sample ? [{ ...row, sample }] : [];
  });
  const inspect = (position: number) => {
    if (position < left || position > right) { setHoverTime(null); return; }
    const wanted = minTime + (position - left) / (right - left) * (maxTime - minTime);
    setHoverTime(samples.reduce((nearest, point) => Math.abs(point.time - wanted) < Math.abs(nearest - wanted) ? point.time : nearest, minTime));
  };
  const pan = PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dx) > 6 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
    onPanResponderMove: event => inspect(event.nativeEvent.locationX),
    onPanResponderRelease: () => setHoverTime(null),
    onPanResponderTerminate: () => setHoverTime(null),
  });
  const mouseProps = Platform.OS === "web" ? {
    onMouseMove: (event: any) => inspect(event.clientX - event.currentTarget.getBoundingClientRect().left),
    onMouseLeave: () => setHoverTime(null),
  } : {};
  const path = (points: Sample[]) => points.map((point, i) => `${i ? "L" : "M"} ${x(point.time).toFixed(2)} ${y(point.probability).toFixed(2)}`).join(" ");
  if (!samples.length) return <View style={{ height, alignItems: "center", justifyContent: "center" }}><Text style={{ color: C.TEXT_SUB }}>{language === "pt" ? "Aguardando histórico da fonte" : language === "zh" ? "等待来源历史数据" : "Waiting for source history"}</Text></View>;
  return <View testID="comparison-chart" accessibilityLabel={`${language === "pt" ? "Histórico de probabilidades" : language === "zh" ? "概率历史" : "Polymarket probability history"}: ${rows.map(row => row.title).join(" / ")}`} style={{ position: "relative", width }}>
    <View {...mouseProps} {...(Platform.OS !== "web" ? pan.panHandlers : {})}>
      <Svg width={width} height={height} accessibilityLabel={language === "pt" ? "Os dois resultados usam os mesmos eixos de tempo e probabilidade" : language === "zh" ? "双方结果共用时间和概率坐标轴" : "Both outcome histories share the same time and probability axes"}>
        {[0, .25, .5, .75, 1].map(fraction => {
          const probability = yMin + fraction * (yMax - yMin);
          return <ViewGrid key={fraction} value={probability} y={y(probability)} left={left} right={right} language={language} />;
        })}
        {rows.map(row => <Path key={row.id} testID={`outcome-history-${row.id}`} d={path(row.samples)} stroke={row.color} strokeWidth={2.3} strokeLinecap="round" strokeLinejoin="round" fill="none" />)}
        {ends.map(row => <G key={`${id}-${row.id}`}>
          <Circle cx={x(row.point.time)} cy={row.actualY} r={9} fill={row.color} opacity={.13} />
          <Circle cx={x(row.point.time)} cy={row.actualY} r={3.5} fill={row.color} />
          <Line x1={x(row.point.time) + 5} y1={row.actualY} x2={right + 9} y2={row.labelY - 6} stroke={row.color} strokeWidth={1} opacity={.5} />
          {!narrow && <SvgText x={right + 15} y={row.labelY - 14} fill={row.color} fontSize={11} fontFamily="DMSans_500Medium">{row.title.length > 14 ? row.title.slice(0, 12) + "…" : row.title}</SvgText>}
          <SvgText x={right + (narrow ? 8 : 15)} y={row.labelY + (narrow ? 2 : 8)} fill={row.color} fontSize={narrow ? 15 : 23} fontWeight="700" fontFamily="DMSans_700Bold">{probabilityLabel(row.point.probability, language)}%</SvgText>
        </G>)}
        {hoverTime != null && <Line x1={x(hoverTime)} y1={top} x2={x(hoverTime)} y2={bottom} stroke={C.TEXT_SUB} strokeDasharray="3 4" opacity={.55} />}
        {hoverTime != null && values.map(row => <Circle key={row.id} cx={x(hoverTime)} cy={y(row.sample.probability)} r={4} fill={row.color} stroke={C.BG} strokeWidth={2} />)}
        {timeTicks.map((time, index) => <SvgText key={index} x={x(time)} y={height - 3} textAnchor={index === 0 ? "start" : index === timeTicks.length - 1 ? "end" : "middle"} fill={C.TEXT_MID} fontSize={10} fontFamily="DMSans_400Regular">{maxTime - minTime < 43_200_000 ? new Date(time).toLocaleTimeString(localeFor(language), { hour: "2-digit", minute: "2-digit" }) : stamp(time, language, !narrow && maxTime - minTime < 172_800_000)}</SvgText>)}
      </Svg>
    </View>
    {hoverTime != null && <View pointerEvents="none" style={{ position: "absolute", left: Math.min(Math.max(0, x(hoverTime) - 92), width - 190), top: 0, width: 190, padding: 12, borderRadius: 7, backgroundColor: C.SURFACE, borderWidth: 1, borderColor: C.BORDER_P }}>
      <Text style={{ color: C.TEXT_SUB, fontSize: 10, marginBottom: 8 }}>{stamp(hoverTime, language, true)}</Text>
      {values.map(row => <View key={row.id} style={{ flexDirection: "row", justifyContent: "space-between", gap: 8, marginTop: 4 }}><Text numberOfLines={1} style={{ color: row.color, flex: 1, fontSize: 11 }}>{row.title}</Text><Text style={{ color: row.color, fontFamily: "DMSans_700Bold", fontSize: 12 }}>{probabilityLabel(row.sample.probability, language)}%</Text></View>)}
    </View>}
  </View>;
}

function ViewGrid({ value, y, left, right, language }: { value: number; y: number; left: number; right: number; language: string }) {
  return <>
    <Line x1={left} y1={y} x2={right} y2={y} stroke={C.TEXT_MID} strokeOpacity={.2} strokeDasharray="2 5" />
    <SvgText x={left - 7} y={y + 3} textAnchor="end" fill={C.TEXT_MID} fontSize={9} fontFamily="DMSans_400Regular">{probabilityLabel(value, language)}%</SvgText>
  </>;
}
