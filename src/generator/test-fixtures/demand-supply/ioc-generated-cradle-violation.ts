import type { IocGeneratedCradle } from "./mock-ioc-generated-cradle.js";
import type { Logger } from "./contracts.js";

export const buildBad = ({ logger }: IocGeneratedCradle): Logger => logger;
