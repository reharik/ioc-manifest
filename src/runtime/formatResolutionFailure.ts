import { AwilixResolutionError } from "awilix";
import type { RegistrationKeyIndex } from "./registrationKeyIndex.js";
import type { IocResolutionFrame } from "./iocResolutionStack.js";

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

const describeRegistrationKey = (
  key: string,
  index: RegistrationKeyIndex,
): string => {
  const meta = index.metaByRegistrationKey.get(key);
  if (meta !== undefined) {
    const src =
      meta.sourceFilePath !== undefined && meta.sourceFilePath.length > 0
        ? meta.sourceFilePath
        : meta.modulePath;
    const fileSuffix = src.length > 0 ? ` [${src}]` : "";
    return `${meta.contractName} (${meta.implementationName})${fileSuffix}`;
  }
  const contract = index.contractByDefaultRegistrationKey.get(key);
  if (contract !== undefined) {
    return `${contract} (contract default slot ${JSON.stringify(key)})`;
  }
  return key;
};

const formatHeadlineFromRegistrationKey = (
  key: string,
  index: RegistrationKeyIndex,
): string => {
  const meta = index.metaByRegistrationKey.get(key);
  if (meta !== undefined) {
    return `Cannot build ${meta.contractName} using implementation ${meta.implementationName}.`;
  }
  const contract = index.contractByDefaultRegistrationKey.get(key);
  if (contract !== undefined) {
    return `Cannot resolve ${contract} (contract default slot ${JSON.stringify(key)}).`;
  }
  return `Cannot resolve registration ${JSON.stringify(key)}.`;
};

const formatHeadlineFromFrame = (frame: IocResolutionFrame): string =>
  `Cannot build ${frame.contractName} using implementation ${frame.implementationName}.`;

const formatResolutionChainFromKeys = (
  keys: readonly string[],
  index: RegistrationKeyIndex,
  leafLine: string,
): string => {
  if (keys.length === 0) {
    return `Resolution chain:\n    ${leafLine}\n`;
  }
  if (keys.length === 1) {
    return `Resolution chain:\n    ${describeRegistrationKey(keys[0]!, index)} ${leafLine}\n`;
  }
  let out = "Resolution chain:\n";
  for (let i = 0; i < keys.length - 1; i++) {
    const pad = "  ".repeat(i + 1);
    const conn = i === 0 ? "" : "-> ";
    out += `${pad}${conn}${describeRegistrationKey(keys[i]!, index)}\n`;
  }
  const last = keys[keys.length - 1]!;
  const lastPad = "  ".repeat(keys.length);
  out += `${lastPad}-> ${describeRegistrationKey(last, index)} ${leafLine}\n`;
  return out;
};

const describeFrame = (frame: IocResolutionFrame): string => {
  const file =
    frame.sourceFile !== undefined && frame.sourceFile.length > 0
      ? ` [${frame.sourceFile}]`
      : "";
  return `${frame.contractName} (${frame.implementationName})${file}`;
};

const formatResolutionChainFromFramesFactoryThrow = (
  frames: readonly IocResolutionFrame[],
  detailMessage: string,
): string => {
  if (frames.length === 0) {
    return `Resolution chain:\n    ✖ factory threw while building: ${detailMessage}\n`;
  }
  let out = "Resolution chain:\n";
  for (let i = 0; i < frames.length; i++) {
    const pad = "  ".repeat(i + 1);
    const conn = i === 0 ? "" : "-> ";
    out += `${pad}${conn}${describeFrame(frames[i]!)}\n`;
  }
  const leafPad = "  ".repeat(frames.length + 1);
  out += `${leafPad}✖ factory threw while building: ${detailMessage}\n`;
  return out;
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

export type WrapIocResolutionFailureParams = {
  cause: unknown;
  keyIndex: RegistrationKeyIndex;
  stackSnapshot: readonly IocResolutionFrame[];
};

/**
 * Turns Awilix resolution failures and factory throws into a single [ioc] error with a
 * dependency chain derived from Awilix's resolution path (when present) and manifest metadata.
 */
export const wrapIocResolutionFailure = (
  params: WrapIocResolutionFailureParams,
): Error => {
  const { cause, keyIndex, stackSnapshot } = params;

  if (cause instanceof AwilixResolutionError) {
    const path = parseAwilixResolutionPath(cause.message);
    const kind = classifyAwilixResolutionError(cause.message);
    const leafLine =
      kind === "cyclic"
        ? "✖ cyclic dependency detected"
        : kind === "lifetime"
          ? "✖ dependency lifetime is shorter than an ancestor (strict mode)"
          : "✖ no registered implementation";

    const firstKey =
      path !== undefined && path.length > 0
        ? path[0]!
        : stackSnapshot[0]?.registrationKey ?? "(unknown)";

    const headline = formatHeadlineFromRegistrationKey(firstKey, keyIndex);
    const chain =
      path !== undefined && path.length > 0
        ? formatResolutionChainFromKeys(path, keyIndex, leafLine)
        : formatResolutionChainFromFramesFactoryThrow(
            stackSnapshot,
            cause.message.trim(),
          );

    const msg = `[ioc] ${headline}\n\n${chain}`;
    return new Error(msg, { cause });
  }

  const detail =
    cause instanceof Error && cause.message.length > 0
      ? cause.message
      : String(cause);

  const top = stackSnapshot[0];
  const headline =
    top !== undefined
      ? formatHeadlineFromFrame(top)
      : "Container resolution failed (no active IoC resolution frame).";

  const chain = formatResolutionChainFromFramesFactoryThrow(
    stackSnapshot,
    detail,
  );

  return new Error(`[ioc] ${headline}\n\n${chain}`, {
    cause: cause instanceof Error ? cause : undefined,
  });
};
