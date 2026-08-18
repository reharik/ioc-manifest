# Testing

The named-deps-type pattern at the unit's declaration enables three levels of testing, each with the ergonomics that fit:

## Unit-level (no container)

Most unit tests don't need a container. Import the unit, import its deps type, hand-build a stub, and call the factory — or `new` the class, which takes the same deps object:

```ts
import { buildValidateOperationService } from "../src/...";
import type { ValidateOperationServiceDeps } from "../src/...";

const deps: ValidateOperationServiceDeps = {
  mediaItemReadRepository: {
    /* stub */
  },
  grantReadRepository: {
    /* stub */
  },
  albumMemberReadRepository: {
    /* stub */
  },
};
const svc = buildValidateOperationService(deps);

// A class unit is the same call, spelled with `new`:
const svc2 = new ValidateOperationService(deps);
```

No container, no manifest, no awilix. TypeScript enforces what must be provided. This is one reason class units take a single destructured object rather than positional constructor parameters: the deps type is importable, so a test builds one literal instead of remembering an argument order.

## Container-level with mocked externals

When you want the full container — testing wiring, lifetimes, multi-service interactions inside the package — register the package's manifest then fill `IocExternals` with `asValue` stubs:

```ts
import { createContainer, asValue } from "awilix";
import { registerIocFromManifest } from "ioc-manifest";
import { iocManifest } from "../src/generated/ioc-manifest.js";
import type {
  IocGeneratedCradle,
  IocExternals,
} from "../src/generated/ioc-registry.types.js";

const container = createContainer<IocGeneratedCradle>();
registerIocFromManifest(container, [iocManifest]);

const externals: IocExternals = {
  database: mockKnex,
  logger: silentLogger,
};
for (const [k, v] of Object.entries(externals)) {
  container.register({ [k]: asValue(v) });
}
```

The `IocExternals` type makes the external surface a typed checklist: forget one and TypeScript errors; add a new external dep in the package and every test breaks until updated.

## Test-specific manifest

For shared stubs across many tests, write stub factories under `tests/stubs/` and a separate `ioc.config.test.ts` scanning both `src` and `tests/stubs`. Generate a test manifest. Use as above. Run with `npx ioc generate -c ./ioc.config.test.ts`.

---
