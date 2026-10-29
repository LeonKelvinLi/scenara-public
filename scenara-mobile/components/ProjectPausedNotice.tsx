/**
 * components/ProjectPausedNotice.tsx
 *
 * Entry notice: tells anyone opening Scenara that the project has been paused.
 *
 * Shown once per app session (the component mounts once, inside RootLayout),
 * after the language has been chosen so it never stacks on top of
 * LanguageModal — iOS presents one modal at a time, and two overlapping
 * modals leave the second one invisible with the app unresponsive behind it.
 *
 * Dismissible on purpose. The site stays browsable as an archive; the notice
 * sets expectations, it does not lock the door.
 */
import { useEffect, useState } from "react";
import { Modal, View, Text, TouchableOpacity } from "react-native";
import { LinearGradient } from "expo-linear-gradient";

import { useLanguage } from "@/src/i18n";
import { C, GRAD } from "@/src/theme";
import { PROJECT_PAUSED } from "@/src/config/paused";

const LABELS = {
  en: {
    badge: "NOT ACTIVE",
    title: "Scenara is no longer active",
    body:
      "Development stopped in April 2026, and the backend and database have since been shut down. Sign-in, predictions and live market data no longer work.",
    body2:
      "This is a static archive of the interface, not a running platform. There are 0 users.",
    cta: "Continue to the archive →",
  },
  pt: {
    badge: "FORA DO AR",
    title: "O Scenara não está mais ativo",
    body:
      "O desenvolvimento parou em abril de 2026, e desde então o backend e o banco de dados foram desligados. Login, palpites e dados de mercado ao vivo não funcionam mais.",
    body2:
      "Isto é um arquivo estático da interface, não uma plataforma em funcionamento. Há 0 usuários.",
    cta: "Continuar para o arquivo →",
  },
  zh: {
    badge: "已停止运行",
    title: "Scenara 已不再运行",
    body:
      "开发于 2026 年 4 月停止，后端与数据库此后已关闭。登录、预测和实时市场数据均已失效。",
    body2:
      "这里只是界面的静态存档，而非一个运行中的平台。当前用户数为 0。",
    cta: "进入存档 →",
  },
} as const;

export function ProjectPausedNotice() {
  const { language, hasChosenLanguage, isLanguageHydrated } = useLanguage();
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  // Wait for the language choice so this never overlaps LanguageModal.
  useEffect(() => {
    if (!PROJECT_PAUSED || dismissed) return;
    if (isLanguageHydrated && hasChosenLanguage) setVisible(true);
  }, [isLanguageHydrated, hasChosenLanguage, dismissed]);

  if (!PROJECT_PAUSED) return null;

  const t = (LABELS as any)[language] ?? LABELS.en;

  const dismiss = () => {
    setDismissed(true);
    setVisible(false);
  };

  return (
    <Modal
      transparent
      visible={visible}
      animationType="fade"
      statusBarTranslucent
      onRequestClose={dismiss}
    >
      <View style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.78)", alignItems: "center", justifyContent: "center", padding: 24 }}>
        <View style={{ width: "100%", maxWidth: 420, backgroundColor: C.CARD, borderRadius: 8, padding: 28, borderWidth: 1, borderColor: C.BORDER_P }}>
          <LinearGradient colors={GRAD.BRAND} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ height: 2, borderRadius: 1, marginBottom: 22 }} />

          <View style={{ alignSelf: "flex-start", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, backgroundColor: "rgba(239,68,68,0.16)", marginBottom: 14 }}>
            <Text style={{ color: C.RED, fontSize: 10, fontFamily: "DMSans_700Bold", letterSpacing: 1 }}>
              {t.badge}
            </Text>
          </View>

          <Text style={{ color: C.TEXT, fontSize: 22, fontFamily: "DMSans_700Bold", marginBottom: 10 }}>
            {t.title}
          </Text>

          <Text style={{ color: C.TEXT_SUB, fontSize: 14, lineHeight: 21, fontFamily: "DMSans_400Regular", marginBottom: 10 }}>
            {t.body}
          </Text>

          <Text style={{ color: C.TEXT_SUB, fontSize: 14, lineHeight: 21, fontFamily: "DMSans_400Regular", marginBottom: 24 }}>
            {t.body2}
          </Text>

          <TouchableOpacity onPress={dismiss} style={{ borderRadius: 5, overflow: "hidden" }}>
            <LinearGradient colors={GRAD.BRAND} start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }} style={{ paddingVertical: 14, alignItems: "center" }}>
              <Text style={{ color: "white", fontFamily: "DMSans_700Bold", fontSize: 15 }}>
                {t.cta}
              </Text>
            </LinearGradient>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}
