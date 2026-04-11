import path from "node:path";
import ts from "typescript";
import type { ResolvedScanDir } from "./manifestPaths.js";

const getTopLevelTypeDeclaration = (
  sourceFile: ts.SourceFile,
  typeName: string,
): ts.InterfaceDeclaration | ts.TypeAliasDeclaration | undefined => {
  for (const stmt of sourceFile.statements) {
    if (ts.isInterfaceDeclaration(stmt) && stmt.name.text === typeName) {
      if (stmt.parent === sourceFile) {
        return stmt;
      }
    }
    if (ts.isTypeAliasDeclaration(stmt) && stmt.name.text === typeName) {
      if (stmt.parent === sourceFile) {
        return stmt;
      }
    }
  }
  return undefined;
};

const matchSourceFileByAbsoluteBase = (
  program: ts.Program,
  baseAbs: string,
): ts.SourceFile | undefined => {
  const candidates = [
    `${baseAbs}.ts`,
    `${baseAbs}.tsx`,
    path.join(baseAbs, "index.ts"),
    path.join(baseAbs, "index.tsx"),
  ];
  const normalizedCandidates = candidates.map((c) => path.normalize(c));
  const files = program.getSourceFiles();
  for (const cand of normalizedCandidates) {
    const hit = files.find((sf) => path.normalize(sf.fileName) === cand);
    if (hit !== undefined) {
      return hit;
    }
  }
  const lower = new Set(normalizedCandidates.map((c) => c.toLowerCase()));
  const caseHit = files.find((sf) =>
    lower.has(path.normalize(sf.fileName).toLowerCase()),
  );
  if (caseHit !== undefined) {
    return caseHit;
  }
  return undefined;
};

/**
 * When {@link importMode} is `root`, the emitted specifier is only `importPrefix`. Find the unique
 * source file under the scan root that declares `contractName` as a top-level interface or type alias.
 */
const findUniqueContractDeclarationSourceUnderScanRoot = (
  program: ts.Program,
  scanRootAbs: string,
  contractName: string,
): ts.SourceFile | undefined => {
  const normRoot = path.normalize(scanRootAbs);
  const hits: ts.SourceFile[] = [];

  for (const sf of program.getSourceFiles()) {
    if (sf.fileName.includes(`${path.sep}node_modules${path.sep}`)) {
      continue;
    }
    const norm = path.normalize(sf.fileName);
    const under =
      norm === normRoot || norm.startsWith(`${normRoot}${path.sep}`);
    if (!under) {
      continue;
    }
    if (getTopLevelTypeDeclaration(sf, contractName) !== undefined) {
      hits.push(sf);
    }
  }

  if (hits.length === 1) {
    return hits[0];
  }
  return undefined;
};

const tryResolveRootModeSpecifier = (
  program: ts.Program,
  entry: ResolvedScanDir & { importPrefix: string },
  contractName: string | undefined,
): ts.SourceFile | undefined => {
  if (contractName !== undefined) {
    const unique = findUniqueContractDeclarationSourceUnderScanRoot(
      program,
      entry.absPath,
      contractName,
    );
    if (unique !== undefined) {
      return unique;
    }
  }
  for (const rel of ["index.ts", "index.tsx", "src/index.ts", "src/index.tsx"]) {
    const full = path.normalize(path.join(entry.absPath, rel));
    const baseAbs = full.replace(/\.tsx?$/i, "");
    const hit = matchSourceFileByAbsoluteBase(program, baseAbs);
    if (hit !== undefined) {
      return hit;
    }
  }
  return undefined;
};

/**
 * Locates the source file for a contract type import path as stored on registration plans:
 * relative to {@link generatedDir}, or a workspace/package alias when {@link scanDirs} defines
 * `importPrefix` / `importMode` (see {@link computeManifestModuleSpecifier}).
 */
