/**
 * @fileoverview Reads the property names and declared type TEXT off an interface in a generated
 * `ioc-registry.types.ts` — `IocGeneratedCradle` and `IocExternals`.
 *
 * Text, not types: this is a syntactic pass over one file, used for the key SETS every check
 * reasons about and for the human-readable rendering when no checker is available. The
 * authoritative type answers come from {@link ./typeComparison.js}, reading the shared program.
 *
 * The manifest itself is NOT parsed here. It used to be, by a second, lesser parser that lived
 * beside this one and recovered only `registrationKey` and `default` per implementation and only
 * `registrationKey` per group member — which silently cost the grouped-contract rules their member
 * `contractName`s. There is one manifest parser now, `generator/parseGeneratedManifestSource.ts`,
 * and the composition context projects what it needs out of that.
 */
import ts from "typescript";

const readPropertyName = (name: ts.PropertyName): string | undefined => {
  if (ts.isIdentifier(name)) {
    return name.text;
  }
  if (ts.isStringLiteral(name) || ts.isNoSubstitutionTemplateLiteral(name)) {
    return name.text;
  }
  return undefined;
};

const findInterfaceBody = (
  sourceFile: ts.SourceFile,
  interfaceName: string,
): ts.InterfaceDeclaration | undefined => {
  let found: ts.InterfaceDeclaration | undefined;

  const visit = (node: ts.Node): void => {
    if (found !== undefined) {
      return;
    }
    if (ts.isInterfaceDeclaration(node) && node.name.text === interfaceName) {
      found = node;
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return found;
};

export const parseInterfacePropertyNames = (
  content: string,
  filePath: string,
  interfaceName: string,
): ReadonlyMap<string, string> => {
  const sourceFile = ts.createSourceFile(
    filePath,
    content,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const iface = findInterfaceBody(sourceFile, interfaceName);
  const result = new Map<string, string>();
  if (iface === undefined) {
    return result;
  }

  for (const member of iface.members) {
    if (!ts.isPropertySignature(member) || member.name === undefined) {
      continue;
    }
    const key = readPropertyName(member.name);
    if (key === undefined) {
      continue;
    }
    const typeText =
      member.type !== undefined
        ? member.type.getText(sourceFile).trim()
        : "unknown";
    result.set(key, typeText);
  }

  return result;
};
