/**
 * components/SearchBar.tsx — Polymarket-style search with Browse + Topics panels
 *
 * Overlay strategy (fixes the old "bleed-through / clipped / misaligned" bugs):
 *   • The dropdown is rendered in a dedicated top-level layer, never as an
 *     in-flow absolute child that ancestor `overflow` could clip.
 *       – Web:    position:fixed backdrop + position:fixed panel anchored to the
 *                 measured input rect, with a single, high z-index system so no
 *                 market card / chart can ever sit above it.
 *       – Mobile: a native <Modal> (its own window) renders above ALL siblings,
 *                 so there are no z-index wars at all.
 *   • On web the focused input and the panel form ONE connected rounded
 *     container (square inner corners + a subtle divider seam) — the
 *     Polymarket look — instead of two detached boxes.
 *   • The component caps and centers its own width, so it no longer stretches
 *     edge-to-edge on desktop.
 *
 * States:
 *   • Idle:                  plain input, collapsed
 *   • Focused + empty query: Browse pills + Topics grid
 *   • Focused + ≥2 chars:    debounced API search results
 */
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Dimensions,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableWithoutFeedback,
  View,
  ViewStyle,
} from "react-native";
import Svg, { Circle, Line } from "react-native-svg";
import { useRouter } from "expo-router";
import { api } from "@/src/api/client";
import { useLanguage } from "@/src/i18n";
import { C } from "@/src/theme";
import { filterMarkets } from "@/src/utils/search";

const DEBOUNCE_MS   = 220;
const MIN_QUERY_LEN = 2;

// ── Layering system ────────────────────────────────────────────────────────
// One explicit z-index scale instead of scattered magic numbers. The panel
// must beat every market card, chart and category tab on the page.
const Z = {
  WRAP:     50,    // the input wrapper, raised above page content while focused
  BACKDROP: 9000,  // full-screen dim/blur behind the panel
  INPUT:    9002,  // focused input sits flush ON TOP of the panel seam
  PANEL:    9001,  // the dropdown panel itself
} as const;

// Width the dropdown / input cap out at on desktop (Polymarket-ish).
const MAX_WIDTH = 920;
// Subtle focus accent shared by the input border and the panel border so the
// two pieces line up perfectly with no doubled / mismatched edges.
const FOCUS_BORDER = "rgba(124,92,252,0.45)";
const DIVIDER      = "rgba(255,255,255,0.07)";

// ── Category definitions (no emojis — text codes only) ────────────────────
const CATEGORIES: {
  id: string; label_en: string; label_pt: string; label_zh: string;
  icon: string; color: string;
}[] = [
  { id: "brazil",        label_en: "Brazil",        label_pt: "Brasil",         label_zh: "巴西", icon: "BR",  color: "#22C55E" },
  { id: "politics",      label_en: "Politics",      label_pt: "Política",       label_zh: "政治", icon: "POL", color: "#818CF8" },
  { id: "sports",        label_en: "Sports",        label_pt: "Esportes",       label_zh: "体育", icon: "SPT", color: "#60A5FA" },
  { id: "crypto",        label_en: "Crypto",        label_pt: "Cripto",         label_zh: "加密", icon: "₿",   color: "#F7931A" },
  { id: "economy",       label_en: "Economy",       label_pt: "Economia",       label_zh: "经济", icon: "ECO", color: "#34D399" },
  { id: "geopolitics",   label_en: "World",         label_pt: "Geopolítica",    label_zh: "地缘", icon: "WLD", color: "#FB923C" },
  { id: "entertainment", label_en: "Entertainment", label_pt: "Entretenimento", label_zh: "娱乐", icon: "ENT", color: "#F472B6" },
  { id: "technology",    label_en: "Tech",          label_pt: "Tecnologia",     label_zh: "科技", icon: "TEC", color: "#A78BFA" },
  { id: "science",       label_en: "Science",       label_pt: "Ciência",        label_zh: "科学", icon: "SCI", color: "#86EFAC" },
  { id: "music",         label_en: "Music",         label_pt: "Música",         label_zh: "音乐", icon: "MUS", color: "#C084FC" },
  { id: "tv",            label_en: "TV",            label_pt: "TV",             label_zh: "电视", icon: "TV",  color: "#22D3EE" },
  { id: "weather",       label_en: "Weather",       label_pt: "Clima",          label_zh: "天气", icon: "WTH", color: "#7DD3FC" },
];

