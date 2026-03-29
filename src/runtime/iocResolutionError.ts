import { AwilixResolutionError } from "awilix";
import type { IocResolutionFrame } from "./iocResolutionStack.js";
import type { RegistrationKeyIndex } from "./registrationKeyIndex.js";

export type ResolutionFrame = {
  contractName: string;
  implementationName?: string;
  sourceFile?: string;
  /** Awilix registration key when known (used to merge stacks without duplicating frames). */
  registrationKey?: string;
};

export type IocResolutionFailureType = "missing" | "threw" | "cyclic" | "lifetime";

const registrationKeyOf = (f: ResolutionFrame): string =>
  f.registrationKey ?? f.contractName;

/**
 * Merges an ancestor IoC stack with frames already on an error so parents appear once at the front.
 */
export const mergeFrameSequences = (
  ancestorPrefix: readonly ResolutionFrame[],
  existing: readonly ResolutionFrame[],
): ResolutionFrame[] => {
  if (ancestorPrefix.length === 0) {
    return [...existing];
  }
  let k = 0;
  const n = Math.min(ancestorPrefix.length, existing.length);
  while (
    k < n &&
    registrationKeyOf(ancestorPrefix[k]!) === registrationKeyOf(existing[k]!)
  ) {
    k += 1;
  }
  if (k === ancestorPrefix.length) {
    return [...existing];
  }
  return [...ancestorPrefix, ...existing.slice(k)];
};

const stackFrameToResolutionFrame = (f: IocResolutionFrame): ResolutionFrame => ({
  contractName: f.contractName,
  implementationName: f.implementationName,
  sourceFile: f.sourceFile,
  registrationKey: f.registrationKey,
});

const frameFromRegistrationKey = (
  key: string,
  keyIndex: RegistrationKeyIndex,
): ResolutionFrame => {
  const meta = keyIndex.metaByRegistrationKey.get(key);
  if (meta !== undefined) {
    return {
      contractName: meta.contractName,
      implementationName: meta.implementationName,
      sourceFile:
        meta.sourceFilePath !== undefined && meta.sourceFilePath.length > 0
          ? meta.sourceFilePath
          : meta.modulePath,
      registrationKey: key,
    };
  }
  const contract = keyIndex.contractByAccessKey.get(key);
  if (contract !== undefined) {
    return {
      contractName: contract,
      registrationKey: key,
    };
  }
  return { contractName: key, registrationKey: key };
};

const parseAwilixResolutionPath = (message: string): string[] | undefined => {
  const m = message.match(/Resolution path:\s*(.+?)(?:\r?\n|$)/);
  if (m === null || m[1] === undefined) {
    return undefined;
  }
  const parts = m[1]
    .split("->")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return parts.length > 0 ? parts : undefined;
};

const classifyAwilixResolutionError = (
  message: string,
): "cyclic" | "lifetime" | "missing" => {
  if (message.includes("Cyclic dependencies detected")) {
    return "cyclic";
  }
  if (message.includes("has a shorter lifetime than its ancestor")) {
    return "lifetime";
  }
  return "missing";
};

const describeFrameLine = (
  frame: ResolutionFrame,
  keyIndex: RegistrationKeyIndex,
): string => {
  const key = frame.registrationKey;
  if (key !== undefined) {
    const meta = keyIndex.metaByRegistrationKey.get(key);
    if (meta !== undefined) {
      const src =
        meta.sourceFilePath !== undefined && meta.sourceFilePath.length > 0
          ? meta.sourceFilePath
          : meta.modulePath;
      const fileSuffix = src.length > 0 ? ` [${src}]` : "";
      return `${meta.contractName} (${meta.implementationName})${fileSuffix}`;
    }
    const contract = keyIndex.contractByAccessKey.get(key);
    if (contract !== undefined) {
      return `${contract} (contract default slot ${JSON.stringify(key)})`;
    }
    return key;
  }
  const file =
    frame.sourceFile !== undefined && frame.sourceFile.length > 0
      ? ` [${frame.sourceFile}]`
      : "";
  const impl =
    frame.implementationName !== undefined && frame.implementationName.length > 0
      ? ` (${frame.implementationName})`
      : "";
  return `${frame.contractName}${impl}${file}`;
};

