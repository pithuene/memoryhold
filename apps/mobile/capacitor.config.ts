import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.memoryhold.app",
  appName: "Memoryhold",
  webDir: "../web/dist",
  bundledWebRuntime: false,
  server: {
    androidScheme: "https",
  },
};

export default config;
