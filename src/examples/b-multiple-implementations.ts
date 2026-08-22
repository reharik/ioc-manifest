/**
 * Lesson b — several implementations of one contract.
 *
 * Each implementation registers under its own key (`localMediaStorage`, `s3MediaStorage`), and the
 * contract additionally answers to its own camel-cased name — the **contract key** — which resolves
 * whichever implementation `ioc.config` elects as the default.
 *
 * Which of the two a dependency wants is a declaration, never a guess. Lesson c shows both
 * spellings side by side in one deps type: `widget: Widget` for the elected default, and
 * `secondaryWidget: Named<Widget>` for that specific implementation. `buildAlbumService` in lesson f
 * takes the first form; `ArchiveMediaStorage` in lesson g takes it too.
 *
 * `MediaStorage` is deliberately NOT grouped. Grouped ⇒ group-only: the moment a contract joins a
 * configured group it loses its contract key and its implementations lose their cradle keys, so
 * every demand named above would become illegal. A contract is a family or a singular, never both —
 * lesson d has the family shape, and names the deferred design question for wanting it to be both.
 */
export type MediaStorage = {
  label: string;
  put: (key: string) => Promise<void>;
};

export const buildLocalMediaStorage = (): MediaStorage => {
  return {
    label: "local",
    put: async () => {
      /* noop */
    },
  };
};

export const buildS3MediaStorage = (): MediaStorage => {
  return {
    label: "s3",
    put: async () => {
      /* noop */
    },
  };
};
