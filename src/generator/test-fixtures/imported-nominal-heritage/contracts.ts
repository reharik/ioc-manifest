import type { Service } from "./service-types.js";

export interface ServiceContract extends Service {
  contract(): void;
}
