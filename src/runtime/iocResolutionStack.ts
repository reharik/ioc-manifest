import type { ModuleFactoryManifestMetadata } from "../core/manifest.js";

export type IocResolutionFrame = {
  contractName: string;
  implementationName: string;
  registrationKey: string;
  modulePath?: string;
};

const stack: IocResolutionFrame[] = [];

export const pushIocResolutionFrame = (frame: IocResolutionFrame): void => {
  stack.push(frame);
};

export const popIocResolutionFrame = (): void => {
  stack.pop();
};

export const snapshotIocResolutionStack = (): readonly IocResolutionFrame[] => [
  ...stack,
];

export const frameFromManifestMeta = (
  meta: ModuleFactoryManifestMetadata,
): IocResolutionFrame => ({
  contractName: meta.contractName,
  implementationName: meta.implementationName,
  registrationKey: meta.registrationKey,
  modulePath: meta.modulePath,
});
