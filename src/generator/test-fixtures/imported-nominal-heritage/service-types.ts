import type { Mid } from "./base-types.js";

export interface Service extends Mid {
  run(): void;
}
