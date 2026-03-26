import path from "node:path";
import ts from "typescript";
import type { IocConfig } from "../../config/iocConfig.js";
import type { DiscoveredFactory } from "../types.js";
import type { FactoryDiscoveryPaths } from "../manifestPaths.js";
import { scanFactoryFile } from "./scanFactoryFile.js";

const normalizePath = (p: string): string => path.normalize(p);

const buildSourceFileIndex = (program: ts.Program): Map<string, ts.SourceFile> => {
  const index = new Map<string, ts.SourceFile>();
  for (const sf of program.getSourceFiles()) {
    index.set(normalizePath(sf.fileName), sf);
  }
  return index;
};

export const discoverFactories = (
  files: string[],
  program: ts.Program,
  projectRoot: string,
  factoryPrefix: string,
  discoveryPaths: FactoryDiscoveryPaths,
  iocConfig?: IocConfig,
) => {
  const checker = program.getTypeChecker();
  const sourceFileByPath = buildSourceFileIndex(program);
  const contractMap = new Map<string, Map<string, DiscoveredFactory>>();
  const registrationKeyOwner = new Map<
    string,
    { modulePath: string; exportName: string }
  >();
  const acceptedFactories: DiscoveredFactory[] = [];

  for (const abs of files.sort((a, b) => a.localeCompare(b))) {
    const sourceFile = sourceFileByPath.get(normalizePath(abs));
    if (!sourceFile) {
      throw new Error(
        `[ioc] File is not in the TypeScript program (cannot type-check): "${path.relative(projectRoot, abs)}". It may be excluded from tsconfig "include" or matched only by discovery globs — add it to the project or adjust tsconfig.`,
      );
    }
    const fileContext = {
      absPath: abs,
      sourceFile,
      projectRoot,
      factoryPrefix,
      iocConfig,
      paths: {
        srcDir: discoveryPaths.srcDir,
        generatedDir: discoveryPaths.generatedDir,
      },
    };

    const discovered = scanFactoryFile(fileContext, checker);

    for (const f of discovered) {
      const existingOwner = registrationKeyOwner.get(f.registrationKey);
      if (existingOwner !== undefined) {
        throw new Error(
          `[ioc] Duplicate registration key ${JSON.stringify(f.registrationKey)}: first export "${existingOwner.exportName}" in "${existingOwner.modulePath}", second export "${f.exportName}" in "${f.modulePath}". Rename exports or adjust ioc.config registrations[contract][implementation].name so Awilix registration keys are globally unique.`,
        );
      }

      const impls =
        contractMap.get(f.contractName) ?? new Map<string, DiscoveredFactory>();
      if (impls.has(f.implementationName)) {
        const existing = impls.get(f.implementationName)!;
        throw new Error(
          `[ioc] Duplicate implementation name ${JSON.stringify(f.implementationName)} for contract "${f.contractName}": first "${existing.exportName}" in "${existing.modulePath}", second "${f.exportName}" in "${f.modulePath}". Implementation names must be unique per contract.`,
        );
      }

      impls.set(f.implementationName, f);
      contractMap.set(f.contractName, impls);
      registrationKeyOwner.set(f.registrationKey, {
        modulePath: f.modulePath,
        exportName: f.exportName,
      });
      acceptedFactories.push(f);
    }
  }
  return { contractMap, acceptedFactories };
};
