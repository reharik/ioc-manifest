import { AwilixResolutionError } from "awilix";
import {
  IOC_GROUP_FRAME_IMPLEMENTATION_NAME,
  type IocResolutionFrame,
} from "./iocResolutionStack.js";
import type { RegistrationKeyIndex } from "./registrationKeyIndex.js";

export type ResolutionFrame = {
  contractName: string;
  implementationName?: string;
  modulePath?: string;
  /** Awilix registration key when known (used to merge stacks without duplicating frames). */
  registrationKey?: string;
};

export type IocResolutionFailureType =
  | "missing"
  | "threw"
  | "cyclic"
  | "lifetime";

/**
 * The group hop a failure surfaced through: which group root, and which member slot was read.
 *
 * Recorded only when a cyclic failure comes out of a group's member accessor. Group member
 * properties resolve lazily (see `bootstrap.ts`), so the only way a group can still participate in
 * a cycle is for a member property to be READ while the reader is itself still being constructed —
 * which is a real cycle, not one manufactured by eager building. Carrying the hop lets the single
 * formatting site say so.
 */
export type IocResolutionGroupHop = {
  groupKey: string;
  /** Object-group property name, or `[i]` for a collection slot. */
  memberLabel: string;
};

/** `writeServices.toggleReaction` for an object group, `loggers[0]` for a collection. */
const describeGroupMemberRead = (hop: IocResolutionGroupHop): string =>
  hop.memberLabel.startsWith("[")
    ? `${hop.groupKey}${hop.memberLabel}`
    : `${hop.groupKey}.${hop.memberLabel}`;

const isGroupFrame = (frame: ResolutionFrame): boolean =>
  frame.implementationName === IOC_GROUP_FRAME_IMPLEMENTATION_NAME &&
  frame.registrationKey === frame.contractName;

const registrationKeyOf = (frame: ResolutionFrame): string =>
  frame.registrationKey ?? frame.contractName;

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

  let matchCount = 0;
  const maxSharedPrefix = Math.min(ancestorPrefix.length, existing.length);

  while (
    matchCount < maxSharedPrefix &&
    registrationKeyOf(ancestorPrefix[matchCount]!) ===
      registrationKeyOf(existing[matchCount]!)
  ) {
    matchCount += 1;
  }

  if (matchCount === ancestorPrefix.length) {
    return [...existing];
  }

  return [...ancestorPrefix, ...existing.slice(matchCount)];
};

