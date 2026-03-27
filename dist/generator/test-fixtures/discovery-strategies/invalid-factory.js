import { injectable } from "../../../core/injectable.js";
// Invalid because the return type is a union, which should fail contract type resolution.
export const makeInvalidWrapped = injectable(() => ({ x: "bad" }));
//# sourceMappingURL=invalid-factory.js.map