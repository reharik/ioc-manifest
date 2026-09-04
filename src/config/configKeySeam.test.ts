/**
 * @fileoverview The seam between the `IocConfig` TYPE and the schema that validates it.
 *
 * `iocConfigSchema` is `.strict()` at every level, which is what makes an unknown key an error
 * rather than a silent no-op. The cost of that strictness is a second list: a property can be added
 * to {@link import("./iocConfig.js").IocConfig}, documented, read by the code, and covered by tests
 * — and still be REJECTED for every consumer who sets it, because nobody added the line to the
 * schema. The type says yes and the parser says no, and only the parser ships.
 *
 * That is not hypothetical. `dependencyKeyCoverage` landed complete in every other respect — typed,
 * defaulted, documented, and exercised by `reportUnknownDependencyKeys.integration.test.ts` — and
 * was unusable from an `ioc.config.ts`, because those tests build the config object in TypeScript
 * and hand it straight to the function, never through the schema. `manageGitignore` had the same
 * hole and was caught only because one integration test happened to write a real config file.
 *
 * The schema's own header calls the hand-maintained whitelist the failure mode it was built to end
 * (`baseTypeArg`, `allowLifetimeInversion`, `allowEmpty`). Strictness moved that list rather than
 * removing it. So it is checked here by mechanism, in both directions, exactly as the fast-lane
 * suffix is checked in `test-support/testLaneSeam.test.ts`.
 *
 * Fast lane, and this is the same demonstration that file makes: `typescript` is imported to PARSE
 * one source file for its property names, never to build a program.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import { formatIocConfigIssues, iocConfigSchema } from "./iocConfigSchema.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_TYPE_FILE = path.join(__dirname, "iocConfig.ts");

/**
 * The property names declared on `export type IocConfig = { ... }`.
 *
 * Read from the source text rather than from a value: the type is erased at runtime, so there is
 * nothing to reflect on, and the declaration itself is the thing a developer edits when they add an
 * option. Parsing it is what makes this check impossible to forget to update.
 */
const declaredConfigKeys = (): string[] => {
  const source = ts.createSourceFile(
    CONFIG_TYPE_FILE,
    fs.readFileSync(CONFIG_TYPE_FILE, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );

  for (const statement of source.statements) {
    if (
      !ts.isTypeAliasDeclaration(statement) ||
      statement.name.text !== "IocConfig" ||
      !ts.isTypeLiteralNode(statement.type)
    ) {
      continue;
    }
    return statement.type.members
      .filter(ts.isPropertySignature)
      .map((member) => member.name.getText(source));
  }

  assert.fail(
    `could not find \`export type IocConfig = { ... }\` in ${CONFIG_TYPE_FILE} — ` +
      "if it was renamed or reshaped, this seam needs updating with it",
  );
};

/** The keys the strict schema will actually accept at the top level. */
const schemaKeys = (): string[] =>
  Object.keys((iocConfigSchema as unknown as { shape: Record<string, unknown> }).shape);

describe("the config key seam", () => {
  describe("When IocConfig declares a property", () => {
    it("should be accepted by the strict schema, or no consumer can set it", () => {
      const missing = declaredConfigKeys().filter(
        (key) => !schemaKeys().includes(key),
      );

      assert.deepEqual(
        missing,
        [],
        `${missing.join(", ")} — declared on IocConfig but absent from iocConfigSchema, so ` +
          "`ioc.config.ts` setting it fails with `has unknown property`. Add it to the schema's " +
          "top-level object with the shape its type promises.",
      );
    });
  });

  /**
   * Key presence is necessary and not sufficient. The seam checks above compare NAME lists, so they
   * stay green against a schema entry whose shape is wrong — `dependencyKeyCoverage: z.boolean()`,
   * or an enum missing `"error"` — and the config that sets it still fails to parse. The two flags
   * 4.1 ships are therefore parsed here at their documented non-default values, which is the
   * cheapest thing that could have caught the original bug in either of its forms.
   */
  describe("When a config sets the 4.1 flags to non-default values", () => {
    it("should parse, or the release ships a flag no consumer can set", () => {
      const parsed = iocConfigSchema.safeParse({
        discovery: { scanDirs: "src" },
        dependencyKeyCoverage: "error",
        manageGitignore: false,
      });

      assert.equal(
        parsed.success,
        true,
        parsed.success
          ? ""
          : formatIocConfigIssues(parsed.error, "ioc.config.ts"),
      );
      assert.equal(parsed.success && parsed.data.dependencyKeyCoverage, "error");
      assert.equal(parsed.success && parsed.data.manageGitignore, false);
    });
  });

  describe("When the schema accepts a key", () => {
    it("should be declared on IocConfig, or nothing documents or reads it", () => {
      const undeclared = schemaKeys().filter(
        (key) => !declaredConfigKeys().includes(key),
      );

      assert.deepEqual(
        undeclared,
        [],
        `${undeclared.join(", ")} — accepted by iocConfigSchema but absent from IocConfig, so it ` +
          "type-errors in a `defineIocConfig` call and appears in no documentation. Remove it, or " +
          "declare it.",
      );
    });
  });
});
