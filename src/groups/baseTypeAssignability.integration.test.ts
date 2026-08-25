import assert from "node:assert";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import ts from "typescript";
import type {
  ResolvedContractRegistration,
  ResolvedImplementationEntry,
} from "../generator/resolveRegistrationPlan.js";
import {
  collectContractDefaultMembersAssignableToBase,
  getContractDeclaredType,
  resolveDeclaredBaseType,
} from "./baseTypeAssignability.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nullableContractFixture = path.join(
  __dirname,
  "test-fixtures/nullable-contract/contracts.ts",
);

const makeProgram = (roots: string[]): ts.Program =>
  ts.createProgram({
    rootNames: roots,
    options: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      strict: true,
      noEmit: true,
    },
  });

const minimalImpl = (
  implementationName: string,
  registrationKey: string,
): ResolvedImplementationEntry => ({
  implementationName,
  registrationKey,
  exportName: "buildX",
  modulePath: "m.ts",
  relImport: "../m.js",
  lifetime: "singleton",
});

describe("getContractDeclaredType", () => {
  describe("When the contract type alias is a union with undefined", () => {
    it("should yield a type assignable to the contract base interface for group matching", () => {
      const program = makeProgram([nullableContractFixture]);
      const checker = program.getTypeChecker();
      const base = resolveDeclaredBaseType(program, checker, "WidgetBase");
      assert.strictEqual(base.ok, true);
      if (!base.ok) {
        return;
      }
      const generatedDir = path.join(
        path.dirname(nullableContractFixture),
        "generated",
      );
      const plan: ResolvedContractRegistration = {
        contractName: "NullableWidgetContract",
        contractTypeRelImport: "../contracts.js",
        contractKey: "nullableWidget",
        accessKey: "nullableWidget",
        defaultImplementationName: "only",
        implementations: [
          {
            implementationName: "only",
            registrationKey: "only",
            exportName: "buildX",
            modulePath: "m.ts",
            relImport: "../m.js",
            lifetime: "singleton",
          },
        ],
      };
      const contractType = getContractDeclaredType(
        checker,
        program,
        generatedDir,
        [],
        plan,
      );
      assert.ok(contractType !== undefined);
      assert.strictEqual(
        checker.isTypeAssignableTo(contractType, base.type),
        true,
      );
    });
  });

  describe("When the contract type alias is a union with null", () => {
    it("should yield a type assignable to the contract base interface for group matching", () => {
      const program = makeProgram([nullableContractFixture]);
      const checker = program.getTypeChecker();
      const base = resolveDeclaredBaseType(program, checker, "WidgetBase");
      assert.strictEqual(base.ok, true);
      if (!base.ok) {
        return;
      }
      const generatedDir = path.join(
        path.dirname(nullableContractFixture),
        "generated",
      );
      const plan: ResolvedContractRegistration = {
        contractName: "NullWidgetContract",
        contractTypeRelImport: "../contracts.js",
        contractKey: "nullWidget",
        accessKey: "nullWidget",
        defaultImplementationName: "only",
        implementations: [
          {
            implementationName: "only",
            registrationKey: "only",
            exportName: "buildX",
            modulePath: "m.ts",
            relImport: "../m.js",
            lifetime: "singleton",
          },
        ],
      };
      const contractType = getContractDeclaredType(
        checker,
        program,
        generatedDir,
        [],
        plan,
      );
      assert.ok(contractType !== undefined);
      assert.strictEqual(
        checker.isTypeAssignableTo(contractType, base.type),
        true,
      );
    });
  });
});

describe("collectContractDefaultMembersAssignableToBase", () => {
  describe("When a registration uses a contract type of the form Foo | undefined", () => {
    it("should include the contract when its non-nullish type is assignable to the object group base type", () => {
      const program = makeProgram([nullableContractFixture]);
      const checker = program.getTypeChecker();
      const base = resolveDeclaredBaseType(program, checker, "WidgetBase");
      assert.strictEqual(base.ok, true);
      if (!base.ok) {
        return;
      }
      const generatedDir = path.join(
        path.dirname(nullableContractFixture),
        "generated",
      );
      const plans: ResolvedContractRegistration[] = [
        {
          contractName: "NullableWidgetContract",
          contractTypeRelImport: "../contracts.js",
          contractKey: "nullableWidget",
          accessKey: "nullableWidget",
          defaultImplementationName: "only",
          implementations: [
            {
              implementationName: "only",
              registrationKey: "defaultSlot",
              exportName: "buildX",
              modulePath: "m.ts",
              relImport: "../m.js",
              lifetime: "singleton",
            },
          ],
        },
      ];
      const members = collectContractDefaultMembersAssignableToBase(
        checker,
        program,
        generatedDir,
        [],
        plans,
        base.type,
      );
      assert.deepStrictEqual(members, []);
    });
  });
});
