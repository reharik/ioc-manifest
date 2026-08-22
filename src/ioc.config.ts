import { defineIocConfig } from "./config/iocConfig.js";

export default defineIocConfig({
  discovery: {
    scanDirs: "src",
    generatedDir: "src/generated",
    includes: ["examples/**/*.{ts,tsx,js,mjs,cjs}"],
    excludes: [
      "**/*.d.ts",
      "**/*.{test,tests}.{ts,tsx,js,mjs,cjs}",
      "**/*.{spec,specs}.{ts,tsx,js,mjs,cjs}",
      "examples/e-invalid-*.ts",
      "generated/**/*",
      "dist/**/*",
      "node_modules/**/*",
    ],
    factoryPrefix: "build",
  },
  registrations: {
    Widget: {
      primaryWidget: { default: true },
    },
    MediaStorage: {
      s3MediaStorage: { default: true },
    },
    Logger: {
      consoleLogger: { default: true },
    },
  },
  classes: {
    /**
     * The example files are named by lesson (`g-class-registration.ts`), not by class, so the
     * `loadModules` migration warning would fire on every run. The key change is understood and
     * intentional here.
     */
    ArchiveMediaStorage: { allowDivergentFileName: true },
  },
  groups: {
    /**
     * Every contract declaring heritage to `NotificationChannel`, keyed by contract.
     *
     * Grouped ⇒ group-only: `EmailChannel` and `SmsChannel` are consumed through this key and
     * nowhere else — no contract keys, no member registration keys in the cradle. `MediaStorage`
     * is deliberately NOT grouped, because lessons b/c/f/g/h consume it singularly; a contract is
     * a family or a singular, never both.
     */
    notificationChannels: {
      kind: "object",
      baseType: "NotificationChannel",
    },
  },
});
