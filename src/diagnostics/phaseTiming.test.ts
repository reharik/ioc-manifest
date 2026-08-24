/**
 * The two registers of phase timing, and the promise each one makes.
 *
 * A generation run used to be silent for as long as its analysis took, and `IOC_DEBUG=1` — the only
 * timing-adjacent switch the CLI has — added stack traces to ERRORS, so it told a slow run nothing.
 * The register split is what fixes that, and it is exactly what these tests pin:
 *
 *   - with the flag, EVERY phase prints, however fast it was;
 *   - without it, only a phase past the threshold prints, so a fast run stays byte-for-byte as
 *     silent as it has always been — the property every other suite in this repo depends on;
 *   - both registers print on STDERR, so nothing lands in the stdout the emission snapshots assert.
 *
 * The threshold is read from `IOC_SLOW_PHASE_MS` so the slow register can be exercised without a
 * five-second test.
 */
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  formatDuration,
  formatPhaseLine,
  formatSlowPhaseLine,
  recordedPhaseTimings,
  resetPhaseTimings,
  SLOW_PHASE_MS,
  timePhase,
  timePhaseAsync,
} from "./phaseTiming.js";

const saved = {
  debug: process.env.IOC_DEBUG,
  threshold: process.env.IOC_SLOW_PHASE_MS,
};

const setEnv = (name: "IOC_DEBUG" | "IOC_SLOW_PHASE_MS", value: string | undefined): void => {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
};

/** Captures both streams, so "went to stderr, not stdout" is assertable rather than assumed. */
const capture = <T>(body: () => T): { result: T; out: string[]; err: string[] } => {
  const out: string[] = [];
  const err: string[] = [];
  const realLog = console.log;
  const realWarn = console.warn;
  const realError = console.error;
  console.log = (...args: unknown[]) => out.push(args.join(" "));
  console.warn = (...args: unknown[]) => err.push(args.join(" "));
  console.error = (...args: unknown[]) => err.push(args.join(" "));
  try {
    return { result: body(), out, err };
  } finally {
    console.log = realLog;
    console.warn = realWarn;
    console.error = realError;
  }
};

afterEach(() => {
  setEnv("IOC_DEBUG", saved.debug);
  setEnv("IOC_SLOW_PHASE_MS", saved.threshold);
  resetPhaseTimings();
});

describe("formatDuration", () => {
  describe("When the duration is under a second", () => {
    it("should read in whole milliseconds", () => {
      assert.equal(formatDuration(0), "0ms");
      assert.equal(formatDuration(12.4), "12ms");
      assert.equal(formatDuration(999), "999ms");
    });
  });

  describe("When the duration is a second or more", () => {
    it("should read in seconds, because 157000ms is not a number anyone parses", () => {
      assert.equal(formatDuration(1000), "1.00s");
      assert.equal(formatDuration(164_800), "164.80s");
    });
  });
});

describe("timePhase", () => {
  describe("When IOC_DEBUG is not set and the phase is fast", () => {
    it("should print NOTHING on either stream", () => {
      setEnv("IOC_DEBUG", undefined);
      setEnv("IOC_SLOW_PHASE_MS", undefined);

      const { result, out, err } = capture(() => timePhase("fast phase", () => 42));

      assert.equal(result, 42);
      assert.deepEqual(out, []);
      assert.deepEqual(err, []);
    });
  });

  describe("When IOC_DEBUG=1", () => {
    it("should print every phase, on stderr, however fast it was", () => {
      setEnv("IOC_DEBUG", "1");

      const { out, err } = capture(() => {
        timePhase("discovery: factories", () => undefined);
        timePhase("analysis: demand/supply", () => undefined);
      });

      assert.deepEqual(out, []);
      assert.equal(err.length, 2);
      assert.match(err[0]!, /^\[ioc:phase\] discovery: factories \d+ms$/);
      assert.match(err[1]!, /^\[ioc:phase\] analysis: demand\/supply \d+ms$/);
    });
  });

  describe("When a phase exceeds the slow threshold and no flag is set", () => {
    it("should print one line naming itself, on stderr", () => {
      setEnv("IOC_DEBUG", undefined);
      // Zero, so any phase at all is 'slow' — the gate is what is under test, not the clock.
      setEnv("IOC_SLOW_PHASE_MS", "0");

      const { out, err } = capture(() =>
        timePhase("scope roots: verification", () => undefined),
      );

      assert.deepEqual(out, []);
      assert.equal(err.length, 1);
      assert.match(err[0]!, /^\[ioc\] scope roots: verification took \d/);
      assert.match(err[0]!, /IOC_DEBUG=1/);
    });
  });

  describe("When a phase throws", () => {
    it("should still record and report it — a pass that fails after two minutes is the case that most needs the number", () => {
      setEnv("IOC_DEBUG", "1");

      const { err } = capture(() => {
        assert.throws(() =>
          timePhase("check: lifetime inversions", () => {
            throw new Error("boom");
          }),
        );
      });

      assert.equal(err.length, 1);
      assert.match(err[0]!, /^\[ioc:phase\] check: lifetime inversions/);
      assert.deepEqual(
        recordedPhaseTimings().map((t) => t.phase),
        ["check: lifetime inversions"],
      );
    });
  });
});

describe("timePhaseAsync", () => {
  describe("When the phase awaits", () => {
    it("should measure the awaited span and return its value", async () => {
      setEnv("IOC_DEBUG", "1");
      resetPhaseTimings();

      const value = await timePhaseAsync("composed: manifest supply", async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return "loaded";
      });

      assert.equal(value, "loaded");
      const [timing] = recordedPhaseTimings();
      assert.equal(timing?.phase, "composed: manifest supply");
      assert.ok(
        (timing?.ms ?? 0) >= 5,
        `expected the awaited span to be measured, got ${timing?.ms}ms`,
      );
    });
  });
});

describe("SLOW_PHASE_MS", () => {
  describe("When no override is set", () => {
    it("should be the documented five seconds", () => {
      assert.equal(SLOW_PHASE_MS, 5_000);
    });
  });
});

describe("formatPhaseLine / formatSlowPhaseLine", () => {
  describe("When rendering the two registers", () => {
    it("should be distinguishable by prefix, so a log grep can separate them", () => {
      assert.equal(formatPhaseLine("plan: groups", 4), "[ioc:phase] plan: groups 4ms");
      assert.equal(
        formatSlowPhaseLine("analysis: demand/supply", 164_800),
        "[ioc] analysis: demand/supply took 164.80s." +
          " Re-run with IOC_DEBUG=1 for a per-phase breakdown.",
      );
    });
  });
});
