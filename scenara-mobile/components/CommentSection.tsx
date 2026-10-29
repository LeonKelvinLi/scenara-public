import { useState, useEffect, useCallback } from "react";
import {
  View, Text, TouchableOpacity, TextInput,
  ActivityIndicator, KeyboardAvoidingView, Platform,
} from "react-native";
import { api } from "@/src/api/client";
import { useTrading } from "@/src/session/TradingContext";

const CARD     = "#0D1117";
const SURFACE  = "#111620";
const PURPLE   = "#7C5CFC";
const PURPLE_D = "#4A3699";
const TEXT     = "#F1F5F9";
const TEXT_SUB = "#94A3B8";
const TEXT_MID = "#64748B";
const BORDER   = "rgba(255,255,255,0.07)";
const BORDER_P = "rgba(124,92,252,0.2)";
const GREEN    = "#22C55E";
const RED      = "#EF4444";

type Comment = {
  id: number;
  user_id: number;
  body: string;
  body_en?: string | null;
  created_at: string;
  display_name: string | null;
};

function timeAgo(dateStr: string, language: string): string {
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (diff < 60) return language === "pt" ? "agora" : language === "zh" ? "刚刚" : "now";
  if (diff < 3600) return language === "pt" ? `${Math.floor(diff / 60)}m atrás` : language === "zh" ? `${Math.floor(diff / 60)}分钟前` : `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return language === "pt" ? `${Math.floor(diff / 3600)}h atrás` : language === "zh" ? `${Math.floor(diff / 3600)}小时前` : `${Math.floor(diff / 3600)}h ago`;
  return language === "pt" ? `${Math.floor(diff / 86400)}d atrás` : language === "zh" ? `${Math.floor(diff / 86400)}天前` : `${Math.floor(diff / 86400)}d ago`;
}

function initials(name: string | null): string {
  if (!name) return "?";
  return name.split(" ").map(w => w[0]).join("").toUpperCase().slice(0, 2);
}

const AVATAR_COLORS = [PURPLE, "#7C5CFC", "#7C5CFC", "#22C55E", "#F7931A", "#22D3EE"];
function avatarColor(userId: number): string {
  return AVATAR_COLORS[userId % AVATAR_COLORS.length];
}

// â”€â”€ Language-aware comment body + toggle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// When UI language is PT â†’ show PT body, offer "Mostrar tradução (EN)" toggle
// When UI language is EN â†’ show EN body (body_en), offer "Show original (PT)" toggle
function CommentBody({
  body, bodyEn, language,
}: {
  body: string; bodyEn: string; language: string;
}) {
  const [showAlt, setShowAlt] = useState(false);

  // Primary text depends on UI language
  const primaryText = language === "en" ? bodyEn : body;
  const altText     = language === "en" ? body   : bodyEn;
  const altLabel    = language === "en" ? "Show original (PT)" : language === "zh" ? "显示英文翻译" : "Mostrar tradução (EN)";
  const hideLabel   = language === "en" ? "Hide original"      : language === "zh" ? "隐藏翻译" : "Ocultar tradução";
  const altHeader   = language === "en" ? "ORIGINAL (PT)"      : language === "zh" ? "ENGLISH" : "TRADUÇÃO (EN)";

  return (
    <View>
      <Text style={{ color: TEXT_SUB, fontSize: 13, fontFamily: "DMSans_400Regular", lineHeight: 20 }}>
        {primaryText}
      </Text>
      {showAlt && (
        <View style={{
          backgroundColor: "rgba(124,92,252,0.06)",
          borderRadius: 8,
          padding: 10,
          marginTop: 6,
          borderLeftWidth: 2,
          borderLeftColor: "rgba(124,92,252,0.3)",
        }}>
          <Text style={{ color: TEXT_MID, fontSize: 9, fontFamily: "DMSans_700Bold", letterSpacing: 0.8, marginBottom: 4 }}>
            {altHeader}
          </Text>
          <Text style={{ color: TEXT_SUB, fontSize: 13, fontFamily: "DMSans_400Regular", lineHeight: 20, fontStyle: "italic" }}>
            {altText}
          </Text>
        </View>
      )}
      <TouchableOpacity
        onPress={() => setShowAlt(v => !v)}
        style={{ marginTop: 8, alignSelf: "flex-start" }}
      >
        <Text style={{ color: PURPLE_D, fontSize: 11, fontFamily: "DMSans_500Medium" }}>
          {showAlt ? hideLabel : altLabel}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// â”€â”€ Seed comment pool â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
type Props = {
  eventId?: number;
  newsUrl?: string;
  newsTitle?: string;
  language: string;
};

export function CommentSection({ eventId, newsUrl, newsTitle, language }: Props) {
  const { userId } = useTrading();
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState("");

  const fetchComments = useCallback(async () => {
    try {
      setLoading(true);
      let res;
      if (eventId) {
        res = await api.get(`/comments/event/${eventId}`);
      } else if (newsUrl) {
        res = await api.get("/comments/news", { params: { url: newsUrl } });
      }
      setComments(res?.data ?? []);
    } catch {
      setComments([]);
    } finally {
      setLoading(false);
    }
  }, [eventId, newsUrl]);

  useEffect(() => { fetchComments(); }, [fetchComments]);

  const postComment = async () => {
    if (!text.trim()) return;
    if (!userId) { setError(language === "pt" ? "Faça login para comentar" : language === "zh" ? "登录后评论" : "Log in to comment"); return; }
    try {
      setPosting(true); setError("");
      await api.post("/comments/", {
        body: text.trim(),
        event_id: eventId ?? null,
        news_url: newsUrl ?? null,
      });
      setText("");
      await fetchComments();
    } catch {
      setError(language === "pt" ? "Erro ao postar comentário" : language === "zh" ? "发表评论失败" : "Failed to post comment");
    } finally {
      setPosting(false);
    }
  };

  const deleteComment = async (commentId: number) => {
    try {
      await api.delete(`/comments/${commentId}`);
      setComments(prev => prev.filter(c => c.id !== commentId));
    } catch {}
  };

  return (
    <View style={{ marginTop: 8 }}>
      {/* Header */}
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 14 }}>
        <Text style={{ color: PURPLE_D, fontSize: 10, fontFamily: "DMSans_700Bold", letterSpacing: 1.5 }}>
          {(language === "pt" ? "Comentários" : language === "zh" ? "评论" : "Comments").toUpperCase()}
        </Text>
        {comments.length > 0 && (
          <View style={{ paddingHorizontal: 7, paddingVertical: 2, borderRadius: 10, backgroundColor: "rgba(124,92,252,0.12)" }}>
            <Text style={{ color: PURPLE_D, fontSize: 10, fontFamily: "DMSans_700Bold" }}>{comments.length}</Text>
          </View>
        )}
      </View>

      {/* Input */}
      <View style={{ backgroundColor: SURFACE, borderRadius: 5, borderWidth: 1, borderColor: BORDER_P, padding: 12, marginBottom: 14 }}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder={language === "pt" ? "O que você acha?" : language === "zh" ? "你怎么看？" : "What do you think?"}
          placeholderTextColor={TEXT_MID}
          multiline
          style={{ color: TEXT, fontFamily: "DMSans_400Regular", fontSize: 14, minHeight: 60, textAlignVertical: "top" }}
        />
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
          {error ? (
            <Text style={{ color: RED, fontSize: 11, fontFamily: "DMSans_400Regular" }}>{error}</Text>
          ) : (
            <Text style={{ color: TEXT_MID, fontSize: 11 }}>{text.length}/280</Text>
          )}
          <TouchableOpacity
            onPress={postComment}
            disabled={posting || !text.trim()}
            style={{ paddingHorizontal: 16, paddingVertical: 8, borderRadius: 10, backgroundColor: text.trim() ? "rgba(124,92,252,0.15)" : "rgba(255,255,255,0.03)", borderWidth: 1, borderColor: text.trim() ? BORDER_P : BORDER }}
          >
            {posting ? (
              <ActivityIndicator size="small" color={PURPLE} />
            ) : (
              <Text style={{ color: text.trim() ? PURPLE : TEXT_MID, fontFamily: "DMSans_700Bold", fontSize: 12 }}>
                {language === "pt" ? "Publicar" : language === "zh" ? "发布" : "Post"}
              </Text>
            )}
          </TouchableOpacity>
        </View>
      </View>

      {/* Comments list */}
      {loading ? (
        <ActivityIndicator color={PURPLE} size="small" style={{ marginVertical: 20 }} />
      ) : (
        <View style={{ gap: 10 }}>
          {/* Real + synthetic comments from API */}
          {comments.map(c => {
            const isOwn = c.user_id === userId;
            const color = avatarColor(c.user_id);
            const name = c.display_name ?? `User ${c.user_id}`;
            // PT comment with an EN translation available
            const hasPtTranslation = !!c.body_en && c.body_en !== c.body;
            return (
              <View key={c.id} style={{ backgroundColor: CARD, borderRadius: 5, padding: 12, borderWidth: 1, borderColor: isOwn ? "rgba(124,92,252,0.15)" : BORDER }}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 }}>
                  <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: color + "20", borderWidth: 1, borderColor: color + "40", alignItems: "center", justifyContent: "center" }}>
                    <Text style={{ color, fontSize: 11, fontFamily: "DMSans_700Bold" }}>{initials(c.display_name)}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                      <Text style={{ color: TEXT, fontSize: 12, fontFamily: "DMSans_700Bold" }}>
                        {isOwn ? (language === "pt" ? "Você" : language === "zh" ? "你" : "You") : name}
                      </Text>
                      {isOwn && (
                        <View style={{ paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, backgroundColor: "rgba(124,92,252,0.1)" }}>
                          <Text style={{ color: PURPLE_D, fontSize: 8, fontFamily: "DMSans_700Bold" }}>YOU</Text>
                        </View>
                      )}
                      {hasPtTranslation && (
                        <View style={{ paddingHorizontal: 5, paddingVertical: 1, borderRadius: 4, backgroundColor: "rgba(124,92,252,0.1)" }}>
                          <Text style={{ color: "#7C5CFC", fontSize: 8, fontFamily: "DMSans_700Bold" }}>PT</Text>
                        </View>
                      )}
                    </View>
                    <Text style={{ color: TEXT_MID, fontSize: 10, fontFamily: "DMSans_400Regular" }}>
                      {timeAgo(c.created_at, language)}
                    </Text>
                  </View>
                  {isOwn && (
                    <TouchableOpacity onPress={() => deleteComment(c.id)}>
                      <Text style={{ color: RED, fontSize: 11, fontFamily: "DMSans_500Medium" }}>
                        {language === "pt" ? "Excluir" : language === "zh" ? "删除" : "Delete"}
                      </Text>
                    </TouchableOpacity>
                  )}
                </View>
                {hasPtTranslation ? (
                  <CommentBody body={c.body} bodyEn={c.body_en!} language={language} />
                ) : (
                  <Text style={{ color: TEXT_SUB, fontSize: 13, fontFamily: "DMSans_400Regular", lineHeight: 20 }}>{c.body}</Text>
                )}
              </View>
            );
          })}

          {/* Empty state */}
          {comments.length === 0 && !loading && (
            <View style={{ alignItems: "center", paddingVertical: 24 }}>
              <Text style={{ color: TEXT_MID, fontSize: 13, fontFamily: "DMSans_400Regular" }}>
                {language === "pt" ? "Seja o primeiro a comentar" : language === "zh" ? "来发表第一条评论" : "Be the first to comment"}
              </Text>
            </View>
          )}
        </View>
      )}
    </View>
  );
}
