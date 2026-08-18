import { createContainer } from "awilix";
import { registerIocFromManifest } from "ioc-manifest";
import {
  composedManifests,
  composedRegistrationOverrides,
  type AppCradle,
} from "./generated/ioc-composed.js";

const main = (): void => {
  const container = createContainer<AppCradle>({ injectionMode: "PROXY" });
  registerIocFromManifest(
    container,
    composedManifests,
    composedRegistrationOverrides,
  );

  const uploadService = container.resolve("uploadService");
  const storage = container.resolve("storage");
  const result = uploadService.upload("photo.jpg");

  console.log(
    `Upload service resolved; using ${storage.label} storage; logger says ${result}`,
  );

  // Class registration unit from @example/lib-storage: constructed with `new` under PROXY
  // injection, resolved through the same cradle as every factory-built registration.
  const archiveStorage = container.resolve("archiveStorage");
  archiveStorage.put("photo.jpg");
  console.log(`Class unit archiveStorage resolved; label ${archiveStorage.label}`);

  const storages = container.resolve("storages");
  console.log(
    `Storages in group: ${storages
      .map((s) => s.label)
      .sort((a, b) => a.localeCompare(b))
      .join(", ")}`,
  );

  const loggers = container.resolve("loggers");
  const loggerIds = loggers
    .map((l) => l.id)
    .filter((id) => id.length > 0)
    .sort((a, b) => a.localeCompare(b));
  console.log(`Loggers in group: ${loggerIds.join(", ")}`);

  const scopeA = container.createScope();
  const scopeB = container.createScope();
  const scopedA1 = scopeA.resolve("requestTracingLogger");
  const scopedA2 = scopeA.resolve("requestTracingLogger");
  const scopedB1 = scopeB.resolve("requestTracingLogger");
  console.log(
    `Scoped requestTracingLogger same within scope: ${scopedA1 === scopedA2}`,
  );
  console.log(
    `Scoped requestTracingLogger differs across scopes: ${scopedA1 !== scopedB1}`,
  );
};

main();
