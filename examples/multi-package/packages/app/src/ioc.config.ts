import { defineIocConfig } from "ioc-manifest";

export default defineIocConfig({
  discovery: {
    scanDirs: ["src/factories"],
    generatedDir: "src/generated",
    includes: ["**/*.{ts,tsx}"],
  },
  composedManifests: ["@example/lib-storage", "@example/lib-services"],
  registrations: {
    Storage: {
      s3Storage: { default: true },
    },
  },
});
