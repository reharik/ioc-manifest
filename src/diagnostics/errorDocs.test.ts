/**
 * Docs pointers are a maintained contract, and this is what maintains them.
 *
 * A diagnostic that links to a page is making a promise on behalf of the docs. Nothing else in the
 * build checks that promise: a heading gets renamed in a docs PR, the link 404s, and the only way
 * anyone finds out is a developer clicking it while already having a bad day.
 *
 * So every mapped URL is resolved here against the markdown the site is built from. Two layers:
 *
 * 1. **Always** — the page file exists, and the anchor matches a heading in it, using VitePress's
 *    own slug rule (`@mdit-vue/shared`'s `slugify`, reimplemented — it is bundled inside vitepress
 *    and not importable).
 * 2. **After `npm run docs:build`** — the same anchors are checked against the `id` attributes in
 *    the rendered HTML. This is the guard on layer 1: if the reimplemented slug rule ever drifts
 *    from the real renderer, this is what says so, rather than layer 1 quietly passing on a slug
 *    the site does not actually emit.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  docsUrlForCode,
  IOC_DOCS_BASE_URL,
  IOC_DOCUMENTED_DIAGNOSTIC_CODES,
} from "./errorDocs.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.resolve(__dirname, "..", "..", "docs");
const builtDocsDir = path.join(docsDir, ".vitepress", "dist");

// `@mdit-vue/shared`'s slugify, verbatim in behaviour. Note what is NOT here: an em dash is not a
// "special" character, so `## a — b` really does slug to `a-—-b`. That surprise is exactly why the
// built-HTML layer below exists.
const R_CONTROL = /[\u0000-\u001f]/g;
const R_SPECIAL = /[\s~`!@#$%^&*()\-_+=[\]{}|\\;:"'“”‘’<>,.?/]+/g;
const R_COMBINING = /[\u0300-\u036f]/g;

const slugify = (text: string): string =>
  text
    .normalize("NFKD")
    .replace(R_COMBINING, "")
    .replace(R_CONTROL, "")
    .replace(R_SPECIAL, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/^(\d)/, "_$1")
    .toLowerCase();

/**
 * The text markdown-it-anchor slugs: the heading's `text` and `code_inline` children concatenated.
 * Backticks and emphasis markers are token syntax and never reach the slug; a link contributes its
 * label and not its href.
 */
const headingText = (line: string): string =>
  line
    .replace(/^#{1,6}\s+/, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_]/g, "")
    .trim();

const anchorsOf = (markdown: string): Set<string> => {
  const anchors = new Set<string>();
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence || !/^#{1,6}\s/.test(line)) {
      continue;
    }
    const explicit = /\{#([^}]+)\}\s*$/.exec(line);
    anchors.add(
      explicit !== null
        ? explicit[1]!
        : slugify(headingText(line.replace(/\{#[^}]+\}\s*$/, ""))),
    );
  }
  return anchors;
};

/** Every mapped code with its URL split into the page and the anchor it promises. */
const mappedTargets = (): Target[] =>
  IOC_DOCUMENTED_DIAGNOSTIC_CODES.map((code) => {
    const url = docsUrlForCode(code)!;
    const target = url.slice(IOC_DOCS_BASE_URL.length);
    const [page, anchor] = target.split("#");
    return { code, url, page: page!, anchor };
  });

type Target = {
  code: string;
  url: string;
  page: string;
  anchor: string | undefined;
};

/** Every target whose page or anchor the docs sources do not actually provide. */
const unresolvedAgainstSources = (targets: readonly Target[]): string[] => {
  const missing: string[] = [];

  for (const { code, page, anchor, url } of targets) {
    const file = path.join(docsDir, `${page}.md`);
    if (!fs.existsSync(file)) {
      missing.push(`${code} → ${url} (no such page: docs/${page}.md)`);
      continue;
    }
    if (anchor === undefined) {
      continue;
    }
    const anchors = anchorsOf(fs.readFileSync(file, "utf8"));
    if (!anchors.has(anchor)) {
      missing.push(
        `${code} → ${url} (docs/${page}.md has no heading slugging to "${anchor}"; it has: ${[...anchors].join(", ")})`,
      );
    }
  }

  return missing;
};

describe("errorDocs", () => {
  describe("When every mapped diagnostic code is resolved against the docs sources", () => {
    it("should name a page that exists and an anchor that page defines", () => {
      const missing = unresolvedAgainstSources(mappedTargets());

      assert.deepEqual(
        missing,
        [],
        `Diagnostic docs pointers that would 404:\n  ${missing.join("\n  ")}`,
      );
    });

    it("should report a renamed heading or a missing page rather than passing them", () => {
      // The check's own teeth. A heading rename shows up as an anchor the page no longer defines,
      // and that is the case this whole file exists to fail on — so it is asserted directly rather
      // than assumed from the green run above.
      const renamedHeading = unresolvedAgainstSources([
        {
          code: "pretend-code",
          url: `${IOC_DOCS_BASE_URL}concepts/lifetimes#the-floor-rule-restated`,
          page: "concepts/lifetimes",
          anchor: "the-floor-rule-restated",
        },
      ]);
      assert.equal(renamedHeading.length, 1);
      assert.match(renamedHeading[0]!, /no heading slugging to/);

      const deletedPage = unresolvedAgainstSources([
        {
          code: "pretend-code",
          url: `${IOC_DOCS_BASE_URL}concepts/nowhere#x`,
          page: "concepts/nowhere",
          anchor: "x",
        },
      ]);
      assert.equal(deletedPage.length, 1);
      assert.match(deletedPage[0]!, /no such page/);
    });

    it("should point at the configured docs site and nowhere else", () => {
      for (const { code, url } of mappedTargets()) {
        assert.ok(
          url.startsWith(IOC_DOCS_BASE_URL),
          `${code} points outside the docs site: ${url}`,
        );
      }
    });
  });

  describe("When the docs have been built", () => {
    it("should find every mapped anchor in the rendered HTML", (t) => {
      if (!fs.existsSync(builtDocsDir)) {
        // Not a silent pass: the source-level check above still ran, and this layer is the one that
        // would catch the slug rule drifting. Run `npm run docs:build` to arm it.
        t.skip("docs/.vitepress/dist not built — run `npm run docs:build`");
        return;
      }

      const missing: string[] = [];
      for (const { code, page, anchor, url } of mappedTargets()) {
        const file = path.join(builtDocsDir, `${page}.html`);
        if (!fs.existsSync(file)) {
          missing.push(`${code} → ${url} (built page missing: ${page}.html)`);
          continue;
        }
        if (anchor === undefined) {
          continue;
        }
        const html = fs.readFileSync(file, "utf8");
        if (!html.includes(`id="${anchor}"`)) {
          missing.push(`${code} → ${url} (no id="${anchor}" in ${page}.html)`);
        }
      }

      assert.deepEqual(
        missing,
        [],
        `Docs pointers absent from the built site:\n  ${missing.join("\n  ")}`,
      );
    });
  });
});
