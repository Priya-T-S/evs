import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.ecopulse.app",
  appName: "EcoPulse",
  webDir: "dist",
  android: { allowMixedContent: true },
  server: {
    // Allows the WebView to reach a plain-http dev API (e.g. http://10.0.2.2:8000 from the Android emulator).
    androidScheme: "https",
    cleartext: true,
  },
  plugins: {
    PushNotifications: { presentationOptions: ["badge", "sound", "alert"] },
    StatusBar: { overlaysWebView: true, style: "DEFAULT" },
  },
};

export default config;