const stackFrameToResolutionFrame = (
  frame: IocResolutionFrame,
): ResolutionFrame => ({
  contractName: frame.contractName,
  implementationName: frame.implementationName,
  modulePath: frame.modulePath,
  registrationKey: frame.registrationKey,
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
      modulePath: meta.modulePath,
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
  const match = message.match(/Resolution path:\s*(.+?)(?:\r?\n|$)/);
  if (match === null || match[1] === undefined) {
    return undefined;
  }

  const parts = match[1]
    .split("->")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

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

  /* Ahead of the key lookups: a group root claims a cradle key that is neither a registration nor a
     slot, so without this the hop renders as the bare key and reads like a missing unit. */
  if (isGroupFrame(frame)) {
    return `${frame.contractName} ${IOC_GROUP_FRAME_IMPLEMENTATION_NAME}`;
  }

  if (key !== undefined) {
    const meta = keyIndex.metaByRegistrationKey.get(key);
    if (meta !== undefined) {
      const fileSuffix =
        meta.modulePath.length > 0 ? ` [${meta.modulePath}]` : "";
      return `${meta.contractName} (${meta.implementationName})${fileSuffix}`;
    }

    const contract = keyIndex.contractByAccessKey.get(key);
    if (contract !== undefined) {
      return `${contract} (contract default slot ${JSON.stringify(key)})`;
    }

    return key;
  }

  const fileSuffix =
    frame.modulePath !== undefined && frame.modulePath.length > 0
      ? ` [${frame.modulePath}]`
      : "";
  const implementationSuffix =
    frame.implementationName !== undefined &&
    frame.implementationName.length > 0
      ? ` (${frame.implementationName})`
      : "";

  return `${frame.contractName}${implementationSuffix}${fileSuffix}`;
};

const formatHeadline = (
  frames: readonly ResolutionFrame[],
  keyIndex: RegistrationKeyIndex,
): string => {
  const first = frames[0];
  if (first === undefined) {
    return "Container resolution failed.";
  }

  if (isGroupFrame(first)) {
    return `Cannot resolve group ${JSON.stringify(first.contractName)}.`;
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

  for (let i = 0; i < frames.length - 1; i += 1) {
    const pad = "  ".repeat(i + 1);
    const connector = i === 0 ? "" : "-> ";
    out += `${pad}${connector}${describeFrameLine(frames[i]!, keyIndex)}\n`;
  }

  const last = frames[frames.length - 1]!;
  const lastPad = "  ".repeat(frames.length);
  out += `${lastPad}-> ${describeFrameLine(last, keyIndex)} ${leafText}\n`;

  return out;
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

    for (let i = 0; i < frames.length - 1; i += 1) {
      const pad = "  ".repeat(i + 1);
      const connector = i === 0 ? "" : "-> ";
      out += `${pad}${connector}${describeFrameLine(frames[i]!, keyIndex)}\n`;
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

  for (let i = 0; i < frames.length; i += 1) {
    const pad = "  ".repeat(i + 1);
    const connector = i === 0 ? "" : "-> ";
    out += `${pad}${connector}${describeFrameLine(frames[i]!, keyIndex)}\n`;
  }

  const leafPad = "  ".repeat(frames.length + 1);
  out += `${leafPad}✖ factory threw while building: ${detail}\n`;

  return out;
};

/**
 * The one thing a cycle through a group hop can mean, plus the fix.
 *
 * Not new cycle detection — the cycle is Awilix's, reported by Awilix. This only names the shape it
 * almost always has, because after member properties went lazy the eager-construction cycle stopped
 * existing and construction-time member reads are what is left.
 */
const formatGroupHopNote = (hop: IocResolutionGroupHop): string =>
  [
    "",
    `A member of group ${JSON.stringify(hop.groupKey)} was read during construction.`,
    `  Reading ${describeGroupMemberRead(hop)} builds that member right there, and building it led`,
    "  back to the unit that was still being constructed.",
    "",
    "Read group members at CALL time — inside the function or method you return — rather than at the",
    "top level of the factory body. Holding the group itself costs nothing: the group value is inert",
    "until a member property is read, so demanding or destructuring it constructs no members.",
  ].join("\n");

/**
 * Builds the final user-facing message from structured data (single formatting site).
 */
export const formatIocResolutionErrorMessage = (
  err: IocResolutionError,
  keyIndex: RegistrationKeyIndex,
): string => {
  const headline = formatHeadline(err.frames, keyIndex);
  const chain = formatResolutionChainBlock(err, keyIndex);
  const note =
    err.groupHop !== undefined ? formatGroupHopNote(err.groupHop) : "";
  return `[ioc] ${headline}\n\n${chain}${note}`.trimEnd();
};

export class IocResolutionError extends Error {
  frames: ResolutionFrame[];
  readonly failureType: IocResolutionFailureType;
  override cause?: Error;
  /** Set when failureType === "threw" (plain message, not another IocResolutionError string). */
  throwDetail?: string;
  /** Awilix diagnostic when failureType is cyclic or lifetime. */
  awilixDetail?: string;
  /** Set when a cyclic failure surfaced through a group's member accessor (innermost hop wins). */
  groupHop?: IocResolutionGroupHop;

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

export const isIocResolutionError = (
  value: unknown,
): value is IocResolutionError => value instanceof IocResolutionError;

const createFromAwilix = (
  cause: AwilixResolutionError,
  keyIndex: RegistrationKeyIndex,
  stackSnapshot: readonly IocResolutionFrame[],
): IocResolutionError => {
  const path = parseAwilixResolutionPath(cause.message);
  const kind = classifyAwilixResolutionError(cause.message);

  const failureType: IocResolutionFailureType =
    kind === "cyclic" ? "cyclic" : kind === "lifetime" ? "lifetime" : "missing";

  const pathFrames =
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
  const original =
    cause instanceof Error
      ? cause
      : new Error(typeof cause === "string" ? cause : String(cause));

  const throwDetail =
    original.message.length > 0 ? original.message : String(cause);

  return new IocResolutionError({
    frames,
    failureType: "threw",
    cause: cause instanceof Error ? cause : original,
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
  /** Passed only by a group member accessor; recorded only for a cyclic failure. */
  groupHop?: IocResolutionGroupHop;
}): never => {
  const { cause, keyIndex, stackSnapshot, groupHop } = params;

  /* Innermost hop wins: the error travels back out through every enclosing accessor, and the one
     that first caught it is the read that actually closed the loop. */
  const recordGroupHop = (err: IocResolutionError): void => {
    if (
      groupHop !== undefined &&
      err.groupHop === undefined &&
      err.failureType === "cyclic"
    ) {
      err.groupHop = groupHop;
    }
  };

  if (isIocResolutionError(cause)) {
    mergeAncestorStackIntoResolutionError(cause, stackSnapshot);
    recordGroupHop(cause);
    applyIocResolutionErrorMessage(cause, keyIndex);
    throw cause;
  }

  const err = createIocResolutionError(cause, keyIndex, stackSnapshot);
  recordGroupHop(err);
  applyIocResolutionErrorMessage(err, keyIndex);
  throw err;
};
