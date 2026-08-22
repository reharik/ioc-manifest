/** Contracts for the contract-slot / `Named<T>` fixture set. */

/** Two implementations, one elected by config — the field's `AuthMiddleware` shape. */
export type AuthMiddleware = {
  name: string;
  handle: (path: string) => string;
};

/** A second contract, used to write a `Named<WrongContract>` demand. */
export type AuditSink = {
  write: (line: string) => void;
};

/** What the well-formed consumer builds. */
export type RequestPipeline = {
  run: (path: string) => string;
};

/** Group base with no `default: true` anywhere — the no-election shape. */
export type Strategy = {
  id: string;
};
