/**
 * @fileoverview Pins the composition program against the ENV — the app's own `tsc` — and pins the
 * guard that keeps it there.
 *
 * The defect this file exists for: an identical comparison, `IocExternals['userRepository']`
 * against a composed `IocGeneratedCradle['userRepository']`, was ASSIGNABLE under the app's real
 * `tsc --noEmit -p tsconfig.json` and INCOMPATIBLE under the program the checks built for
 * themselves. Same files, opposite verdicts. The mechanism was a workspace package installed as a
 * symlink: the composed registry file entered as a ROOT by its `node_modules` path while the app's
 * own sources reached the same package through module resolution, which TypeScript realpaths — one
 * physical file, two `SourceFile`s, two copies of every declaration in it, and a class with private
 * members is not assignable to its own copy.
 *
 * So the fixture is that shape exactly, and the assertions are three: the guard fires on the
 * pre-fix program, the unified program admits each file once, and its verdict on the compared keys
 * is the same verdict a plain `tsc` run over the same fixture reaches. The env is the referee, and
 * it is consulted mechanically rather than asserted from memory.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import ts from "typescript";
import {
  assertNoDuplicateSourceFiles,
  createCompositionProgram,
  readOnlyProgramOptions,
} from "./compositionProgram.js";
import {
  getInterfacePropertyType,
  isSuppliedAssignableToDemandedTypes,
} from "./typeComparison.js";

const LIB_PACKAGE = "@fix/lib";

/**
 * A class with a PRIVATE member in the compared chain.
 *
 * Load-bearing: two structurally identical copies of a purely structural type are assignable to
 * each other, so a doubled file would pass unnoticed. A private member makes the type nominal —
 * assignability requires the same declaration — which is why the field report's failure surfaced
 * as a class deep in the chain rather than at the compared key itself.
 */
const LIB_TYPES = `export class PendingUser {
  private readonly brand = "pending";
  constructor(public readonly id: string) {}
}

export interface UserRepository {
  find(id: string): PendingUser;
}
`;

const LIB_REGISTRY_TYPES = `import type { UserRepository } from "../types.js";

export interface IocGeneratedCradle {
  userRepository: UserRepository;
}

export interface IocExternals {}
`;

const APP_REGISTRY_TYPES = `import type { UserRepository } from "${LIB_PACKAGE}/types";

export interface IocGeneratedCradle {}

export interface IocExternals {
  userRepository: UserRepository;
}
`;

const APP_SOURCE = `import type { UserRepository } from "${LIB_PACKAGE}/types";

export const useRepository = (repo: UserRepository): string =>
  repo.find("id").id;
`;

type SymlinkedFixture = {
  readonly projectRoot: string;
  readonly appSourceFile: string;
  readonly appTypesPath: string;
  /** The composed registry file BY ITS SYMLINK PATH — what `resolvePackageExportPath` returns. */
  readonly libTypesPathViaSymlink: string;
  readonly libTypesRealPath: string;
};

/**
 * An app and a workspace package, the package reachable BOTH ways: directly on disk under
 * `packages/lib`, and through the `node_modules/@fix/lib` symlink an installer creates.
 */
