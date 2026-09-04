/**
 * The staleness marker's own contract — location, shape, tolerance and wording.
 *
 * The integration side (a real failing generation leaving one, a real `ioc validate` bannering it)
 * lives in `generator/generationStaleness.integration.test.ts`. What is pinned here is everything a
 * reader of the marker depends on being true regardless of who wrote it.
 */
import assert from "node:assert/strict";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  GENERATION_FAILURE_ARTIFACTS_NOTE,
  IOC_GENERATION_STATE_FILENAME,
  ensureGenerationStateIgnored,
  formatStalenessBanner,
  generationStatePathFor,
  hashGenerationInputs,
  readGenerationRecord,
  readGenerationState,
  relativeAge,
  writeGenerationRecord,
} from "./generationState.js";

const tempRoot = (): string => mkdtempSync(path.join(tmpdir(), "ioc-stale-"));

/** A scan set on disk, so the content hash has real bytes to read. */
const withFiles = (
  files: Readonly<Record<string, string>>,
): { root: string; paths: string[] } => {
  const root = tempRoot();
  const paths: string[] = [];
  for (const [rel, contents] of Object.entries(files)) {
    const abs = path.join(root, rel);
    mkdirSync(path.dirname(abs), { recursive: true });
    writeFileSync(abs, contents, "utf8");
    paths.push(abs);
  }
  return { root, paths };
};

describe("generationStatePathFor", () => {
  describe("When asked where the marker lives", () => {
    it("should place it BESIDE the generated directory, never inside it", () => {
      const generatedDir = "/proj/src/generated";
      const markerPath = generationStatePathFor(generatedDir);

      assert.equal(
        markerPath,
        path.join("/proj/src", IOC_GENERATION_STATE_FILENAME),
      );
      // The load-bearing property: consumers diff `src/generated` to prove generation is
      // deterministic, and a file carrying a timestamp could never survive that.
      assert.equal(markerPath.startsWith(`${generatedDir}${path.sep}`), false);
    });
  });
});

describe("the marker round trip", () => {
  describe("When a failure marker is written", () => {
    it("should be readable with every field it carried", async () => {
      const root = tempRoot();
      const generatedDir = path.join(root, "src", "generated");
      await writeGenerationRecord(generationStatePathFor(generatedDir), {
        outcome: "failed",
        at: "2026-08-23T10:00:00.000Z",
        errorCount: 3,
        inputsHash: "sha256:abc",
      });

      assert.deepEqual(readGenerationState(generatedDir), {
        outcome: "failed",
        at: "2026-08-23T10:00:00.000Z",
        errorCount: 3,
        inputsHash: "sha256:abc",
      });
    });

    it("should be valid JSON on disk, so a consumer can read it without this library", () => {
      const root = tempRoot();
      const generatedDir = path.join(root, "src", "generated");
      return writeGenerationRecord(
        generationStatePathFor(generatedDir),
        { outcome: "failed", at: "2026-08-23T10:00:00.000Z", errorCount: 1 },
      ).then(() => {
        const parsed = JSON.parse(
          readFileSync(generationStatePathFor(generatedDir), "utf8"),
        ) as Record<string, unknown>;
        assert.deepEqual(Object.keys(parsed).sort(), [
          "at",
          "errorCount",
          "outcome",
        ]);
      });
    });
  });

  describe("When generation succeeds", () => {
    it("should REPLACE the failure record rather than remove it", async () => {
      const root = tempRoot();
      const generatedDir = path.join(root, "src", "generated");
      const markerPath = generationStatePathFor(generatedDir);
      await writeGenerationRecord(markerPath, {
        outcome: "failed",
        at: "2026-08-23T10:00:00.000Z",
        errorCount: 1,
      });
      await writeGenerationRecord(markerPath, {
        outcome: "success",
        at: "2026-08-23T10:05:00.000Z",
        inputsHash: "sha256:abc",
      });

      // The file stays: removing it would say only "the last run did not fail", which is silent
      // about a run that succeeded and was then overtaken by an edit.
      assert.equal(existsSync(markerPath), true);
      assert.deepEqual(readGenerationRecord(generatedDir), {
        outcome: "success",
        at: "2026-08-23T10:05:00.000Z",
        inputsHash: "sha256:abc",
      });
    });

    it("should carry no errorCount, which would mean nothing on a success", async () => {
      const root = tempRoot();
      const generatedDir = path.join(root, "src", "generated");
      await writeGenerationRecord(generationStatePathFor(generatedDir), {
        outcome: "success",
        at: "2026-08-23T10:00:00.000Z",
        inputsHash: "sha256:abc",
      });

      const parsed = JSON.parse(
        readFileSync(generationStatePathFor(generatedDir), "utf8"),
      ) as Record<string, unknown>;
      assert.deepEqual(Object.keys(parsed).sort(), [
        "at",
        "inputsHash",
        "outcome",
      ]);
    });
  });
});