const formatHeadline = (
  frames: readonly ResolutionFrame[],
  keyIndex: RegistrationKeyIndex,
): string => {
  const first = frames[0];
  if (first === undefined) {
    return "Container resolution failed.";
  }
  const key = first.registrationKey;
  if (key !== undefined) {
    const meta = keyIndex.metaByRegistrationKey.get(key);
    if (meta !== undefined) {
      return `Cannot build ${meta.contractName} using implementation ${meta.implementationName}.`;
    }
    const contract = keyIndex.contractByAccessKey.get(key);
    if (contract !== undefined) {
      return `Cannot resolve ${contract} (contract default slot ${JSON.stringify(key)}).`;
    }
  }
  if (
    first.implementationName !== undefined &&
    first.implementationName.length > 0
  ) {
    return `Cannot build ${first.contractName} using implementation ${first.implementationName}.`;
  }
  return `Cannot build ${first.contractName}.`;
};

const formatResolutionChainBlock = (
  err: IocResolutionError,
  keyIndex: RegistrationKeyIndex,
): string => {
  const frames = err.frames;
  if (frames.length === 0) {
    if (err.failureType === "threw") {
      const detail = err.throwDetail ?? err.cause?.message ?? "unknown error";
      return `Resolution chain:\n    ✖ factory threw while building: ${detail}\n`;
    }
    return `Resolution chain:\n    ✖ ${err.awilixDetail ?? "resolution failed"}\n`;
  }

  if (err.failureType === "missing") {
    if (frames.length === 1) {
      return `Resolution chain:\n    ${describeFrameLine(frames[0]!, keyIndex)} ✖ no registered implementation\n`;
    }
    let out = "Resolution chain:\n";
    for (let i = 0; i < frames.length - 1; i++) {
      const pad = "  ".repeat(i + 1);
      const conn = i === 0 ? "" : "-> ";
      out += `${pad}${conn}${describeFrameLine(frames[i]!, keyIndex)}\n`;
    }
    const last = frames[frames.length - 1]!;
    const lastPad = "  ".repeat(frames.length);
    out += `${lastPad}-> ${describeFrameLine(last, keyIndex)} ✖ no registered implementation\n`;
    return out;
  }

  if (err.failureType === "cyclic") {
    return formatChainWithUniformLeaf(
      frames,
      keyIndex,
      "✖ cyclic dependency detected",
    );
  }

  if (err.failureType === "lifetime") {
    return formatChainWithUniformLeaf(
      frames,
      keyIndex,
      "✖ dependency lifetime is shorter than an ancestor (strict mode)",
    );
  }

  const detail = err.throwDetail ?? err.cause?.message ?? "unknown error";
  let out = "Resolution chain:\n";
  for (let i = 0; i < frames.length; i++) {
    const pad = "  ".repeat(i + 1);
    const conn = i === 0 ? "" : "-> ";
    out += `${pad}${conn}${describeFrameLine(frames[i]!, keyIndex)}\n`;
  }
  const leafPad = "  ".repeat(frames.length + 1);
  out += `${leafPad}✖ factory threw while building: ${detail}\n`;
  return out;
};

const formatChainWithUniformLeaf = (
  frames: readonly ResolutionFrame[],
  keyIndex: RegistrationKeyIndex,
  leafText: string,
): string => {
  if (frames.length === 0) {
    return `Resolution chain:\n    ${leafText}\n`;
  }
  if (frames.length === 1) {
    return `Resolution chain:\n    ${describeFrameLine(frames[0]!, keyIndex)} ${leafText}\n`;
  }
  let out = "Resolution chain:\n";
  for (let i = 0; i < frames.length - 1; i++) {
    const pad = "  ".repeat(i + 1);
    const conn = i === 0 ? "" : "-> ";
    out += `${pad}${conn}${describeFrameLine(frames[i]!, keyIndex)}\n`;
  }
  const last = frames[frames.length - 1]!;
  const lastPad = "  ".repeat(frames.length);
  out += `${lastPad}-> ${describeFrameLine(last, keyIndex)} ${leafText}\n`;
  return out;
};

/**
 * Builds the final user-facing message from structured data (single formatting site).
 */
export const formatIocResolutionErrorMessage = (
  err: IocResolutionError,
  keyIndex: RegistrationKeyIndex,
): string => {
  const headline = formatHeadline(err.frames, keyIndex);
  const chain = formatResolutionChainBlock(err, keyIndex);
  return `[ioc] ${headline}\n\n${chain}`.trimEnd();
};