const BROWSE_SHORTCUTS = [
  { id: "all",         label_en: "All",      label_pt: "Tudo",     label_zh: "全部", icon: "ALL" },
  { id: "crypto",      label_en: "Crypto",   label_pt: "Cripto",   label_zh: "加密", icon: "₿"   },
  { id: "politics",    label_en: "Politics", label_pt: "Política", label_zh: "政治", icon: "POL" },
  { id: "sports",      label_en: "Sports",   label_pt: "Esportes", label_zh: "体育", icon: "SPT" },
  { id: "economy",     label_en: "Economy",  label_pt: "Economia", label_zh: "经济", icon: "ECO" },
  { id: "geopolitics", label_en: "World",    label_pt: "Mundo",    label_zh: "世界", icon: "WLD" },
];

function catLabel(
  cat: { label_en: string; label_pt: string; label_zh: string },
  lang: string,
): string {
  if (lang === "pt") return cat.label_pt;
  if (lang === "zh") return cat.label_zh;
  return cat.label_en;
}

// ── Types ──────────────────────────────────────────────────────────────────
export type SearchResult = {
  id: number; slug: string; title: string;
  title_pt?: string | null; title_zh?: string | null;
  category: string;
};

function pickTitle(r: SearchResult, lang: string): string {
  if (lang === "zh" && r.title_zh) return r.title_zh;
  if (lang === "pt" && r.title_pt) return r.title_pt;
  return r.title;
}

// ── SVG search icon (no emoji needed) ─────────────────────────────────────
function SearchIcon({ size = 16, color = C.TEXT_MID }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Circle cx="11" cy="11" r="7.5" stroke={color} strokeWidth="2" />
      <Line x1="20" y1="20" x2="16.1" y2="16.1" stroke={color} strokeWidth="2.2" strokeLinecap="round" />
    </Svg>
  );
}