describe("readGenerationState reads FAILURES only", () => {
  describe("When the last generation SUCCEEDED", () => {
    it("should answer 'not stale', so the staleness banner keeps its exact meaning", async () => {
      const root = tempRoot();
      const generatedDir = path.join(root, "src", "generated");
      await writeGenerationRecord(generationStatePathFor(generatedDir), {
        outcome: "success",
        at: "2026-08-23T10:00:00.000Z",
        inputsHash: "sha256:abc",
      });

      // The record is there and readable...
      assert.equal(readGenerationRecord(generatedDir)?.outcome, "success");
      // ...and the staleness reader still says nothing failed. Widening this would turn the
      // "generation refused to write" banner into a banner on every generation ever run.
      assert.equal(readGenerationState(generatedDir), undefined);
    });
  });
});

describe("readGenerationState tolerance", () => {
  const withMarkerContents = (contents: string): string => {
    const root = tempRoot();
    const generatedDir = path.join(root, "src", "generated");
    mkdirSync(generatedDir, { recursive: true });
    writeFileSync(generationStatePathFor(generatedDir), contents, "utf8");
    return generatedDir;
  };

  describe("When the marker is absent, malformed or foreign", () => {
    it("should read as 'not stale' rather than crash the surface reading it", () => {
      assert.equal(readGenerationState(path.join(tempRoot(), "gen")), undefined);
      assert.equal(readGenerationState(withMarkerContents("{ not json")), undefined);
      assert.equal(readGenerationState(withMarkerContents("{}")), undefined);
      assert.equal(
        readGenerationState(withMarkerContents('{"outcome":"ok"}')),
        undefined,
      );
    });
  });

  describe("When the marker omits its error count", () => {
    it("should read as one error rather than zero", () => {
      const generatedDir = withMarkerContents(
        '{"outcome":"failed","at":"2026-08-23T10:00:00.000Z"}',
      );
      assert.equal(readGenerationState(generatedDir)?.errorCount, 1);
    });
  });
});

