import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Language, useLanguage } from "@/src/i18n";
import { C } from "@/src/theme";

export function LanguageMenu() {
  const { language, setLanguage } = useLanguage();
  const [open, setOpen] = useState(false);
  return <View style={{ position: "relative", zIndex: 30 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={language === "pt" ? "Alterar idioma" : language === "zh" ? "切换语言" : "Change language"} accessibilityState={{ expanded: open }} onPress={() => setOpen(value => !value)} style={{ minWidth: 40, minHeight: 40, alignItems: "center", justifyContent: "center" }}><Text style={{ color: C.TEXT, fontSize: 11, fontFamily: "DMSans_700Bold" }}>{language === "zh" ? "中文" : language.toUpperCase()}⌄</Text></Pressable>
    {open && <View style={{ position: "absolute", right: 0, top: 44, width: 172, padding: 6, borderRadius: 6, borderWidth: 1, borderColor: C.BORDER, backgroundColor: C.CARD }}>{([["en", "English"], ["pt", "Português"], ["zh", "中文"]] as [Language, string][]).map(([value, label]) => <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected: language === value }} onPress={() => { void setLanguage(value); setOpen(false); }} style={{ minHeight: 44, paddingHorizontal: 10, flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}><Text style={{ color: C.TEXT, fontSize: 13 }}>{label}</Text>{language === value && <Text style={{ color: C.PURPLE }}>✓</Text>}</Pressable>)}</View>}
  </View>;
}
