/**
 * The same empty lbv declared EXPLICITLY: `ScopeRoot<IReportRenderer, Record<string, never>>`.
 *
 * Byte-identical to `../arity-one/root.ts` apart from that annotation, which is the whole point —
 * the two spellings are one declaration, and everything downstream has to agree.
 */
import type { Named } from "../../../../named/named.js";
import type { ScopeRoot } from "../../../../scopeRoots/scopeRoot.js";
import type {
  IReportClock,
  IReportGateway,
  IReportRenderer,
} from "../contracts.js";
import type { OpenPublicReportScope } from "./generated/ioc-registry.types.js";

/** Container-supplied, resolved through the parent chain — not a late-bound value. */
export const buildReportClock = (): IReportClock => ({ now: () => 0 });

type PublicReportDeps = { reportClock: Named<IReportClock> };

/** A boundary that carries nothing in. */
export const buildPublicReport = ({
  reportClock,
}: PublicReportDeps): ScopeRoot<IReportRenderer, Record<string, never>> => ({
  render: () => `report at ${reportClock.now()}`,
});

type ReportGatewayDeps = { openPublicReportScope: OpenPublicReportScope };

/** The consumer half: an ordinary registration that opens the scope with no argument. */
export const buildReportGateway = ({
  openPublicReportScope,
}: ReportGatewayDeps): IReportGateway => ({
  renderNow: () => {
    const { publicReport, dispose } = openPublicReportScope();
    void dispose;
    return publicReport.render();
  },
});
