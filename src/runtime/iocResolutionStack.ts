import type { ModuleFactoryManifestMetadata } from "../core/manifest.js";

/**
 * Lightweight resolution stack used while factories, multi-implementation collections, and
 * group resolvers run. Frames are pushed before invoking user code and popped in `finally`
 * so `snapshotIocResolutionStack` captures the path leading to failures.
 *
 * Note: this is a module-level array (not true async context isolation). It is safe under
 * Node’s single-threaded event loop as long as resolution does not `await` between push
 * and pop; avoid yielding inside factory bodies if you rely on stack accuracy.
 */
export type IocResolutionFrame = {
  contractName: string;
  implementationName: string;
  registrationKey: string;
  modulePath?: string;
};

/**
 * `implementationName` a group-hop frame carries, so rendering can tell it from a unit frame.
 *
 * A group root has no implementation — it is the hop from a group value into one of its members —
 * and the chain reads better saying so than printing the bare cradle key.
 */
export const IOC_GROUP_FRAME_IMPLEMENTATION_NAME = "(group)";

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
