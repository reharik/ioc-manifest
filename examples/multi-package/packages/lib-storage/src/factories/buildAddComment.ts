import type { WriteServices } from "../generated/ioc-registry.types.js";
import type { AddComment } from "../types/WriteServices.js";

type AddCommentDeps = {
  writeServices: WriteServices;
};

/**
 * A group member consuming its SIBLING — the one road grouped ⇒ group-only leaves open, and the
 * reason group member slots resolve lazily.
 *
 * Destructuring `writeServices` here costs nothing: the group value is inert, so taking it builds
 * no members. `toggleReaction` resolves inside `add`, when the method runs — the call-time form.
 * Reading it at the top level of this body instead would build the sibling mid-construction, which
 * is how a member-to-sibling edge turns into a reported cycle.
 */
export const buildAddComment = ({
  writeServices,
}: AddCommentDeps): AddComment => ({
  writes: "comments",
  add: (body) => `commented:${body} (${writeServices.toggleReaction.react(body)})`,
});