export class IocResolutionError extends Error {
  frames: ResolutionFrame[];
  readonly failureType: IocResolutionFailureType;
  override cause?: Error;
  /** Set when failureType === "threw" (plain message, not another IocResolutionError string). */
  throwDetail?: string;
  /** Awilix diagnostic when failureType is cyclic or lifetime. */
  awilixDetail?: string;

  constructor(init: {
    frames: ResolutionFrame[];
    failureType: IocResolutionFailureType;
    cause?: Error;
    throwDetail?: string;
    awilixDetail?: string;
    message?: string;
  }) {
    super(init.message ?? "");
    this.name = "IocResolutionError";
    this.frames = [...init.frames];
    this.failureType = init.failureType;
    this.cause = init.cause;
    this.throwDetail = init.throwDetail;
    this.awilixDetail = init.awilixDetail;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export const isIocResolutionError = (e: unknown): e is IocResolutionError =>
  e instanceof IocResolutionError;

const createFromAwilix = (
  cause: AwilixResolutionError,
  keyIndex: RegistrationKeyIndex,
  stackSnapshot: readonly IocResolutionFrame[],
): IocResolutionError => {
  const path = parseAwilixResolutionPath(cause.message);
  const kind = classifyAwilixResolutionError(cause.message);
  const failureType: IocResolutionFailureType =
    kind === "cyclic"
      ? "cyclic"
      : kind === "lifetime"
        ? "lifetime"
        : "missing";

  const pathFrames: ResolutionFrame[] | undefined =
    path !== undefined
      ? path.map((key) => frameFromRegistrationKey(key, keyIndex))
      : undefined;

  const stackFrames = stackSnapshot.map(stackFrameToResolutionFrame);

  const frames =
    pathFrames !== undefined && pathFrames.length > 0
      ? mergeFrameSequences(stackFrames, pathFrames)
      : stackFrames;

  return new IocResolutionError({
    frames,
    failureType,
    cause,
    awilixDetail: cause.message.trim(),
  });
};

const createFromFactoryThrow = (
  cause: unknown,
  stackSnapshot: readonly IocResolutionFrame[],
): IocResolutionError => {
  const frames = stackSnapshot.map(stackFrameToResolutionFrame);
  const orig =
    cause instanceof Error
      ? cause
      : new Error(typeof cause === "string" ? cause : String(cause));
  const throwDetail =
    orig.message.length > 0 ? orig.message : String(cause);

  return new IocResolutionError({
    frames,
    failureType: "threw",
    cause: cause instanceof Error ? cause : orig,
    throwDetail,
  });
};

/**
 * Normalizes any thrown value into an {@link IocResolutionError} without formatting nested IoC errors as strings.
 */
export const createIocResolutionError = (
  cause: unknown,
  keyIndex: RegistrationKeyIndex,
  stackSnapshot: readonly IocResolutionFrame[],
): IocResolutionError => {
  if (cause instanceof IocResolutionError) {
    return cause;
  }
  if (cause instanceof AwilixResolutionError) {
    return createFromAwilix(cause, keyIndex, stackSnapshot);
  }
  return createFromFactoryThrow(cause, stackSnapshot);
};

/**
 * Merges the current IoC stack into an existing resolution error and refreshes {@link Error.message} once.
 */
export const mergeAncestorStackIntoResolutionError = (
  err: IocResolutionError,
  ancestorStack: readonly IocResolutionFrame[],
): void => {
  const ancestors = ancestorStack.map(stackFrameToResolutionFrame);
  err.frames = mergeFrameSequences(ancestors, err.frames);
};

export const applyIocResolutionErrorMessage = (
  err: IocResolutionError,
  keyIndex: RegistrationKeyIndex,
): void => {
  err.message = formatIocResolutionErrorMessage(err, keyIndex);
};

/**
 * Single entry from factory/collection/group boundaries: structured propagation, no nested string wrapping.
 */
export const propagateIocResolutionFailure = (params: {
  cause: unknown;
  keyIndex: RegistrationKeyIndex;
  stackSnapshot: readonly IocResolutionFrame[];
}): never => {
  const { cause, keyIndex, stackSnapshot } = params;

  if (isIocResolutionError(cause)) {
    mergeAncestorStackIntoResolutionError(cause, stackSnapshot);
    applyIocResolutionErrorMessage(cause, keyIndex);
    throw cause;
  }

  const err = createIocResolutionError(cause, keyIndex, stackSnapshot);
  applyIocResolutionErrorMessage(err, keyIndex);
  throw err;
};