const buildSymlinkedFixture = (): SymlinkedFixture => {
  const projectRoot = realpathSync(
    mkdtempSync(path.join(tmpdir(), "ioc-composition-program-")),
  );

  writeFileSync(
    path.join(projectRoot, "package.json"),
    JSON.stringify({ name: "@fix/app", type: "module" }),
  );
  writeFileSync(
    path.join(projectRoot, "tsconfig.json"),
    JSON.stringify(
      {
        compilerOptions: {
          target: "ES2022",
          module: "Node16",
          moduleResolution: "Node16",
          lib: ["ES2022"],
          strict: true,
          skipLibCheck: true,
          noEmit: true,
        },
        include: ["src/**/*.ts"],
      },
      null,
      2,
    ),
  );

  const libDir = path.join(projectRoot, "packages", "lib");
  mkdirSync(path.join(libDir, "src", "generated"), { recursive: true });
  writeFileSync(
    path.join(libDir, "package.json"),
    JSON.stringify({
      name: LIB_PACKAGE,
      type: "module",
      exports: {
        "./types": {
          types: "./src/types.ts",
          import: "./src/types.ts",
        },
        "./iocTypes": {
          types: "./src/generated/ioc-registry.types.ts",
          import: "./src/generated/ioc-registry.types.ts",
        },
      },
    }),
  );
  writeFileSync(path.join(libDir, "src", "types.ts"), LIB_TYPES);
  writeFileSync(
    path.join(libDir, "src", "generated", "ioc-registry.types.ts"),
    LIB_REGISTRY_TYPES,
  );

  const scopeDir = path.join(projectRoot, "node_modules", "@fix");
  mkdirSync(scopeDir, { recursive: true });
  symlinkSync(libDir, path.join(scopeDir, "lib"), "dir");

  const appGenerated = path.join(projectRoot, "src", "generated");
  mkdirSync(appGenerated, { recursive: true });
  const appSourceFile = path.join(projectRoot, "src", "app.ts");
  writeFileSync(appSourceFile, APP_SOURCE);
  const appTypesPath = path.join(appGenerated, "ioc-registry.types.ts");
  writeFileSync(appTypesPath, APP_REGISTRY_TYPES);

  return {
    projectRoot,
    appSourceFile,
    appTypesPath,
    libTypesPathViaSymlink: path.join(
      scopeDir,
      "lib",
      "src",
      "generated",
      "ioc-registry.types.ts",
    ),
    libTypesRealPath: path.join(
      libDir,
      "src",
      "generated",
      "ioc-registry.types.ts",
    ),
  };
};

/** The program as it was built before this pass: root names taken verbatim, no source rooted. */
const buildPreFixProgram = (fixture: SymlinkedFixture): ts.Program => {
  const configPath = path.join(fixture.projectRoot, "tsconfig.json");
  const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
  const parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    ts.sys,
    fixture.projectRoot,
    undefined,
    configPath,
  );
  return ts.createProgram({
    rootNames: [fixture.appTypesPath, fixture.libTypesPathViaSymlink],
    options: readOnlyProgramOptions(parsed.options),
  });
};

/** `IocExternals['userRepository']` vs the composed `IocGeneratedCradle['userRepository']`. */
const comparedKeyIsAssignable = (
  ctx: NonNullable<ReturnType<typeof createCompositionProgram>>,
  fixture: SymlinkedFixture,
): boolean => {
  const demanded = getInterfacePropertyType(
    ctx,
    fixture.appTypesPath,
    "IocExternals",
    "userRepository",
  );
  const supplied = getInterfacePropertyType(
    ctx,
    fixture.libTypesPathViaSymlink,
    "IocGeneratedCradle",
    "userRepository",
  );
  assert.ok(demanded !== undefined, "demanded type should resolve");
  assert.ok(supplied !== undefined, "supplied type should resolve");
  return isSuppliedAssignableToDemandedTypes(ctx.checker, demanded, [supplied]);
};

/** The env's own answer, run rather than remembered. */
const plainTscExitCode = (projectRoot: string): number => {
  const tscBin = path.join(
    path.dirname(new URL(import.meta.url).pathname),
    "..",
    "..",
    "node_modules",
    "typescript",
    "bin",
    "tsc",
  );
  try {
    execFileSync(process.execPath, [tscBin, "--noEmit", "-p", "tsconfig.json"], {
      cwd: projectRoot,
      encoding: "utf8",
      stdio: "pipe",
    });
    return 0;
  } catch (error) {
    const status = (error as { status?: number }).status;
    return typeof status === "number" ? status : 1;
  }
};

