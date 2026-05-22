import { existsSync } from "node:fs";
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

const packages = ["lib-storage", "lib-services", "app", "app-externals-broken"];

for (const name of packages) {
  const cwd = path.join(exampleRoot, "packages", name);
  console.log(`[example] generating manifest for ${name}...`);
  execSync(process.execPath, [iocCli, "generate"], {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
}
