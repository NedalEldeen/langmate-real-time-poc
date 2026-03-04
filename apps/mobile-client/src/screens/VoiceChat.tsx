import { useRef, useEffect } from "react";
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  StatusBar,
  SafeAreaView,
  KeyboardAvoidingView,
  Platform,
} from "react-native";
import { useRealtimeSession } from "../hooks/useRealtimeSession";
import { ChatMessage } from "../components/ChatMessage";

const COLORS = {
  background: "#0f172a",
  surface: "#1e293b",
  primary: "#3b82f6",
  danger: "#dc2626",
  warning: "#f59e0b",
  text: "#f1f5f9",
  textSecondary: "#94a3b8",
  border: "#475569",
};

// iOS Simulator warning - simulator has no microphone
const IS_IOS_SIMULATOR = __DEV__ && Platform.OS === "ios";

export function VoiceChat() {
  const {
    status,
    messages,
    error,
    connect,
    disconnect,
    startRecording,
    stopRecording,
    playFromUrl,
  } = useRealtimeSession();

  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    if (messages.length > 0) {
      listRef.current?.scrollToEnd({ animated: true });
    }
  }, [messages.length]);

  const handleMicButton = () => {
    if (status === "idle") { startRecording(); return; }
    if (status === "recording") { stopRecording(); return; }
  };

  const isRecording = status === "recording";
  const canRecord = status === "idle" || status === "recording";
  const isConnecting = status === "connecting";
  const isDisconnected = status === "disconnected";

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.background} />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <View>
              <Text style={styles.title}>Langmate</Text>
              <Text style={styles.subtitle}>Voice practice</Text>
            </View>
            {/* Status dot */}
            <View style={styles.statusChip}>
              <View
                style={[
                  styles.dot,
                  isConnecting && styles.dotConnecting,
                  status === "idle" && styles.dotIdle,
                  isRecording && styles.dotRecording,
                  status === "responding" && styles.dotResponding,
                  isDisconnected && styles.dotDisconnected,
                ]}
              />
              <Text style={styles.statusLabel}>
                {isConnecting
                  ? "Connecting…"
                  : status === "idle"
                    ? "Ready"
                    : isRecording
                      ? "Recording"
                      : status === "responding"
                        ? "Responding…"
                        : "Disconnected"}
              </Text>
              {!isDisconnected && !isConnecting && (
                <TouchableOpacity
                  onPress={disconnect}
                  hitSlop={{ top: 8, bottom: 8, left: 12, right: 12 }}
                >
                  <Text style={styles.disconnectText}>Disconnect</Text>
                </TouchableOpacity>
              )}
            </View>
          </View>

          {/* {error ? (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity style={styles.retryBtn} onPress={connect}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          ) : IS_IOS_SIMULATOR ? (
            <View style={styles.warningBox}>
              <Text style={styles.warningText}>
                ⚠️ iOS Simulator has no microphone. For voice testing, please use a physical device.
              </Text>
            </View>
          ) : null} */}
        </View>

        {/* Message list */}
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <ChatMessage message={item} onPlayAudio={playFromUrl} />
          )}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={
            isConnecting ? (
              <View style={styles.empty}>
                <ActivityIndicator size="large" color={COLORS.primary} />
                <Text style={styles.emptySubtext}>Connecting to server…</Text>
              </View>
            ) : isDisconnected ? (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>Not connected</Text>
                <TouchableOpacity style={styles.bigRetryBtn} onPress={connect}>
                  <Text style={styles.bigRetryText}>Reconnect</Text>
                </TouchableOpacity>
              </View>
            ) : (
              <View style={styles.empty}>
                <Text style={styles.emptyText}>Tap the mic to speak</Text>
                <Text style={styles.emptySubtext}>
                  Hold the button while talking, then tap Done.
                </Text>
              </View>
            )
          }
        />

        {/* Mic button — only visible when connected */}
        <View style={styles.footer}>
          {isDisconnected || isConnecting ? (
            <View style={[styles.mainBtn, styles.mainBtnDisabled]}>
              {isConnecting ? (
                <ActivityIndicator color="#94a3b8" size="small" />
              ) : (
                <Text style={styles.mainBtnLabelDimmed}>Connecting…</Text>
              )}
            </View>
          ) : status === "responding" ? (
            <View style={[styles.mainBtn, styles.mainBtnDisabled]}>
              <ActivityIndicator color="#94a3b8" size="small" />
              <Text style={[styles.mainBtnLabel, { marginLeft: 8 }]}>AI is speaking…</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.mainBtn, isRecording && styles.mainBtnRecording]}
              onPress={handleMicButton}
              disabled={!canRecord}
              activeOpacity={0.9}
            >
              <Text style={styles.mainBtnLabel}>
                {isRecording ? "Done talking" : "Hold to speak"}
              </Text>
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.background },
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  title: { fontSize: 24, fontWeight: "700", color: COLORS.text },
  subtitle: { fontSize: 13, color: COLORS.textSecondary, marginTop: 2 },
  statusChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: COLORS.surface,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 20,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: COLORS.border,
  },
  dotDisconnected: { backgroundColor: "#475569" },
  dotConnecting: { backgroundColor: "#f59e0b" },
  dotIdle: { backgroundColor: "#22c55e" },
  dotRecording: { backgroundColor: COLORS.danger },
  dotResponding: { backgroundColor: COLORS.primary },
  statusLabel: { fontSize: 13, color: COLORS.textSecondary },
  disconnectText: { fontSize: 12, color: "#64748b", marginLeft: 4 },
  errorBox: {
    marginTop: 10,
    padding: 10,
    backgroundColor: "rgba(220, 38, 38, 0.12)",
    borderRadius: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  errorText: { flex: 1, fontSize: 12, color: "#fca5a5" },
  warningBox: {
    marginTop: 10,
    padding: 10,
    backgroundColor: "rgba(245, 158, 11, 0.15)",
    borderRadius: 10,
  },
  warningText: { fontSize: 12, color: "#fbbf24" },
  retryBtn: {
    backgroundColor: COLORS.primary,
    paddingVertical: 5,
    paddingHorizontal: 12,
    borderRadius: 8,
  },
  retryText: { fontSize: 13, color: "#fff", fontWeight: "600" },
  listContent: { paddingVertical: 12, paddingBottom: 24 },
  empty: { paddingVertical: 60, paddingHorizontal: 24, alignItems: "center" },
  emptyText: { fontSize: 16, color: COLORS.textSecondary, textAlign: "center" },
  emptySubtext: { fontSize: 14, color: COLORS.border, marginTop: 8, textAlign: "center" },
  bigRetryBtn: {
    marginTop: 16,
    backgroundColor: COLORS.primary,
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 12,
  },
  bigRetryText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  footer: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    paddingBottom: Platform.OS === "ios" ? 28 : 16,
    backgroundColor: COLORS.background,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  mainBtn: {
    backgroundColor: COLORS.primary,
    paddingVertical: 16,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    minHeight: 56,
  },
  mainBtnDisabled: { backgroundColor: COLORS.surface, opacity: 0.6 },
  mainBtnRecording: { backgroundColor: COLORS.danger },
  mainBtnLabel: { fontSize: 18, fontWeight: "600", color: "#fff" },
  mainBtnLabelDimmed: { fontSize: 16, color: COLORS.textSecondary },
});