describe("composition program", () => {
  describe("When a workspace package is reachable both directly and through its symlink", () => {
    it("should admit each physical file exactly once and agree with plain tsc", () => {
      const fixture = buildSymlinkedFixture();

      // The env's verdict on the fixture, first: the app's own build is clean.
      assert.equal(
        plainTscExitCode(fixture.projectRoot),
        0,
        "fixture should compile cleanly under the app's own tsc",
      );

      const ctx = createCompositionProgram({
        projectRoot: fixture.projectRoot,
        sourceFiles: [fixture.appSourceFile],
        typesPaths: [fixture.appTypesPath, fixture.libTypesPathViaSymlink],
      });
      assert.ok(ctx !== undefined);

      const admitted = ctx!.program
        .getSourceFiles()
        .filter((sf) => sf.fileName === fixture.libTypesRealPath);
      assert.equal(admitted.length, 1);
      assert.equal(
        ctx!.program.getSourceFile(fixture.libTypesPathViaSymlink),
        undefined,
        "the symlink path should not be a second SourceFile",
      );

      // Same verdict as the env: assignable.
      assert.equal(comparedKeyIsAssignable(ctx!, fixture), true);
    });

    it("should hard-error naming both paths when one file is admitted twice", () => {
      const fixture = buildSymlinkedFixture();
      const preFix = buildPreFixProgram(fixture);

      assert.throws(
        () => assertNoDuplicateSourceFiles(preFix),
        (error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          assert.match(message, /admitted .* more than once/);
          assert.ok(
            message.includes(path.join("packages", "lib", "src", "types.ts")),
            "should name the physical file",
          );
          assert.ok(
            message.includes(path.join("node_modules", "@fix", "lib")),
            "should name the symlinked admission",
          );
          return true;
        },
      );
    });

    it("should reach the OPPOSITE verdict from tsc before the fix — the divergence itself", () => {
      const fixture = buildSymlinkedFixture();
      const preFix = buildPreFixProgram(fixture);
      const checker = preFix.getTypeChecker();

      // Reading through the pre-fix program directly: both roots are present under their verbatim
      // paths, and `PendingUser` in the chain has been declared twice.
      const preFixCtx = {
        checker,
        program: preFix,
        customConditions: undefined,
        canonicalPathFor: (p: string) => p,
      };
      const demanded = getInterfacePropertyType(
        preFixCtx,
        fixture.appTypesPath,
        "IocExternals",
        "userRepository",
      );
      const supplied = getInterfacePropertyType(
        preFixCtx,
        fixture.libTypesPathViaSymlink,
        "IocGeneratedCradle",
        "userRepository",
      );
      assert.ok(demanded !== undefined && supplied !== undefined);

      assert.equal(
        isSuppliedAssignableToDemandedTypes(checker, demanded!, [supplied!]),
        false,
        "the pre-fix program must disagree with tsc — otherwise this fixture is not the defect",
      );
      assert.equal(plainTscExitCode(fixture.projectRoot), 0);
    });
  });

  describe("When tsconfig declares customConditions", () => {
    it("should carry customConditions for module-resolution parity", () => {
      const root = mkdtempSync(path.join(tmpdir(), "ioc-composition-cond-"));
      writeFileSync(
        path.join(root, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            strict: true,
            noEmit: true,
            customConditions: ["development"],
          },
        }),
      );
      const typesPath = path.join(root, "types.ts");
      writeFileSync(
        typesPath,
        "export interface IocGeneratedCradle { config: { logLevel: string } }\n",
      );

      const ctx = createCompositionProgram({
        projectRoot: root,
        sourceFiles: [],
        typesPaths: [typesPath],
      });
      assert.ok(ctx !== undefined);
      assert.deepEqual(ctx!.customConditions, ["development"]);
    });
  });

  describe("When generation supplies artifacts it has not written yet", () => {
    it("should read the pending source rather than what is on disk", () => {
      const root = mkdtempSync(path.join(tmpdir(), "ioc-composition-overlay-"));
      writeFileSync(
        path.join(root, "tsconfig.json"),
        JSON.stringify({ compilerOptions: { strict: true, noEmit: true } }),
      );
      const typesPath = path.join(root, "types.ts");
      writeFileSync(
        typesPath,
        "export interface IocGeneratedCradle { stale: string }\n",
      );

      const ctx = createCompositionProgram({
        projectRoot: root,
        sourceFiles: [],
        typesPaths: [typesPath],
        overlay: new Map([
          [
            typesPath,
            "export interface IocGeneratedCradle { pending: number }\n",
          ],
        ]),
      });
      assert.ok(ctx !== undefined);

      assert.equal(
        getInterfacePropertyType(ctx!, typesPath, "IocGeneratedCradle", "stale"),
        undefined,
      );
      const pending = getInterfacePropertyType(
        ctx!,
        typesPath,
        "IocGeneratedCradle",
        "pending",
      );
      assert.ok(pending !== undefined);
      assert.equal(ctx!.checker.typeToString(pending!), "number");
    });
  });
});
