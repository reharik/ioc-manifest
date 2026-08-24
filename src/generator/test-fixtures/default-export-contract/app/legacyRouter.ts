/** The `export =` variant of the same breach: no named binding exists to import either. */
import LegacyRouter from "@vendor/legacy-router";

export const buildLegacyRouter = (): LegacyRouter => ({}) as unknown as LegacyRouter;
