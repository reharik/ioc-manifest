# CLAUDE.md

Working notes for agents in this repository.

## Formatting: do not run prettier over the source

**Source in this repo is hand-formatted. Never run `prettier --write` (or any editor
format-on-save equivalent) across `src/`, `docs/`, or the repo root.**

This is not a style preference to be negotiated. Prettier decides far more than line width, and
there is no configuration that makes a `--write` over this tree a no-op — at prettier's default of
80 columns roughly 190 of the 522 files under `src/` differ, and every wider setting is worse (90 →
251, 95 → 278, 100 → 297, 110 → 321). A run therefore reformats hundreds of unrelated lines and
buries the actual change. This has already happened once: a session ran `prettier --write` on four
source files, then had to reset to `HEAD` and re-apply its edits by hand.

Prose is hand-wrapped for the same reason. Match the wrapping of the file you are editing.

### What `.prettierignore` is, and what it is not

[`.prettierignore`](.prettierignore) exists to make an accidental invocation genuinely harmless. It
is a **prohibition, not a configuration** — it does not sanction running prettier over source under
some other settings, and its own header explains at length why a `.prettierrc` was deliberately
**not** added: a style file at the root would advertise that a stray `--write` is safe here while
it rewrote a third of the tree, which is the opposite of the intent.

If you are tempted to add a `.prettierrc`, read that header first. Note also that
[`src/generator/formatGeneratedFile.ts`](src/generator/formatGeneratedFile.ts) calls
`prettier.resolveConfig()`, which walks up from the file being formatted — so a root `.prettierrc`
would silently change the formatting of this package's own generated manifest as well.

What prettier legitimately owns is **emitted artifacts** (`src/generated/**`), formatted in-process
by `formatGeneratedFile.ts` during `ioc generate`. The `!src/generated/**` negation in
`.prettierignore` is load-bearing for that; do not remove it.
