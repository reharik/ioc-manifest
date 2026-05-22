import { existsSync, globSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptsDir = path.dirname(fileURLToPath(import.meta.url));
const exampleRoot = path.join(scriptsDir, "..");
const repoRoot = path.join(exampleRoot, "..", "..");
const iocCli = path.join(repoRoot, "dist", "cli", "ioc.js");

if (!existsSync(iocCli)) {
  console.error(
    "[example] ioc-manifest is not built. From the repo root run: npm run build",
  );
  process.exit(1);
}

/** Packages with `src/ioc.config.ts` (same convention as the main test glob). */
const discoverPackages = (root) => {
  const pattern = path.join(root, "packages", "*", "src", "ioc.config.ts");
  const configs = globSync(pattern);
  return configs
    .map((cfg) => path.basename(path.dirname(path.dirname(cfg))))
    .sort((a, b) => a.localeCompare(b));
};

const packages = discoverPackages(exampleRoot);

if (packages.length === 0) {
  console.error(
    "[example] no packages found matching packages/*/src/ioc.config.ts",
  );
  process.exit(1);
}

for (const name of packages) {
  const cwd = path.join(exampleRoot, "packages", name);
  console.log(`[example] generating manifest for ${name}...`);
  execSync(process.execPath, [iocCli, "generate"], {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
}
