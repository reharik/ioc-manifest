/* Stand-in for a PREVIOUS generation's output, so the indexed-access reference form has an import
   target to be read off. Never resolved through: the claim parsers read the import statement. */
import type { AuthMiddleware } from "../contracts.js";

export interface IocGeneratedCradle {
  strictAuthMiddleware: AuthMiddleware;
}
