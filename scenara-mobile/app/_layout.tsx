import { useEffect } from "react";
import { View } from "react-native";
import { Stack, router, useSegments } from "expo-router";
import {
  useFonts, DMSans_400Regular, DMSans_500Medium, DMSans_700Bold,
} from "@expo-google-fonts/dm-sans";
import { TradingProvider, useTrading } from "@/src/session/TradingContext";
import { SessionProvider } from "@/src/session/SessionContext";
import { LanguageProvider, useLanguage } from "@/src/i18n";
import { hasSeenOnboarding } from "./onboarding";
import { api } from "@/src/api/client";
import { initSentry } from "@/src/observability/sentry";
import { usePushNotifications } from "@/src/utils/usePushNotifications";
import { ProjectPausedNotice } from "@/components/ProjectPausedNotice";

// Initialize Sentry at module load — before any component renders. This
// way, a render-phase throw in the very first component (like the TDZ
// login bug from earlier) is still captured.
initSentry();

const BG = "#08090C";

/** Mounts the push notification tap-handler hook inside the router context. */
function PushHandler() {
  usePushNotifications();
  return null;
}

function AuthGuard() {
  const { isAuthenticated, isLoadingAuth } = useTrading();
  const { hasChosenLanguage, isLanguageHydrated } = useLanguage();
  const segments = useSegments();

  // Serialize segments to a string so the effect only re-runs when the
  // actual route changes — not on every render (useSegments() returns a
  // new array reference each time, which would otherwise retrigger this).
  const segmentKey = segments.join("/");

  useEffect(() => {
    if (isLoadingAuth || !isLanguageHydrated) return;

    const onLogin      = segments[0] === "login";
    const onRegister   = segments[0] === "register";
    const onOnboarding = segments[0] === "onboarding";
    const onLanguage   = segments[0] === "language-select";

    // If already on language-select screen (old flow), redirect away
    if (hasChosenLanguage && onLanguage) {
      router.replace(isAuthenticated ? (hasSeenOnboarding() ? "/(tabs)" : "/onboarding") : "/(tabs)");
      return;
    }

    // Authenticated users on login/register → redirect to app
    if (isAuthenticated && (onLogin || onRegister)) {
      router.replace(hasSeenOnboarding() ? "/(tabs)" : "/onboarding");
    } else if (isAuthenticated && onOnboarding && hasSeenOnboarding()) {
      router.replace("/(tabs)");
    }
    // Guests are allowed to stay on (tabs) — no redirect to login
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasChosenLanguage, isAuthenticated, isLanguageHydrated, isLoadingAuth, segmentKey]);

  // AuthGuard is now effect-only — no blocking UI. The home tab renders
  // immediately with the live-stats baseline + cached events, and any
  // auth-dependent widgets manage their own loading state. This trades a
  // brief "looks logged out for a beat" flash for a near-instant first
  // paint on cold-start, which is far higher-leverage on free-tier hosting.
  return null;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({ DMSans_400Regular, DMSans_500Medium, DMSans_700Bold });

  // Fire a health ping immediately so the backend wakes up (Render free tier hibernates).
  // Runs unconditionally — we don't wait for fonts before waking the server.
  useEffect(() => {
    api.get("/health", { timeout: 30000 }).catch(() => {});
  }, []);

  // Block the entire navigator until fonts are ready. Since fonts are bundled
  // with the app (not fetched from network), this resolves in < 100 ms and
  // prevents every tab screen from briefly flashing blank on first visit.
  if (!fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: BG }} />;
  }

  return (
    <LanguageProvider>
      <TradingProvider>
        {/* SessionProvider backs the Orryin-era /kyc and /funding routes. They
            are hidden from the tab bar (href: null) but expo-router still
            registers them, so they stay reachable by direct URL on web — and
            without this provider useSession() throws on render and the page
            goes blank. */}
        <SessionProvider>
          <PushHandler />
          <AuthGuard />
          <ProjectPausedNotice />
          <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: BG } }}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="login"          options={{ animation: "fade" }} />
            <Stack.Screen name="register"       options={{ animation: "fade" }} />
            <Stack.Screen name="language-select" options={{ animation: "fade" }} />
            <Stack.Screen name="onboarding"     options={{ animation: "fade" }} />
            <Stack.Screen name="news-detail"    options={{ animation: "slide_from_right" }} />
            <Stack.Screen name="market-detail"  options={{ animation: "slide_from_right" }} />
            <Stack.Screen name="user-profile"   options={{ animation: "slide_from_right" }} />
            <Stack.Screen name="how-it-works"   options={{ animation: "slide_from_right" }} />
            <Stack.Screen name="signal-lab"     options={{ animation: "slide_from_right" }} />
            <Stack.Screen name="daily-challenge" options={{ animation: "slide_from_right" }} />
            <Stack.Screen name="terms"          options={{ animation: "slide_from_right" }} />
            <Stack.Screen name="notifications-settings" options={{ animation: "slide_from_right" }} />
            <Stack.Screen name="forgot-password"        options={{ animation: "slide_from_right" }} />
            <Stack.Screen name="reset-password"         options={{ animation: "slide_from_right" }} />
          </Stack>
        </SessionProvider>
      </TradingProvider>
    </LanguageProvider>
  );
}