// ── Shared dropdown body (used by both web and mobile Modal) ──────────────
function DropdownBody({
  showBrowse, showResults, results, loading,
  category, language, oneColumn, onShortcut, onResultPress,
}: {
  showBrowse: boolean; showResults: boolean;
  results: SearchResult[]; loading: boolean;
  category?: string; language: string;
  oneColumn: boolean;
  onShortcut(id: string): void;
  onResultPress(r: SearchResult): void;
}) {
  if (showBrowse) {
    return (
      <ScrollView
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
        style={{ maxHeight: 480 }}
        contentContainerStyle={{ paddingBottom: 4 }}
      >
        {/* BROWSE row — wrapping pills */}
        <Text style={S.sectionLabel}>
          {language === "pt" ? "EXPLORAR" : language === "zh" ? "浏览" : "BROWSE"}
        </Text>
        <View style={S.browseRow}>
          {BROWSE_SHORTCUTS.map(s => {
            const isActive = s.id === "all"
              ? (category === "all" || !category)
              : category === s.id;
            return (
              <Pressable
                key={s.id}
                onPress={() => onShortcut(s.id)}
                style={({ pressed, hovered }: any) => [
                  S.browsePill,
                  isActive && S.browsePillActive,
                  hovered && !isActive && S.browsePillHover,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text style={[S.browsePillIcon, isActive && { color: C.PURPLE }]}>
                  {s.icon}
                </Text>
                <Text style={[S.browsePillLabel, isActive && { color: C.TEXT }]}>
                  {catLabel(s, language)}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {/* TOPICS grid — 2-col desktop / 1-col mobile */}
        <Text style={[S.sectionLabel, { marginTop: 16 }]}>
          {language === "pt" ? "CATEGORIAS" : language === "zh" ? "分类" : "TOPICS"}
        </Text>
        <View style={S.topicsGrid}>
          {CATEGORIES.map(cat => {
            const isActive = category === cat.id;
            return (
              <Pressable
                key={cat.id}
                onPress={() => onShortcut(cat.id)}
                style={({ pressed, hovered }: any) => [
                  S.topicCard,
                  { width: oneColumn ? "100%" : "48%" },
                  hovered && !isActive && S.topicCardHover,
                  isActive && {
                    borderColor: `${cat.color}55`,
                    backgroundColor: `${cat.color}18`,
                  },
                  pressed && { opacity: 0.72 },
                ]}
              >
                {/* Colored badge box with 2-3 char text code */}
                <View style={[S.topicIconBox, { backgroundColor: `${cat.color}22` }]}>
                  <Text style={[S.topicIconText, { color: cat.color }]}>{cat.icon}</Text>
                </View>
                <Text
                  style={[S.topicLabel, isActive && { color: cat.color }]}
                  numberOfLines={1}
                >
                  {catLabel(cat, language)}
                </Text>
                {isActive && (
                  <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: cat.color, marginLeft: "auto" as any }} />
                )}
              </Pressable>
            );
          })}
        </View>

        <Text style={S.hint}>
          {language === "pt"
            ? "Ou comece a digitar para buscar…"
            : language === "zh"
            ? "或开始输入进行搜索…"
            : "Or start typing to search…"}
        </Text>
      </ScrollView>
    );
  }

  if (showResults) {
    if (results.length === 0 && !loading) {
      return (
        <View style={{ padding: 24, alignItems: "center", gap: 8 }}>
          <Text style={S.emptyTitle}>
            {language === "pt" ? "Sem resultados" : language === "zh" ? "未找到" : "No results"}
          </Text>
          <Text style={S.emptySubtitle}>
            {language === "pt"
              ? "Tente outros termos ou explore por categoria"
              : language === "zh"
              ? "尝试其他词语或按分类浏览"
              : "Try different terms or browse by category"}
          </Text>
        </View>
      );
    }
    return (
      <ScrollView showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="always" style={{ maxHeight: 420 }}>
        {results.map(r => {
          const meta = CATEGORIES.find(c => c.id === r.category);
          return (
            <Pressable
              key={r.id}
              onPress={() => onResultPress(r)}
              style={({ pressed, hovered }: any) => [
                S.resultRow,
                (pressed || hovered) && { backgroundColor: "rgba(124,92,252,0.09)" },
              ]}
            >
              <View style={[S.resultIconBox, { backgroundColor: `${meta?.color ?? C.PURPLE}18` }]}>
                <Text style={[S.resultIconText, { color: meta?.color ?? C.PURPLE }]}>
                  {meta?.icon ?? "◈"}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={S.resultTitle} numberOfLines={2}>
                  {pickTitle(r, language)}
                </Text>
                <Text style={[S.resultCat, { color: meta?.color ?? C.TEXT_MID }]}>
                  {meta ? catLabel(meta, language).toUpperCase() : r.category.toUpperCase()}
                </Text>
              </View>
              <Text style={{ color: C.TEXT_MID, fontSize: 16, paddingLeft: 8 }}>›</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    );
  }

  return null;
}

// ── Main component ─────────────────────────────────────────────────────────
export function SearchBar({
  style,
  category,
  onCategorySelect,
  onFocusChange,
  localEvents,
}: {
  style?: ViewStyle;
  category?: string;
  onCategorySelect?: (catId: string) => void;
  onFocusChange?: (focused: boolean) => void;
  /** Optional: pass the already-loaded market list for instant client-side search fallback */
  localEvents?: SearchResult[];
}) {
  const router   = useRouter();
  const { language } = useLanguage();
  const [q,       setQ]       = useState("");
  const [focused, setFocused] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);

  // Anchor rect of the input wrapper (viewport coords on web → position:fixed,
  // screen coords on mobile → Modal). Re-measured on focus / scroll / resize so
  // the panel stays glued to the input.
  const wrapRef = useRef<View>(null);
  const [anchor, setAnchor] = useState({ x: 12, y: 0, w: Dimensions.get("window").width - 24 });
  const [winW,   setWinW]   = useState(Dimensions.get("window").width);

  const reqVersion     = useRef(0);
  const debounceRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const blurTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const isWeb     = Platform.OS === "web";
  const oneColumn = winW < 480; // topics collapse to a single column on phones

  // Measure the wrapper so the dropdown lands flush under the input.
  const measureWrap = useCallback(() => {
    wrapRef.current?.measureInWindow((x, y, w, h) => {
      if (!w) return;
      const vw = isWeb && typeof window !== "undefined" ? window.innerWidth : Dimensions.get("window").width;
      // Clamp horizontally so the panel never overflows the viewport.
      let left = x;
      if (left + w > vw - 12) left = Math.max(12, vw - 12 - w);
      setAnchor({ x: left, y: y + h, w });
    });
  }, [isWeb]);

  // Keep the panel anchored while the page scrolls / window resizes (web).
  useEffect(() => {
    if (!isWeb || typeof window === "undefined") return;
    const onChange = () => { setWinW(window.innerWidth); measureWrap(); };
    window.addEventListener("resize", onChange);
    window.addEventListener("scroll", onChange, true);
    return () => {
      window.removeEventListener("resize", onChange);
      window.removeEventListener("scroll", onChange, true);
    };
  }, [isWeb, measureWrap]);

  useEffect(() => { setResults([]); }, [category, language]);

  const runSearch = useCallback(async (query: string) => {
    if (query.length < MIN_QUERY_LEN) { setResults([]); setLoading(false); return; }
    const myVer = ++reqVersion.current;
    setLoading(true);
    try {
      const params: Record<string, string> = { q: query, lang: language };
      if (category && category !== "all") params.category = category;
      const res = await api.get("/events/search", { params });
      if (myVer !== reqVersion.current) return;
      const apiResults: SearchResult[] = (res.data || []).slice(0, 8);
      if (apiResults.length > 0) {
        setResults(apiResults);
      } else if (localEvents && localEvents.length > 0) {
        // API returned nothing — fall back to client-side filter on already-loaded markets
        const filtered = filterMarkets(localEvents, query, category ?? "all");
        setResults(filtered.slice(0, 8));
      } else {
        setResults([]);
      }
    } catch {
      if (myVer !== reqVersion.current) return;
      // API failed — try client-side filter fallback
      if (localEvents && localEvents.length > 0) {
        const filtered = filterMarkets(localEvents, query, category ?? "all");
        setResults(filtered.slice(0, 8));
      } else {
        setResults([]);
      }
    } finally {
      if (myVer === reqVersion.current) setLoading(false);
    }
  }, [category, language, localEvents]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(q.trim()), DEBOUNCE_MS);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [q, runSearch]);

  // ESC closes on web
  useEffect(() => {
    if (!isWeb) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isWeb]);

  const setFocusState = useCallback((v: boolean) => {
    setFocused(v);
    onFocusChange?.(v);
    if (v) measureWrap();
  }, [onFocusChange, measureWrap]);

  const close = () => {
    if (blurTimeoutRef.current) clearTimeout(blurTimeoutRef.current);
    setQ(""); setResults([]); setFocusState(false);
  };

  const handleShortcut = (id: string) => {
    close();
    onCategorySelect?.(id);
  };

  const handleResultPress = (r: SearchResult) => {
    close();
    router.push({ pathname: "/market-detail", params: { eventId: String(r.id) } });
  };

  const showBrowse   = focused && q.trim().length === 0;
  const showResults  = focused && q.trim().length >= MIN_QUERY_LEN;
  const showDropdown = showBrowse || showResults;

  const dropBody = (
    <DropdownBody
      showBrowse={showBrowse}
      showResults={showResults}
      results={results}
      loading={loading}
      category={category}
      language={language}
      oneColumn={oneColumn}
      onShortcut={handleShortcut}
      onResultPress={handleResultPress}
    />
  );

  // Panel width tracks the input width but is capped for desktop.
  const panelWidth = Math.min(anchor.w, MAX_WIDTH);

  return (
    <View
      ref={wrapRef}
      style={[
        S.root,
        // While the panel is open, lift the wrapper above page content so the
        // (focused) input renders flush ON TOP of the panel seam.
        isWeb ? { position: "relative" as any, zIndex: showDropdown ? Z.INPUT : Z.WRAP } : null,
        style,
      ]}
      onLayout={() => { if (focused) measureWrap(); }}
    >
      {/* ── Input row ─────────────────────────────────────────────────── */}
      <View
        style={[
          S.inputWrap,
          focused && S.inputWrapFocused,
          // On web, when the panel is open the input becomes the panel's head:
          // square the bottom corners + drop the bottom border so the seam is a
          // single clean divider shared with the panel below.
          isWeb && showDropdown && S.inputWrapConnected,
        ]}
      >
        <View style={{ marginRight: 8, opacity: focused ? 0.9 : 0.5 }}>
          <SearchIcon size={15} color={focused ? C.PURPLE : C.TEXT_MID} />
        </View>
        <TextInput
          value={q}
          onChangeText={setQ}
          placeholder={
            language === "pt" ? "Buscar mercados…"
            : language === "zh" ? "搜索市场…"
            : "Search markets…"
          }
          placeholderTextColor={C.TEXT_MID}
          // `outline*` keys kill the oversized browser-default focus ring on web.
          style={[S.input, isWeb ? ({ outlineStyle: "none", outlineWidth: 0 } as any) : null]}
          returnKeyType="search"
          onFocus={() => setFocusState(true)}
          onBlur={() => {
            blurTimeoutRef.current = setTimeout(() => setFocusState(false), 160);
          }}
          autoCorrect={false}
          autoCapitalize="none"
        />
        {loading ? (
          <ActivityIndicator size="small" color={C.PURPLE} style={{ marginRight: 12 }} />
        ) : q.length > 0 ? (
          <Pressable onPress={close} hitSlop={8} style={{ marginRight: 10 }}>
            <View style={S.clearBtn}>
              <Text style={S.clearBtnText}>✕</Text>
            </View>
          </Pressable>
        ) : focused ? (
          <Pressable onPress={close} hitSlop={8} style={{ marginRight: 12 }}>
            <Text style={S.cancelText}>
              {language === "pt" ? "Cancelar" : language === "zh" ? "取消" : "Cancel"}
            </Text>
          </Pressable>
        ) : null}
      </View>

      {/* ── Web: fixed backdrop + fixed connected panel ────────────────── */}
      {isWeb && showDropdown && (
        <>
          {/* Backdrop — tapping it closes search. Dark + blur, below the panel. */}
          <Pressable
            onPress={close}
            style={{
              position: "fixed" as any,
              top: 0, left: 0, right: 0, bottom: 0,
              backgroundColor: "rgba(8,9,12,0.62)",
              ...({ backdropFilter: "blur(3px)" } as any),
              zIndex: Z.BACKDROP,
            }}
          />
          {/* Panel — fixed to the measured input rect, can't be clipped. */}
          <View
            style={[
              S.dropdown,
              S.dropdownConnected,
              {
                position: "fixed" as any,
                top: anchor.y,
                left: anchor.x,
                width: panelWidth,
                zIndex: Z.PANEL,
              },
            ]}
          >
            {dropBody}
          </View>
        </>
      )}

      {/* ── Mobile: Modal puts dropdown above every sibling ───────────── */}
      {!isWeb && showDropdown && (
        <Modal
          visible
          transparent
          animationType="fade"
          statusBarTranslucent
          onRequestClose={close}
        >
          {/* Dark scrim — tapping outside closes */}
          <TouchableWithoutFeedback onPress={close}>
            <View style={{ flex: 1, backgroundColor: "rgba(8,9,12,0.82)" }}>
              {/* Swallow touches inside dropdown so they don't close modal */}
              <TouchableWithoutFeedback>
                <KeyboardAvoidingView
                  behavior={Platform.OS === "ios" ? "padding" : undefined}
                  style={[
                    S.dropdown,
                    S.dropdownModal,
                    { top: anchor.y + 6, left: anchor.x, width: anchor.w },
                  ] as any}
                >
                  {/* Mobile close button */}
                  <View style={S.modalHeader}>
                    <Text style={S.modalHeaderTitle}>
                      {language === "pt" ? "Buscar" : language === "zh" ? "搜索" : "Search"}
                    </Text>
                    <Pressable onPress={close} hitSlop={10} style={S.modalCloseBtn}>
                      <Text style={S.modalCloseText}>✕</Text>
                    </Pressable>
                  </View>
                  {dropBody}
                </KeyboardAvoidingView>
              </TouchableWithoutFeedback>
            </View>
          </TouchableWithoutFeedback>
        </Modal>
      )}
    </View>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────
const S = StyleSheet.create({
  // Root — caps + centers the whole control so it doesn't stretch on desktop.
  root: {
    width: "100%",
    maxWidth: MAX_WIDTH,
    alignSelf: "center",
  },

  // Input
  inputWrap: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.045)",
    borderRadius: 5,
    borderWidth: 1,
    borderColor: C.BORDER,
    paddingLeft: 14,
    height: 46,
  },
  inputWrapFocused: {
    borderColor: FOCUS_BORDER,
    backgroundColor: "#0D1117",
    shadowColor: "#7C5CFC",
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  // Web only: input forms the head of the connected panel. It must paint
  // ABOVE the backdrop (and panel) so it stays bright and visibly anchors the
  // dropdown — otherwise the backdrop dims the input and the panel looks like
  // it expands from nowhere.
  inputWrapConnected: {
    position: "relative",
    zIndex: Z.INPUT,
    borderBottomLeftRadius: 0,
    borderBottomRightRadius: 0,
    borderBottomWidth: 0,
    // Cancel the glow on the connected edge so the seam reads clean.
    shadowOpacity: 0,
  },
  input: {
    flex: 1,
    color: C.TEXT,
    fontFamily: "DMSans_500Medium",
    fontSize: 14,
    height: "100%",
    paddingVertical: 0,
    paddingRight: 6,
  },
  clearBtn: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: "rgba(255,255,255,0.12)",
    alignItems: "center", justifyContent: "center",
  },
  clearBtnText: {
    color: C.TEXT_MID, fontSize: 9, fontFamily: "DMSans_700Bold",
    lineHeight: 14,
  },
  cancelText: {
    color: C.TEXT_MID, fontSize: 12, fontFamily: "DMSans_500Medium",
  },

  // Dropdown shell (shared base)
  dropdown: {
    backgroundColor: "#0D1117",
    borderRadius: 22,
    borderWidth: 1,
    borderColor: FOCUS_BORDER,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.6,
    shadowRadius: 28,
    shadowOffset: { width: 0, height: 14 },
    elevation: 24,
  },
  // Web: connected to the input above — square the top, divider seam on top.
  dropdownConnected: {
    borderTopLeftRadius: 0,
    borderTopRightRadius: 0,
    borderTopColor: DIVIDER,
  },
  // Mobile: standalone rounded panel inside the Modal.
  dropdownModal: {
    position: "absolute",
    maxHeight: 560,
  },

  // Mobile header (with close button)
  modalHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 14,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: DIVIDER,
  },
  modalHeaderTitle: {
    color: C.TEXT,
    fontFamily: "DMSans_700Bold",
    fontSize: 14,
  },
  modalCloseBtn: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: "rgba(255,255,255,0.08)",
    alignItems: "center", justifyContent: "center",
  },
  modalCloseText: {
    color: C.TEXT_SUB, fontSize: 11, fontFamily: "DMSans_700Bold",
  },

  // Section labels (BROWSE / TOPICS)
  sectionLabel: {
    color: C.TEXT_MID,
    fontSize: 9,
    fontFamily: "DMSans_700Bold",
    letterSpacing: 1.8,
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 10,
  },

  // Browse pills — wrapping row
  browseRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    paddingHorizontal: 16,
    gap: 8,
  },
  browsePill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 13,
    paddingVertical: 8,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.09)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  browsePillHover: {
    borderColor: "rgba(255,255,255,0.18)",
    backgroundColor: "rgba(255,255,255,0.07)",
  },
  browsePillActive: {
    borderColor: "rgba(124,92,252,0.5)",
    backgroundColor: "rgba(124,92,252,0.14)",
  },
  browsePillIcon: {
    color: C.TEXT_MID,
    fontFamily: "DMSans_700Bold",
    fontSize: 11,
  },
  browsePillLabel: {
    color: C.TEXT_SUB,
    fontFamily: "DMSans_700Bold",
    fontSize: 12,
  },

  // Topics grid
  topicsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    gap: 8,
  },
  topicCard: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: 13,
    padding: 11,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.06)",
  },
  topicCardHover: {
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  topicIconBox: {
    width: 34, height: 34, borderRadius: 9,
    alignItems: "center", justifyContent: "center",
    flexShrink: 0,
  },
  topicIconText: {
    fontSize: 10,
    fontFamily: "DMSans_700Bold",
    letterSpacing: 0.3,
  },
  topicLabel: {
    color: C.TEXT_SUB,
    fontFamily: "DMSans_700Bold",
    fontSize: 12,
    flex: 1,
  },

  // Hint at bottom of browse
  hint: {
    color: C.TEXT_MID,
    fontSize: 11,
    fontFamily: "DMSans_400Regular",
    textAlign: "center",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderTopWidth: 1,
    borderTopColor: DIVIDER,
    marginTop: 14,
  },

  // Search result rows
  resultRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.04)",
  },
  resultIconBox: {
    width: 36, height: 36, borderRadius: 10,
    alignItems: "center", justifyContent: "center",
    flexShrink: 0,
  },
  resultIconText: {
    fontSize: 10,
    fontFamily: "DMSans_700Bold",
  },
  resultTitle: {
    color: C.TEXT,
    fontFamily: "DMSans_500Medium",
    fontSize: 13,
    lineHeight: 18,
  },
  resultCat: {
    fontFamily: "DMSans_700Bold",
    fontSize: 9,
    letterSpacing: 1.2,
    marginTop: 3,
  },

  // Empty state
  emptyTitle: {
    color: C.TEXT_SUB,
    fontFamily: "DMSans_700Bold",
    fontSize: 14,
  },
  emptySubtitle: {
    color: C.TEXT_MID,
    fontFamily: "DMSans_400Regular",
    fontSize: 12,
    textAlign: "center",
  },
});
