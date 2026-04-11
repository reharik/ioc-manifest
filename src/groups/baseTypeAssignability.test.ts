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
  shouldIncludeImplInCollectionGroup,
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

describe("shouldIncludeImplInCollectionGroup", () => {
  describe("When an implementation uses the contract default registration key but is not the selected default implementation", () => {
    it("should exclude it from collection membership", () => {
      const plan: ResolvedContractRegistration = {
        contractName: "MediaStorage",
        contractTypeRelImport: "../x.js",
        contractKey: "mediaStorage",
        accessKey: "mediaStorage",
        collectionKey: "mediaStorages",
        defaultImplementationName: "s3MediaStorage",
        implementations: [
          minimalImpl("localMediaStorage", "localMediaStorage"),
          minimalImpl("mediaStorage", "mediaStorage"),
          minimalImpl("s3MediaStorage", "s3MediaStorage"),
        ],
      };
      assert.strictEqual(
        shouldIncludeImplInCollectionGroup(plan, plan.implementations[0]!),
        true,
      );
      assert.strictEqual(
        shouldIncludeImplInCollectionGroup(plan, plan.implementations[1]!),
        false,
      );
      assert.strictEqual(
        shouldIncludeImplInCollectionGroup(plan, plan.implementations[2]!),
        true,
      );
    });
  });

  describe("When the selected default is registered at the contract default key", () => {
    it("should include that implementation", () => {
      const plan: ResolvedContractRegistration = {
        contractName: "MediaStorage",
        contractTypeRelImport: "../x.js",
        contractKey: "mediaStorage",
        accessKey: "mediaStorage",
        collectionKey: "mediaStorages",
        defaultImplementationName: "mediaStorage",
        implementations: [
          minimalImpl("localMediaStorage", "localMediaStorage"),
          minimalImpl("mediaStorage", "mediaStorage"),
        ],
      };
      assert.strictEqual(
        shouldIncludeImplInCollectionGroup(plan, plan.implementations[1]!),
        true,
      );
    });
  });

  describe("When the implementation uses a registration key other than the contract default key", () => {
    it("should include it regardless of default selection", () => {
      const plan: ResolvedContractRegistration = {
        contractName: "MediaStorage",
        contractTypeRelImport: "../x.js",
        contractKey: "mediaStorage",
        accessKey: "mediaStorage",
        collectionKey: "mediaStorages",
        defaultImplementationName: "s3MediaStorage",
        implementations: [minimalImpl("localMediaStorage", "localMediaStorage")],
      };
      assert.strictEqual(
        shouldIncludeImplInCollectionGroup(plan, plan.implementations[0]!),
        true,
      );
    });
  });
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
        collectionKey: undefined,
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
        collectionKey: undefined,
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
          collectionKey: undefined,
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
      assert.deepStrictEqual(members, [
        {
          contractKey: "nullableWidget",
          contractName: "NullableWidgetContract",
          registrationKey: "defaultSlot",
        },
      ]);
    });
  });
});
