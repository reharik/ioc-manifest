/**
 * @fileoverview Emits the bounded collection element type `Base<declaredArg>` for groups over a
 * generic base with a declared `baseTypeArg`. The base and the argument are each run through
 * {@link emitTypeReference} so imports (and the arity clamp for the bare base name) are handled the
 * same way as ordinary cradle types; the composed element feeds `ReadonlyArray<...>` in the cradle.
 */
import type ts from "typescript";
import type { IocGroupsManifest } from "../core/manifest.js";
import {
  emitTypeReference,
  type EmitTypeReferenceContext,
} from "../generator/analyzeDemandSupply/emitTypeReference.js";
import type { EmittedTypeReference } from "../generator/analyzeDemandSupply/types.js";
import type { ResolvedScanDir } from "../generator/manifestPaths.js";
import { resolveDeclaredBaseType } from "./baseTypeAssignability.js";

export type BoundedGroupCollectionContext = {
  program: ts.Program;
  generatedDir: string;
  scanDirs: readonly ResolvedScanDir[];
  projectRoot: string;
};

const declarationSourceFile = (type: ts.Type): ts.SourceFile | undefined =>
  (type.aliasSymbol ?? type.getSymbol())?.declarations?.[0]?.getSourceFile();

const mergeImports = (
  refs: readonly EmittedTypeReference[],
): EmittedTypeReference["imports"] => {
  const seen = new Set<string>();
  const out: EmittedTypeReference["imports"][number][] = [];
  for (const ref of refs) {
    for (const imp of ref.imports) {
      const key = `${imp.relImport}\0${imp.typeName}\0${imp.useDefaultImport}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push(imp);
      }
    }
  }
  return out;
};

/**
 * For each collection group whose root carries a `baseTypeArg`, resolves `baseType` and the declared
 * arg, emits `Base<declaredArg>` (name + imports), and returns it keyed by group name. Groups without
 * a declared arg (non-generic, or defaulted base omitting the arg) are absent from the map and keep
 * the default per-member-union emission. Unresolvable base/arg entries are skipped (the group plan's
 * own gate already errored on genuinely bad config before this runs).
 */
export const buildBoundedGroupCollectionTypeRefs = (
  groupsManifest: IocGroupsManifest | undefined,
  ctx: BoundedGroupCollectionContext,
): Map<string, EmittedTypeReference> => {
  const out = new Map<string, EmittedTypeReference>();
  if (groupsManifest === undefined) {
    return out;
  }

  const checker = ctx.program.getTypeChecker();

  for (const [groupName, root] of Object.entries(groupsManifest)) {
    if (root.kind !== "collection" || root.baseTypeArg === undefined) {
      continue;
    }

    const base = resolveDeclaredBaseType(ctx.program, checker, root.baseType);
    const arg = resolveDeclaredBaseType(ctx.program, checker, root.baseTypeArg);
    if (!base.ok || !arg.ok) {
      continue;
    }

    const contextSourceFile =
      declarationSourceFile(base.type) ?? declarationSourceFile(arg.type);
    if (contextSourceFile === undefined) {
      continue;
    }

    const emitCtx: EmitTypeReferenceContext = {
      program: ctx.program,
      projectRoot: ctx.projectRoot,
      scanDirs: [...ctx.scanDirs],
      generatedDir: ctx.generatedDir,
      contextSourceFile,
    };

    const baseEmit = emitTypeReference(checker, base.type, emitCtx);
    const argEmit = emitTypeReference(checker, arg.type, emitCtx);
    if (baseEmit === undefined || argEmit === undefined) {
      continue;
    }

    out.set(groupName, {
      typeName: `${baseEmit.typeName}<${argEmit.typeName}>`,
      imports: mergeImports([baseEmit, argEmit]),
    });
  }

  return out;
};
