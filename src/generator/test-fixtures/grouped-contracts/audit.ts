import type { FileAuditChannel, WireAuditChannel } from "./contracts.js";

/** Members of a group whose BASE carries the lifetime marker. Neither declares a lifetime. */
export const buildFileAuditChannel = (): FileAuditChannel => ({
  sink: "file",
  write: (line: string) => `file:${line}`,
});

export const buildWireAuditChannel = (): WireAuditChannel => ({
  sink: "wire",
  write: (line: string) => `wire:${line}`,
});
