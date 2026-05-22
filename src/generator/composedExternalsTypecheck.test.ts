import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

const require = createRequire(import.meta.url);
const tscBin = path.join(
  path.dirname(require.resolve("typescript/package.json")),
  "bin",
  "tsc",
);

describe("composed externals satisfaction assertion", () => {
  describe("When AppCradle does not supply a composed package external", () => {
    it("should fail tsc at the satisfaction assertion", () => {
      const root = mkdtempSync(path.join(tmpdir(), "ioc-ext-"));
      const srcDir = path.join(root, "src");
      mkdirSync(srcDir, { recursive: true });

      writeFileSync(
        path.join(srcDir, "ioc-composed.ts"),
        `export type AppCradle = { appOnly: string };
export interface LibExternals { database: unknown; }
type _IocExpect<T extends true> = T;
type _LibExternalsSatisfied =
  LibExternals extends Pick<AppCradle, keyof LibExternals> ? true : never;
type _LibExternalsAssert = _IocExpect<_LibExternalsSatisfied>;
`,
      );

      writeFileSync(
        path.join(root, "tsconfig.json"),
        JSON.stringify(
          {
            compilerOptions: {
              strict: true,
              noEmit: true,
              target: "ES2022",
              module: "ES2022",
            },
            include: ["src/**/*.ts"],
          },
          null,
          2,
        ),
      );

      assert.throws(
        () =>
          execFileSync(process.execPath, [tscBin, "-p", root], {
            cwd: root,
            encoding: "utf8",
            stdio: "pipe",
          }),
        (err: unknown) => {
          const stderr =
            err !== null &&
            typeof err === "object" &&
            "stderr" in err &&
            typeof (err as { stderr: unknown }).stderr === "string"
              ? (err as { stderr: string }).stderr
              : String(err);
          const out =
            ("stdout" in (err as object) &&
              typeof (err as { stdout: unknown }).stdout === "string" &&
              (err as { stdout: string }).stdout) ||
            stderr;
          assert.match(out, /LibExternalsAssert|does not satisfy/);
          return true;
        },
      );
    });
  });
});
