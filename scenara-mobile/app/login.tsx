import { AuthShell } from "@/components/AuthShell";
import { useState, useRef, useEffect } from "react";
import {
  View, Text, TextInput, TouchableOpacity,
  StatusBar, KeyboardAvoidingView, Platform,
  ScrollView, ActivityIndicator, useWindowDimensions,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import Svg, { Path, Defs, LinearGradient as SvgGrad, Stop, Circle } from "react-native-svg";
import { router, useLocalSearchParams } from "expo-router";
import {
  useFonts, DMSans_400Regular, DMSans_500Medium, DMSans_700Bold,
} from "@expo-google-fonts/dm-sans";

import { useTrading } from "@/src/session/TradingContext";
import { useLanguage } from "@/src/i18n";

const IS_WEB   = Platform.OS === "web";
const BG       = "#08090C";
const CARD     = "#0D1117";
const SURFACE  = "#111620";
const BLUE     = "#4F8EF7";
const PURPLE   = "#7C5CFC";
const PINK     = "#F050AE";
const TEXT     = "#F1F5F9";
const TEXT_MID = "#64748B";
const TEXT_SUB = "#94A3B8";
const BORDER   = "rgba(255,255,255,0.08)";
const BORDER_P = "rgba(124,92,252,0.25)";
const RED      = "#EF4444";

function EyeIcon({ visible }: { visible: boolean }) {
  return visible ? (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" stroke={TEXT_MID} strokeWidth={1.8} />
      <Circle cx="12" cy="12" r="3" stroke={TEXT_MID} strokeWidth={1.8} />
    </Svg>
  ) : (
    <Svg width={18} height={18} viewBox="0 0 24 24" fill="none">
      <Path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" stroke={TEXT_MID} strokeWidth={1.8} strokeLinecap="round" />
      <Path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" stroke={TEXT_MID} strokeWidth={1.8} strokeLinecap="round" />
      <Path d="M1 1l22 22" stroke={TEXT_MID} strokeWidth={1.8} strokeLinecap="round" />
    </Svg>
  );
}

function ScenaraLogo({ size = 52 }: { size?: number }) {
  return (
    <Svg width={size} height={size * 1.15} viewBox="0 0 40 48">
      <Defs>
        <SvgGrad id="lg2" x1="0" y1="0" x2="1" y2="0">
          <Stop offset="0" stopColor={BLUE} />
          <Stop offset="0.5" stopColor={PURPLE} />
          <Stop offset="1" stopColor={PINK} />
        </SvgGrad>
      </Defs>
      <Path d="M4 4 L20 36 L36 4" stroke="url(#lg2)" strokeWidth="4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <Path d="M8 10 L20 30 L32 10" stroke="url(#lg2)" strokeWidth="3.5" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
      <Path d="M12 16 L20 28 L28 16" stroke="url(#lg2)" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.4" />
    </Svg>
  );
}

export default function LoginScreen() {
  "use no memo"; // opt out of React Compiler — formContent memoization breaks nav handlers
  const { width: winW } = useWindowDimensions();
  const isWide = winW >= 700;
  const { login } = useTrading();
  const { language, t } = useLanguage();
  const { reset } = useLocalSearchParams<{ reset?: string }>();
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [success, setSuccess]   = useState("");
  const [loading, setLoading]   = useState(false);
  const [showPass, setShowPass] = useState(false);
  const [focused, setFocused]   = useState<string | null>(null);
  const passRef = useRef<TextInput>(null);

  // Show success banner when arriving from a completed password reset.
  useEffect(() => {
    if (reset === "1") {
      setSuccess(
        language === "pt" ? "Senha redefinida! Entre com a nova senha." :
        language === "zh" ? "密码已重置！请使用新密码登录。" :
        "Password reset! Sign in with your new password."
      );
    }
  }, [reset, language]);

  const [fontsLoaded] = useFonts({ DMSans_400Regular, DMSans_500Medium, DMSans_700Bold });
  if (!fontsLoaded) return null;

  const isPt = language === "pt";
  const isZh = language === "zh";

  const handleLogin = async () => {
    if (!email.trim() || !password.trim()) {
      setError(t.auth.fillCredentials);
      return;
    }
    setLoading(true);
    setError("");
    const result = await login(email.trim().toLowerCase(), password);
    setLoading(false);
    if (!result.ok) {
      setError(result.error ?? t.auth.invalidCredentials);
      return;
    }
    router.replace("/(tabs)");
  };

  const inputStyle = (name: string) => ({
    backgroundColor: SURFACE,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: focused === name ? PURPLE : error ? "rgba(239,68,68,0.25)" : BORDER,
    paddingHorizontal: 16,
    flexDirection: "row" as const,
    alignItems: "center" as const,
    marginBottom: 14,
  });

  // ── FORM CONTENT (shared between web and mobile) ───────────────────────────
  const formContent = (
    <View style={{
      backgroundColor: CARD, borderRadius: 6, padding: 24,
      borderWidth: 1, borderColor: BORDER_P,
      ...(isWide ? { maxWidth: 480, width: "100%", alignSelf: "center" as const } : {}),
      shadowColor: PURPLE, shadowOpacity: 0, shadowRadius: 28, shadowOffset: { width: 0, height: 8 },
    }}>
      {/* Top gradient line */}
      <LinearGradient
        colors={[BLUE, PURPLE, PINK]}
        start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
        style={{ height: 2, borderRadius: 1, marginBottom: 20, marginHorizontal: -24, marginTop: -24, borderTopLeftRadius: 22, borderTopRightRadius: 22 }}
      />

      <Text style={{ color: TEXT, fontSize: 34, fontFamily: "Georgia", marginBottom: 4 }}>
        {t.auth.signInBtn}
      </Text>
      <Text style={{ color: TEXT_MID, fontSize: 13, fontFamily: "DMSans_400Regular", marginBottom: 22 }}>
        {t.auth.accessAccount}
      </Text>

      {/* Success (password reset) */}
      {!!success && (
        <View style={{ backgroundColor: "rgba(34,197,94,0.08)", borderWidth: 1, borderColor: "rgba(34,197,94,0.2)", borderRadius: 10, padding: 12, marginBottom: 16, flexDirection: "row", gap: 8, alignItems: "center" }}>
          <Text style={{ fontSize: 14 }}>✅</Text>
          <Text style={{ color: "#22C55E", fontFamily: "DMSans_500Medium", fontSize: 13, flex: 1 }}>{success}</Text>
        </View>
      )}
      {/* Error */}
      {!!error && (
        <View style={{ backgroundColor: "rgba(239,68,68,0.08)", borderWidth: 1, borderColor: "rgba(239,68,68,0.2)", borderRadius: 10, padding: 12, marginBottom: 16, flexDirection: "row", gap: 8, alignItems: "center" }}>
          <Text style={{ fontSize: 14 }}>⚠️</Text>
          <Text style={{ color: RED, fontFamily: "DMSans_500Medium", fontSize: 13, flex: 1 }}>{error}</Text>
        </View>
      )}

      {/* Email */}
      <Text style={{ color: TEXT_SUB, fontSize: 11, fontFamily: "DMSans_700Bold", letterSpacing: 0.8, marginBottom: 7 }}>
        {t.auth.email}
      </Text>
      <View style={inputStyle("email")}>
        <TextInput
          id="email"
          autoComplete="email"
          value={email} onChangeText={v => { setEmail(v); setError(""); }}
          placeholder="you@example.com" placeholderTextColor={TEXT_MID}
          keyboardType="email-address" autoCapitalize="none" autoCorrect={false}
          returnKeyType="next" onSubmitEditing={() => passRef.current?.focus()}
          onFocus={() => setFocused("email")} onBlur={() => setFocused(null)}
          style={{ color: TEXT, fontSize: 15, fontFamily: "DMSans_400Regular", flex: 1, paddingVertical: 14 }}
        />
      </View>

      {/* Password */}
      <Text style={{ color: TEXT_SUB, fontSize: 11, fontFamily: "DMSans_700Bold", letterSpacing: 0.8, marginBottom: 7 }}>
        {t.auth.password}
      </Text>
      <View style={inputStyle("password")}>
        <TextInput
          id="current-password"
          autoComplete="current-password"
          ref={passRef}
          value={password} onChangeText={v => { setPassword(v); setError(""); }}
          placeholder="••••••••" placeholderTextColor={TEXT_MID}
          secureTextEntry={!showPass} returnKeyType="done"
          onFocus={() => setFocused("password")} onBlur={() => setFocused(null)}
          onSubmitEditing={handleLogin}
          style={{ color: TEXT, fontSize: 15, fontFamily: "DMSans_400Regular", flex: 1, paddingVertical: 14 }}
        />
        <TouchableOpacity onPress={() => setShowPass(v => !v)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
          <EyeIcon visible={showPass} />
        </TouchableOpacity>
      </View>

      {/* Forgot password */}
      <TouchableOpacity
        onPress={() => {
          if (Platform.OS === "web" && typeof window !== "undefined") {
            window.location.href = "/forgot-password";
          } else {
            router.push("/forgot-password" as any);
          }
        }}
        style={{ alignSelf: "flex-end", marginBottom: 22, marginTop: -4 }}
      >
        <Text style={{ color: PURPLE, fontSize: 12, fontFamily: "DMSans_500Medium" }}>
          {t.auth.forgotPassword}
        </Text>
      </TouchableOpacity>

      {/* Submit */}
      <TouchableOpacity onPress={handleLogin} disabled={loading} style={{ borderRadius: 5, overflow: "hidden", marginBottom: 16 }}>
        <LinearGradient
          colors={loading ? ["#111", "#111"] : [BLUE, PURPLE, PINK]}
          start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
          style={{ paddingVertical: 16, alignItems: "center", flexDirection: "row", justifyContent: "center", gap: 8 }}
        >
          {loading
            ? <ActivityIndicator color="white" />
            : <>
                <Text style={{ color: "white", fontFamily: "DMSans_700Bold", fontSize: 15 }}>
                  {t.auth.signInBtn}
                </Text>
                <Text style={{ color: "rgba(255,255,255,0.7)", fontSize: 14 }}>→</Text>
              </>
          }
        </LinearGradient>
      </TouchableOpacity>

      {/* Divider */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <View style={{ flex: 1, height: 1, backgroundColor: BORDER }} />
        <Text style={{ color: TEXT_MID, fontSize: 11 }}>{t.auth.or}</Text>
        <View style={{ flex: 1, height: 1, backgroundColor: BORDER }} />
      </View>

      {/* Sign up link */}
      <TouchableOpacity
        onPress={() => router.push("/register")}
        style={{ alignItems: "center", paddingVertical: 12, borderRadius: 5, borderWidth: 1, borderColor: BORDER }}
      >
        <Text style={{ color: TEXT_SUB, fontSize: 14, fontFamily: "DMSans_400Regular" }}>
          {t.auth.noAccount}{" "}
          <Text style={{ color: PURPLE, fontFamily: "DMSans_700Bold" }}>
            {t.auth.createFree}
          </Text>
        </Text>
      </TouchableOpacity>
    </View>
  );

  // ── DESKTOP / WEB LAYOUT ──────────────────────────────────────────────────
  return <AuthShell>{formContent}</AuthShell>;
}
