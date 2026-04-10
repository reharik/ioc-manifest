import { defineIocConfig } from "./config/iocConfig.js";

export default defineIocConfig({
  discovery: {
    scanDirs: "src",
    generatedDir: "src/generated",
    includes: ["examples/**/*.{ts,tsx,js,mjs,cjs}"],
    excludes: [
      "**/*.d.ts",
      "**/*.test.{ts,tsx,js,mjs,cjs}",
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
  groups: {
    /** All implementations whose contract is assignable to MediaStorage. */
    mediaStoragesGroup: {
      kind: "collection",
      baseType: "MediaStorage",
    },
  },
});
