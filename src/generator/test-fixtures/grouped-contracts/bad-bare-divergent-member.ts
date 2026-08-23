import type { Consumer, SlackStrategy } from "./contracts.js";

/**
 * The bare member-key demand for a member whose implementation is named nothing like its contract.
 *
 * The offender is spelled with the REGISTRATION key (`slackNotifier`) — that is what a bare demand
 * for an implementation looks like — while the group value exposes the member under its CONTRACT
 * key (`slackStrategy`). The guidance has to say the second one.
 */
type Deps = { slackNotifier: SlackStrategy };

export const buildDivergentMemberConsumer = ({ slackNotifier }: Deps): Consumer => ({
  run: () => slackNotifier.notify("m"),
});
