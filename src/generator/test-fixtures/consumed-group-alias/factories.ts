// Cold start: the generated registry-types file does NOT exist on disk, so these imports do not
// resolve. The named group-alias consumption must still be recognized SYNTACTICALLY off the import
// specifier — never by resolving the alias's underlying type from the (absent) generated file.
import type {
  Channels,
  IocGeneratedCradle,
  SweepTasks,
} from "./generated/ioc-registry.types.js";
import type {
  EmailChannel,
  NotificationService,
  SweepReport,
  SweepTask,
} from "./contracts.js";

export const buildEmailChannel = (): EmailChannel => ({
  sendEmail: () => {},
});

export const buildSweepTask = (): SweepTask => ({
  run: () => {},
});

// Consumes an OBJECT-group alias by name → resolves to group key `channels`.
type ObjConsumerDeps = { chans: Channels };
export const buildNotificationService = ({
  chans,
}: ObjConsumerDeps): NotificationService => ({
  notifyAll: (to) => {
    void chans;
    void to;
  },
});

// Consumes a COLLECTION-group alias by name → resolves to group key `sweepTasks`.
type ColConsumerDeps = { pending: SweepTasks };
export const buildSweepReport = ({
  pending,
}: ColConsumerDeps): SweepReport => ({
  total: pending.length,
});

// Imports a non-group-alias name (`IocGeneratedCradle`) from the registry file → not a group alias,
// so the group-alias parser leaves it alone. Nothing claims it, so in a real run the deps-position
// backstop rejects this factory; the tests here only exercise the parser's decision, not the run.
type NonAliasDeps = { cradle: IocGeneratedCradle };
export const buildNonAlias = ({
  cradle,
}: NonAliasDeps): NotificationService => ({
  notifyAll: () => {
    void cradle;
  },
});