export const resolveContractTypeSourceFile = (
  program: ts.Program,
  generatedDir: string,
  contractTypeRelImport: string,
  scanDirs: readonly ResolvedScanDir[] | undefined,
  contractName?: string,
): ts.SourceFile | undefined => {
  const entries = scanDirs ?? [];
  const withoutJs = contractTypeRelImport.replace(/\.js$/i, "");
  const isRelativeSpecifier =
    contractTypeRelImport.startsWith("./") ||
    contractTypeRelImport.startsWith("../");

  if (isRelativeSpecifier) {
    const raw = contractTypeRelImport.replace(/^\.\//, "").replace(/\.js$/i, "");
    const baseAbs = path.resolve(generatedDir, raw);
    return matchSourceFileByAbsoluteBase(program, baseAbs);
  }

  const prefixed = entries
    .filter(
      (
        e,
      ): e is ResolvedScanDir & {
        importPrefix: string;
        importMode: "root" | "subpath";
      } =>
        e.importPrefix !== undefined && e.importMode !== undefined,
    )
    .sort((a, b) => b.importPrefix.length - a.importPrefix.length);

  for (const entry of prefixed) {
    const p = entry.importPrefix;
    if (entry.importMode === "subpath") {
      const prefixSlash = `${p}/`;
      if (withoutJs.startsWith(prefixSlash)) {
        const remainder = withoutJs.slice(prefixSlash.length);
        if (remainder.length === 0) {
          continue;
        }
        const nativeRel = remainder.split("/").join(path.sep);
        const baseAbs = path.normalize(path.join(entry.absPath, nativeRel));
        return matchSourceFileByAbsoluteBase(program, baseAbs);
      }
    } else if (entry.importMode === "root") {
      if (withoutJs === p) {
        return tryResolveRootModeSpecifier(program, entry, contractName);
      }
    }
  }

  return undefined;
};

const hasExplicitNamedExportOfContract = (
  sourceFile: ts.SourceFile,
  contractName: string,
): boolean => {
  for (const stmt of sourceFile.statements) {
    if (ts.isExportDeclaration(stmt) && stmt.exportClause !== undefined) {
      if (ts.isNamedExports(stmt.exportClause)) {
        for (const el of stmt.exportClause.elements) {
          if (el.name.text === contractName) {
            return true;
          }
        }
      }
    }
    if (ts.isClassDeclaration(stmt) && stmt.name?.text === contractName) {
      const hasExport = stmt.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.ExportKeyword,
      );
      const hasDefault = stmt.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.DefaultKeyword,
      );
      if (hasExport === true && hasDefault !== true) {
        return true;
      }
    }
    if (ts.isInterfaceDeclaration(stmt) && stmt.name.text === contractName) {
      if (
        stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ===
        true
      ) {
        return true;
      }
    }
    if (ts.isTypeAliasDeclaration(stmt) && stmt.name.text === contractName) {
      if (
        stmt.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ===
        true
      ) {
        return true;
      }
    }
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === contractName) {
      const hasExport = stmt.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.ExportKeyword,
      );
      const hasDefault = stmt.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.DefaultKeyword,
      );
      if (hasExport === true && hasDefault !== true) {
        return true;
      }
    }
  }
  return false;
};

const defaultExportProvidesContract = (
  sourceFile: ts.SourceFile,
  contractName: string,
): boolean => {
  for (const stmt of sourceFile.statements) {
    if (ts.isClassDeclaration(stmt) && stmt.name?.text === contractName) {
      const hasExport = stmt.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.ExportKeyword,
      );
      const hasDefault = stmt.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.DefaultKeyword,
      );
      if (hasExport === true && hasDefault === true) {
        return true;
      }
    }
    if (ts.isFunctionDeclaration(stmt) && stmt.name?.text === contractName) {
      const hasExport = stmt.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.ExportKeyword,
      );
      const hasDefault = stmt.modifiers?.some(
        (m) => m.kind === ts.SyntaxKind.DefaultKeyword,
      );
      if (hasExport === true && hasDefault === true) {
        return true;
      }
    }
    if (
      ts.isExportAssignment(stmt) &&
      ts.isIdentifier(stmt.expression) &&
      stmt.expression.text === contractName
    ) {
      return true;
    }
  }
  return false;
};

/**
 * True when {@link contractName} is provided only via the module's default export (including
 * `export default class Name`, `export default Name`, or `export = Name`), and not via a separate
 * named export `{ contractName }`. Then `ioc-registry.types.ts` must use
 * `import type Name from "..."` instead of `import type { Name } from "..."`.
 */
export const cradleTypeImportUsesDefaultExport = (
  sourceFile: ts.SourceFile,
  contractName: string,
): boolean => {
  if (hasExplicitNamedExportOfContract(sourceFile, contractName)) {
    return false;
  }
  return defaultExportProvidesContract(sourceFile, contractName);
};
