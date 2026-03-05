// import React from "react";
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
} from "react-native";
import type { ChatMessage as ChatMessageType } from "../hooks/useRealtimeSession";

const COLORS = {
  background: "#0f172a",
  surface: "#1e293b",
  userBubble: "#3b82f6",
  assistantBubble: "#334155",
  text: "#f1f5f9",
  textSecondary: "#94a3b8",
  border: "#475569",
  fluencyGood: "#22c55e",
  fluencyMid: "#eab308",
  fluencyLow: "#ef4444",
};

interface ChatMessageProps {
  message: ChatMessageType;
  onPlayAudio?: (url: string) => void;
}

export function ChatMessage({ message, onPlayAudio }: ChatMessageProps) {
  const isUser = message.role === "user";
  return (
    <View style={[styles.row, isUser ? styles.rowUser : styles.rowAssistant]}>
      <View
        style={[
          styles.bubble,
          isUser ? styles.bubbleUser : styles.bubbleAssistant,
        ]}
      >
        {(message.text || message.isPartial) && (
          <Text
            style={[
              styles.body,
              message.isPartial && styles.bodyPartial,
            ]}
            selectable
          >
            {message.text || (message.isPartial ? "…" : "")}
          </Text>
        )}
        {message.audioUrl && onPlayAudio && (
          <TouchableOpacity
            style={styles.playBtn}
            onPress={() => onPlayAudio(message.audioUrl!)}
            activeOpacity={0.8}
          >
            <Text style={styles.playBtnText}>▶ Play again</Text>
          </TouchableOpacity>
        )}
        {message.feedback && (
          <View style={styles.feedback}>
            {typeof message.feedback.fluency_score === "number" && (
              <View style={styles.fluencyRow}>
                <Text style={styles.feedbackLabel}>Fluency</Text>
                <View style={styles.fluencyTrack}>
                  <View
                    style={[
                      styles.fluencyFill,
                      {
                        width: `${message.feedback.fluency_score * 10}%`,
                        backgroundColor:
                          message.feedback.fluency_score >= 7
                            ? COLORS.fluencyGood
                            : message.feedback.fluency_score >= 4
                              ? COLORS.fluencyMid
                              : COLORS.fluencyLow,
                      },
                    ]}
                  />
                </View>
                <Text style={styles.fluencyScore}>
                  {message.feedback.fluency_score}/10
                </Text>
              </View>
            )}
            {message.feedback.tip?.trim() && (
              <Text style={styles.tip}>{message.feedback.tip}</Text>
            )}
            {Array.isArray(message.feedback.grammar_errors) &&
              message.feedback.grammar_errors.length > 0 && (
                <View style={styles.errors}>
                  {message.feedback.grammar_errors.map((e, i) => (
                    <Text key={i} style={styles.errorText}>
                      “{e.original}” → {e.suggestion}
                    </Text>
                  ))}
                </View>
              )}
          </View>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    marginVertical: 4,
    paddingHorizontal: 12,
  },
  rowUser: {
    justifyContent: "flex-end",
  },
  rowAssistant: {
    justifyContent: "flex-start",
  },
  bubble: {
    maxWidth: "85%",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 16,
  },
  bubbleUser: {
    backgroundColor: COLORS.userBubble,
    borderBottomRightRadius: 4,
  },
  bubbleAssistant: {
    backgroundColor: COLORS.assistantBubble,
    borderBottomLeftRadius: 4,
  },
  body: {
    fontSize: 16,
    color: COLORS.text,
    lineHeight: 22,
  },
  bodyPartial: {
    color: COLORS.textSecondary,
  },
  playBtn: {
    marginTop: 8,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: "rgba(255,255,255,0.15)",
    borderRadius: 8,
    alignSelf: "flex-start",
  },
  playBtnText: {
    color: COLORS.text,
    fontSize: 14,
  },
  feedback: {
    marginTop: 12,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  feedbackLabel: {
    fontSize: 12,
    color: COLORS.textSecondary,
    marginBottom: 4,
  },
  fluencyRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  fluencyTrack: {
    flex: 1,
    height: 6,
    backgroundColor: COLORS.border,
    borderRadius: 3,
    overflow: "hidden",
  },
  fluencyFill: {
    height: "100%",
    borderRadius: 3,
  },
  fluencyScore: {
    fontSize: 12,
    color: COLORS.text,
    fontWeight: "600",
    minWidth: 28,
  },
  tip: {
    fontSize: 13,
    color: COLORS.textSecondary,
    marginTop: 6,
    fontStyle: "italic",
  },
  errors: {
    marginTop: 6,
  },
  errorText: {
    fontSize: 12,
    color: "#fca5a5",
    marginBottom: 2,
  },
});
