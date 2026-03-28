import { defineIocConfig } from "../../../config/iocConfig.js";

export default defineIocConfig({
  discovery: { rootDir: "src" },
  bundles: {
    bad: {
      $discover: { baseInterface: "ReadService" },
      extra: [],
    },
  },
});
