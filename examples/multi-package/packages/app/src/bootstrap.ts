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
};

main();
