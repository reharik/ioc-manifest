/**
 * @fileoverview The ONE place a `.ts` `ioc.config` becomes a module. Everything that needs a
 * config goes through here; nothing else in the codebase may import `tsx`.
 *
 * ### Why this module exists at all
 *
 * `tsx`'s `tsImport()` is `register({ namespace: Date.now() }).import(...)`, and it never
 * unregisters. On Node 18.19+/20.6+ that takes the off-thread `module.register()` path, so every
 * call leaves ANOTHER live ESM hook in the process. Four packages meant four hooks.
 *
 * The hooks are supposed to be independent — each registration cache-busts `esm/index.mjs` with a
 * `?<timestamp>` so it gets its own module instance, and each hook ignores resolutions whose
 * namespace is not its own. In tsx 4.22.0–4.22.4 that isolation is broken: the exported
 * `initialize` / `resolve` / `load` come from a helper module that is NOT cache-busted, and they
 * all close over a single module-level state object which `initialize` overwrites with
 * `Object.assign(state, createData(options))`. Every new registration therefore re-points the
 * namespace that ALL prior hooks compare against, so all N hooks match the current namespace and
 * each re-applies tsx's full extension fan-out (`mapTsExtensions`: 9–14 candidates) before
 * delegating to the next. Cost goes as roughly 14^(N−1).
 *
 * Reproduced on tsx 4.22.0, one import, N hooks registered up front:
 *
 * ```
 * N=1  0.016s   N=2  0.017s   N=3  0.032s
 * N=4  0.202s   N=5  2.209s   N=6  30.388s
 * ```
 *
 * The field saw the same curve as 1.03 / 1.36 / 11.53 / 151.42s across four packages — a 156-second
 * `ioc validate` whose globbing and hashing were provably innocent.
 *
 * `unregister()` is not a workaround: it only flips `active` to false on that same shared object,
 * and the next `register()` re-arms it for every hook at once. Measured identical.
 *
 * ### The fix
 *
 * Register exactly once per process and reuse the scoped importer. N stays 1 however many packages
 * are composed, which makes the pathological branch unreachable regardless of which tsx is
 * installed. {@link configLoaderRegistrationCount} exists so a test can assert that structurally
 * rather than by watching a clock.
 *
 * ### Why the specifier carries an mtime stamp
 *
 * The per-call namespace `tsImport` generated had one accidental virtue: it made every load a
 * distinct module URL, so a config rewritten in place was always re-read. Under one stable
 * namespace the URL is stable too, and Node's ESM cache would hand back the STALE module — which
 * silently breaks anything that regenerates a config and reloads it. So the specifier carries
 * `?ioc-config=<mtimeMs>-<size>`: unchanged file, same URL, free cache hit; changed file, new URL,
 * genuine re-read. Verified in both directions.
 */
import fs from "node:fs";
import path from "node:path";
import { register } from "tsx/esm/api";

/**
 * Stable, and deliberately not `Date.now()`.
 *
 * The namespace exists to keep OUR hook from claiming resolutions that belong to someone else's
 * loader; it does not need to be unique per call, and making it unique per call is precisely the
 * bug this module routes around.
 */
const TSX_NAMESPACE = "ioc-manifest-config";

/** The query key that carries the file stamp. Named so it is obvious in a stack trace. */
const STAMP_QUERY = "ioc-config";

type ScopedImport = (specifier: string, parent: string) => Promise<unknown>;

type ScopedLoader = {
  readonly import: ScopedImport;
  readonly unregister: () => Promise<void>;
};

let scopedLoader: ScopedLoader | undefined;
let registrationCount = 0;

/**
 * `false` disables tsx's tsconfig resolution for config loading; `undefined` keeps it.
 *
 * Default is to KEEP it. A consumer's `ioc.config.ts` is allowed to import through the project's
 * `paths` aliases, and `tsconfig: false` makes those imports fail outright with
 * `ERR_MODULE_NOT_FOUND` — so it cannot be the default. It is also not the fix it looked like:
 * measured against the reproduction above, `tsconfig: false` on its own left the blow-up fully
 * intact (2.64s vs 2.57s across five packages), because the extension fan-out is entered whenever
 * the IMPORTING file is TypeScript, not only when `allowJs` is set. Registering once is what
 * flattens it (0.04s).
 *
 * The escape hatch stays for the case it genuinely serves: a project whose tsconfig is enormous or
 * whose compiler options actively confuse a config that needs none of them.
 */
