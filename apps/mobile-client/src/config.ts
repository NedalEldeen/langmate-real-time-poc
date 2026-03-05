/**
 * Server URL for realtime voice chat.
 * - Android Emulator: 10.0.2.2
 * - iOS Simulator: 127.0.0.1 (localhost)
 * - iOS / physical device: your Mac's LAN IP (DEV_SERVER_IP)
 * 
 * IMPORTANT: iOS Simulator does NOT have a real microphone!
 * For voice testing, you MUST use a physical device.
 */
import { Platform } from "react-native";
import Constants from "expo-constants";

/** 
 * Your Mac's IP on the same Wi‑Fi network.
 * Find it by running: ipconfig getifaddr en0
 * UPDATE THIS to match your network!
 */
const DEV_SERVER_IP = "192.168.1.2";

// Detect if running on simulator
// Constants.isDevice is true for physical devices, false for simulators
// However, in dev builds it can be unreliable, so we'll default to assuming physical device
const isSimulator = Constants.isDevice === false;

// ALWAYS use the LAN IP for iOS (both simulator and device need to reach Mac)
// Only Android emulator uses the special 10.0.2.2 address
export const SERVER_URL =
  __DEV__ && Platform.OS === "android"
    ? "http://10.0.2.2:3000"
    : `http://${DEV_SERVER_IP}:3000`;

// Flag to indicate if we're running on a simulator (no real mic)
export const IS_SIMULATOR = isSimulator && Platform.OS === "ios";
