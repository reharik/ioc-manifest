/**
 * The neighbouring POSITION that must keep working. A deps property is a demand, not a contract
 * site: nothing is identified by it, so a foreign type needs no name there. Emission already
 * reaches it by the local binding and the default-import form, and the refusal must not spread to
 * a position where the shape is fine.
 */
import type Router from "@vendor/router";

export type MountedRoutesDeps = {
  readonly router: Router;
};

export interface MountedRoutes {
  readonly mounted: true;
}

export const buildMountedRoutes = (_deps: MountedRoutesDeps): MountedRoutes => ({
  mounted: true,
});