const resolveTsconfigOption = (): false | undefined =>
  process.env.IOC_CONFIG_TSCONFIG === "false" ? false : undefined;

/** The process's single tsx registration, created on first use. */
const scoped = (): ScopedLoader => {
  if (scopedLoader === undefined) {
    scopedLoader = register({
      namespace: TSX_NAMESPACE,
      tsconfig: resolveTsconfigOption(),
    });
    registrationCount += 1;
  }
  return scopedLoader;
};

/**
 * How many tsx ESM hooks this process has registered.
 *
 * The structural pin for the regression this module fixes: it must be 1 after loading any number
 * of configs, and 0 before the first. A timing assertion would say the same thing far less
 * reliably.
 */
export const configLoaderRegistrationCount = (): number => registrationCount;

/**
 * Releases the tsx hook. For embedders that load configs inside a longer-lived process and want
 * their loader chain back; a CLI run has no reason to call it.
 *
 * Deliberately NOT wired to `process.on("exit")`: `unregister` is async and exit handlers cannot
 * await, so the "cleanup" would be a no-op that merely looked tidy.
 */
export const unregisterConfigLoader = async (): Promise<void> => {
  const active = scopedLoader;
  if (active === undefined) {
    return;
  }
  scopedLoader = undefined;
  registrationCount = 0;
  moduleCache.clear();
  await active.unregister();
};

/**
 * The identity two paths to the same config share.
 *
 * Realpath rather than `resolve` so a package reached through a `node_modules` symlink and the same
 * package reached through its workspace path are one cache entry, not two. A path that cannot be
 * realpath'd (it does not exist yet) still gets a stable key.
 */
export const canonicalConfigKey = (absoluteConfigPath: string): string => {
  const resolved = path.resolve(absoluteConfigPath);
  try {
    return fs.realpathSync(resolved);
  } catch {
    return resolved;
  }
};

/**
 * What the file looks like right now, or `undefined` if it cannot be stat'd.
 *
 * mtime AND size: mtime alone has filesystem-dependent granularity, and a same-millisecond rewrite
 * that changes length is exactly the shape a test fixture produces.
 */
const fileStamp = (canonicalPath: string): string | undefined => {
  try {
    const stat = fs.statSync(canonicalPath);
    return `${stat.mtimeMs}-${stat.size}`;
  } catch {
    return undefined;
  }
};

type CacheEntry = {
  readonly stamp: string | undefined;
  readonly module: Promise<Record<string, unknown>>;
};

const moduleCache = new Map<string, CacheEntry>();

/**
 * The identity of "this config file with THIS content" — path plus stamp.
 *
 * Anything caching a derived value (a validated {@link IocConfig}, say) must key on this rather
 * than on the path alone, or a config rewritten in place would keep serving its old value while
 * {@link importConfigModule} correctly re-read the new one. The two caches have to agree on when a
 * config has changed, so they share one definition of it.
 */
export const configCacheKey = (absoluteConfigPath: string): string => {
  const key = canonicalConfigKey(absoluteConfigPath);
  return `${key}@${fileStamp(key) ?? "missing"}`;
};

/**
 * Loads a `.ts` config as a module namespace, once per (path, content) per process.
 *
 * A rejected load is evicted rather than remembered: a config that throws on load is a condition a
 * caller may legitimately retry after fixing it, and a cached rejection would outlive the fix.
 */
export const importConfigModule = async (
  absoluteConfigPath: string,
): Promise<Record<string, unknown>> => {
  const key = canonicalConfigKey(absoluteConfigPath);
  const stamp = fileStamp(key);

  const cached = moduleCache.get(key);
  if (cached !== undefined && cached.stamp === stamp) {
    return cached.module;
  }

  const specifier =
    stamp === undefined
      ? key
      : `${key}?${STAMP_QUERY}=${encodeURIComponent(stamp)}`;

  const loading = scoped()
    .import(specifier, import.meta.url)
    .then((mod) => mod as Record<string, unknown>)
    .catch((error: unknown) => {
      if (moduleCache.get(key)?.module === loading) {
        moduleCache.delete(key);
      }
      throw error;
    });

  moduleCache.set(key, { stamp, module: loading });
  return loading;
};

/** Drops every cached config module. For tests that rebuild a fixture under one process. */
export const clearConfigModuleCache = (): void => {
  moduleCache.clear();
};