describe("hashGenerationInputs", () => {
  describe("When the inputs are unchanged", () => {
    it("should be stable, and independent of file order and checkout path", () => {
      const one = withFiles({ "src/a.ts": "export const a = 1;\n", "src/b.ts": "export const b = 2;\n" });
      const two = withFiles({ "src/a.ts": "export const a = 1;\n", "src/b.ts": "export const b = 2;\n" });

      const a = hashGenerationInputs(one.root, undefined, [...one.paths].reverse());
      const b = hashGenerationInputs(one.root, undefined, one.paths);
      // A different checkout of the same content: same relative paths, same bytes, same hash.
      const elsewhere = hashGenerationInputs(two.root, undefined, two.paths);

      assert.equal(a, b);
      assert.equal(a, elsewhere);
      assert.match(a, /^sha256:[0-9a-f]{64}$/);
    });
  });

  describe("When ONE BYTE of a scanned file changes", () => {
    it("should mismatch — this is the whole reason the hash reads content", () => {
      const { root, paths } = withFiles({ "src/a.ts": "export const a = 1;\n" });
      const before = hashGenerationInputs(root, undefined, paths);

      writeFileSync(paths[0]!, "export const a = 2;\n", "utf8");
      const after = hashGenerationInputs(root, undefined, paths);

      // The file list is identical. A list-shaped fingerprint matched straight through this, which
      // is exactly how a regrouped contract went on being reported in its old shape.
      assert.notEqual(before, after);
    });
  });

  describe("When a file is added or removed from the scan set", () => {
    it("should mismatch in both directions", () => {
      const { root, paths } = withFiles({
        "src/a.ts": "export const a = 1;\n",
        "src/b.ts": "export const b = 2;\n",
      });
      const both = hashGenerationInputs(root, undefined, paths);
      const removed = hashGenerationInputs(root, undefined, [paths[0]!]);

      assert.notEqual(both, removed);

      const added = path.join(root, "src", "c.ts");
      writeFileSync(added, "export const c = 3;\n", "utf8");
      assert.notEqual(both, hashGenerationInputs(root, undefined, [...paths, added]));
    });
  });

  describe("When the CONFIG source changes", () => {
    it("should mismatch, with the file set untouched", () => {
      const { root, paths } = withFiles({
        "src/a.ts": "export const a = 1;\n",
        "src/ioc.config.ts": "export default { discovery: { scanDirs: ['src'] } };\n",
      });
      const configPath = path.join(root, "src", "ioc.config.ts");
      const before = hashGenerationInputs(root, configPath, [paths[0]!]);

      writeFileSync(configPath, "export default { discovery: { scanDirs: ['lib'] } };\n", "utf8");

      assert.notEqual(before, hashGenerationInputs(root, configPath, [paths[0]!]));
    });
  });

  describe("When a file OUTSIDE the scan set changes", () => {
    it("should still match — the stated boundary, pinned rather than papered over", () => {
      const { root, paths } = withFiles({
        "src/a.ts": "export const a = 1;\n",
        "elsewhere/types.d.ts": "export type T = string;\n",
      });
      const scanned = [paths[0]!];
      const before = hashGenerationInputs(root, undefined, scanned);

      writeFileSync(paths[1]!, "export type T = number;\n", "utf8");

      // This is a real blind spot and the messages built on this hash say "may predate" for exactly
      // this reason: a type reached from outside `scanDirs` can change generation's output without
      // moving the fingerprint. Pinning it keeps the claim honest rather than pretending otherwise.
      assert.equal(before, hashGenerationInputs(root, undefined, scanned));
    });
  });

  describe("When a listed file cannot be read", () => {
    it("should mismatch rather than throw — an unreadable input is itself a change", () => {
      const { root, paths } = withFiles({ "src/a.ts": "export const a = 1;\n" });
      const readable = hashGenerationInputs(root, undefined, paths);
      const missing = hashGenerationInputs(root, undefined, [
        path.join(root, "src", "gone.ts"),
      ]);

      assert.match(missing, /^sha256:[0-9a-f]{64}$/);
      assert.notEqual(readable, missing);
    });
  });
});

describe("relativeAge", () => {
  const at = Date.parse("2026-08-23T12:00:00.000Z");

  describe("When rendering how long ago the failure was", () => {
    it("should pick a coarse unit and pluralize it", () => {
      assert.equal(relativeAge("2026-08-23T11:59:59.000Z", at), "1 second ago");
      assert.equal(relativeAge("2026-08-23T11:58:00.000Z", at), "2 minutes ago");
      assert.equal(relativeAge("2026-08-23T09:00:00.000Z", at), "3 hours ago");
      assert.equal(relativeAge("2026-08-19T12:00:00.000Z", at), "4 days ago");
    });

    it("should say so rather than compute nonsense from an unparseable timestamp", () => {
      assert.equal(relativeAge("not a date", at), "at an unknown time");
    });
  });
});

describe("formatStalenessBanner", () => {
  const banner = formatStalenessBanner(
    {
      outcome: "failed",
      at: "2026-08-23T11:00:00.000Z",
      errorCount: 2,
      inputsHash: "sha256:abc",
    },
    Date.parse("2026-08-23T12:00:00.000Z"),
  );

  describe("When a report is about to be printed over stale artifacts", () => {
    it("should say the artifacts are stale, why, and what the report describes", () => {
      assert.match(banner, /^\[stale\] Generated artifacts are STALE/);
      assert.match(banner, /last attempt: {2}1 hour ago \(2026-08-23T11:00:00\.000Z\), 2 errors/);
      assert.match(
        banner,
        /Results below describe the LAST SUCCESSFUL generation, not the current sources\./,
      );
      assert.match(banner, /Run `ioc generate` to see what the sources say now\./);
    });

    it("should be phrased in the past tense — it reports an attempt, not the tree's state now", () => {
      // The marker cannot know whether generation would still fail; only that it did.
      assert.doesNotMatch(banner, /is failing|currently fails|will fail/);
    });

    it("should carry no colour of its own", () => {
      // eslint-disable-next-line no-control-regex
      assert.doesNotMatch(banner, /\[/);
    });
  });
});

describe("the generation-side mirror line", () => {
  describe("When generation refuses to write", () => {
    it("should say the artifacts on disk are unchanged and name the marker", () => {
      assert.match(GENERATION_FAILURE_ARTIFACTS_NOTE, /Nothing was written/);
      assert.match(
        GENERATION_FAILURE_ARTIFACTS_NOTE,
        /remain from the last successful generation and were not modified/,
      );
      assert.ok(
        GENERATION_FAILURE_ARTIFACTS_NOTE.includes(
          IOC_GENERATION_STATE_FILENAME,
        ),
      );
    });
  });
});

describe("ensureGenerationStateIgnored", () => {
  /** A marker path inside a fresh temp dir — the directory whose `.gitignore` is at stake. */
  const withMarkerDir = (): { dir: string; markerPath: string } => {
    const dir = tempRoot();
    return { dir, markerPath: path.join(dir, IOC_GENERATION_STATE_FILENAME) };
  };

  const gitignoreIn = (dir: string): string => path.join(dir, ".gitignore");

  describe("When no .gitignore exists beside the marker", () => {
    it("should create one carrying the entry and the reason", async () => {
      const { dir, markerPath } = withMarkerDir();

      assert.equal(await ensureGenerationStateIgnored(markerPath), "created");

      const written = readFileSync(gitignoreIn(dir), "utf8");
      assert.match(written, /^\.ioc-generation-state\.json$/mu);
      // The reason travels with the entry: a bare line in a file the developer did not create is
      // the kind of thing that gets deleted by whoever finds it next.
      assert.match(written, /ioc generate/u);
      assert.equal(written.endsWith("\n"), true);
    });

    it("should write it BESIDE the marker, never in a parent", async () => {
      const { dir, markerPath } = withMarkerDir();

      await ensureGenerationStateIgnored(markerPath);

      assert.equal(existsSync(gitignoreIn(dir)), true);
      assert.equal(existsSync(path.join(dir, "..", ".gitignore")), false);
    });
  });

  describe("When a .gitignore exists WITHOUT the entry", () => {
    it("should append one line and leave every existing byte untouched", async () => {
      const { dir, markerPath } = withMarkerDir();
      const before = "node_modules/\ndist/\n\n# build output\n*.tgz\n";
      writeFileSync(gitignoreIn(dir), before, "utf8");

      assert.equal(await ensureGenerationStateIgnored(markerPath), "appended");

      assert.equal(
        readFileSync(gitignoreIn(dir), "utf8"),
        `${before}${IOC_GENERATION_STATE_FILENAME}\n`,
        "the prefix must be byte-identical — no reformatting, no reordering",
      );
    });

    it("should terminate an unterminated last line rather than joining onto it", async () => {
      const { dir, markerPath } = withMarkerDir();
      writeFileSync(gitignoreIn(dir), "dist/", "utf8");

      assert.equal(await ensureGenerationStateIgnored(markerPath), "appended");

      // Without the separator this would read as `dist/.ioc-generation-state.json` — one pattern
      // that ignores neither the marker nor `dist/`.
      assert.equal(
        readFileSync(gitignoreIn(dir), "utf8"),
        `dist/\n${IOC_GENERATION_STATE_FILENAME}\n`,
      );
    });

    it("should append nothing on a second run", async () => {
      const { dir, markerPath } = withMarkerDir();
      writeFileSync(gitignoreIn(dir), "dist/\n", "utf8");

      await ensureGenerationStateIgnored(markerPath);
      const afterFirst = readFileSync(gitignoreIn(dir), "utf8");

      assert.equal(await ensureGenerationStateIgnored(markerPath), "already-ignored");
      assert.equal(readFileSync(gitignoreIn(dir), "utf8"), afterFirst);
    });

    it("should be idempotent from a created file too", async () => {
      const { dir, markerPath } = withMarkerDir();

      assert.equal(await ensureGenerationStateIgnored(markerPath), "created");
      const afterFirst = readFileSync(gitignoreIn(dir), "utf8");

      assert.equal(await ensureGenerationStateIgnored(markerPath), "already-ignored");
      assert.equal(readFileSync(gitignoreIn(dir), "utf8"), afterFirst);
    });
  });

  describe("When the entry is already present in a form git would honour", () => {
    const alreadyIgnoring = [
      [".ioc-generation-state.json", "the bare name"],
      ["/.ioc-generation-state.json", "anchored to this directory"],
      ["**/.ioc-generation-state.json", "the form the docs recommend"],
      ["/**/.ioc-generation-state.json", "anchored, any depth"],
      [".ioc-generation-state.json   ", "trailing spaces, which git strips"],
      [".ioc-generation-state.json\r", "a CRLF checkout"],
    ] as const;

    for (const [line, why] of alreadyIgnoring) {
      it(`should do nothing when the file has ${why}`, async () => {
        const { dir, markerPath } = withMarkerDir();
        const before = `dist/\n${line}\nnode_modules/\n`;
        writeFileSync(gitignoreIn(dir), before, "utf8");

        assert.equal(await ensureGenerationStateIgnored(markerPath), "already-ignored");
        assert.equal(readFileSync(gitignoreIn(dir), "utf8"), before);
      });
    }

    it("should not read a commented-out entry as ignoring anything", async () => {
      const { dir, markerPath } = withMarkerDir();
      writeFileSync(gitignoreIn(dir), `# ${IOC_GENERATION_STATE_FILENAME}\n`, "utf8");

      assert.equal(await ensureGenerationStateIgnored(markerPath), "appended");
    });

    it("should not read a directory-only pattern as ignoring the file", async () => {
      const { dir, markerPath } = withMarkerDir();
      writeFileSync(gitignoreIn(dir), `${IOC_GENERATION_STATE_FILENAME}/\n`, "utf8");

      // A trailing slash matches directories only, so the marker is NOT ignored by it.
      assert.equal(await ensureGenerationStateIgnored(markerPath), "appended");
    });
  });

  describe("When the consumer has explicitly un-ignored the marker", () => {
    it("should decline rather than overturn the negation", async () => {
      const { dir, markerPath } = withMarkerDir();
      const before = `${IOC_GENERATION_STATE_FILENAME}\n!${IOC_GENERATION_STATE_FILENAME}\n`;
      writeFileSync(gitignoreIn(dir), before, "utf8");

      // Last match wins in gitignore: the negation is the consumer's decision that they want the
      // marker tracked, and appending underneath it would silently reverse that.
      assert.equal(await ensureGenerationStateIgnored(markerPath), "declined");
      assert.equal(readFileSync(gitignoreIn(dir), "utf8"), before);
    });

    it("should honour a re-ignore BELOW the negation, the same rule the other way", async () => {
      const { dir, markerPath } = withMarkerDir();
      const before = `!${IOC_GENERATION_STATE_FILENAME}\n${IOC_GENERATION_STATE_FILENAME}\n`;
      writeFileSync(gitignoreIn(dir), before, "utf8");

      assert.equal(await ensureGenerationStateIgnored(markerPath), "already-ignored");
      assert.equal(readFileSync(gitignoreIn(dir), "utf8"), before);
    });
  });

  describe("When the write cannot happen", () => {
    it("should report failure rather than throw, on an unwritable file", async () => {
      const { dir, markerPath } = withMarkerDir();
      writeFileSync(gitignoreIn(dir), "dist/\n", "utf8");
      chmodSync(gitignoreIn(dir), 0o444);

      try {
        // Root ignores mode bits, so the assertion that matters is the one that holds either way:
        // whatever happened, it RESOLVED rather than throwing. A generation that has already
        // written its artifacts must never be turned into a failure by this.
        const outcome = await ensureGenerationStateIgnored(markerPath);
        assert.equal(
          ["failed", "appended"].includes(outcome),
          true,
          `expected a resolved outcome, got ${outcome}`,
        );
        assert.equal(readFileSync(gitignoreIn(dir), "utf8").startsWith("dist/"), true);
      } finally {
        chmodSync(gitignoreIn(dir), 0o644);
      }
    });

    it("should report failure rather than throw when the directory does not exist", async () => {
      const missing = path.join(tempRoot(), "no-such-dir", IOC_GENERATION_STATE_FILENAME);

      assert.equal(await ensureGenerationStateIgnored(missing), "failed");
    });

    it("should decline a symlinked .gitignore rather than write through it", async () => {
      const { dir, markerPath } = withMarkerDir();
      const outside = path.join(tempRoot(), "central.gitignore");
      const before = "dist/\n";
      writeFileSync(outside, before, "utf8");
      symlinkSync(outside, gitignoreIn(dir));

      // Following it would reach outside the package — the one thing this is scoped never to do.
      assert.equal(await ensureGenerationStateIgnored(markerPath), "declined");
      assert.equal(readFileSync(outside, "utf8"), before);
    });
  });
});
