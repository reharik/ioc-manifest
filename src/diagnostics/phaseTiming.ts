/**
 * @fileoverview Wall-clock timing for generation's ANALYSIS phases, and the one line a slow run
 * prints about itself.
 *
 * ### Why this exists
 *
 * Everything a generation run says out loud happens at the END: the per-file emission lines, the
 * summary, the diagnostics. Between "discovering" and "writing" the pipeline runs a dozen
 * type-sensitive passes in silence, and on a large graph that silence lasted minutes. A run that
 * prints nothing for three minutes is indistinguishable from a hang, and `IOC_DEBUG=1` did not help
 * — it only adds stack traces to errors, so a run that is merely SLOW got no extra information from
 * it at all.
 *
 * Two registers, matching the two questions a reader has:
 *
 *   - **`IOC_DEBUG=1`** — every phase prints its duration as it completes. This is the profile: the
 *     hot phase is the one with the big number, and no external profiler is needed to find it.
 *   - **no flag** — a phase that takes longer than {@link SLOW_PHASE_MS} prints ONE line naming
 *     itself. A slow run therefore self-identifies ("still working: …"), and a fast run stays
 *     completely silent, which is the behaviour every existing test asserts.
 *
 * ### Where it prints, and why that is the byte-stability answer
 *
 * **stderr, both registers.** The generated-diff and CLI snapshot suites compare STDOUT; emission
 * lines, the summary and the composed-package list all live there and are asserted byte for byte.
 * Timing is diagnostic chatter about the run rather than part of its output, so it belongs on the
 * same stream the warnings already use. Gating it on a TTY the way colour is gated would have been
 * the other defensible choice, but it would make the line disappear in exactly the situation it is
 * most wanted — a CI job that has been running for four minutes with nothing in the log.
 *
 * The threshold is overridable with `IOC_SLOW_PHASE_MS` so the gate itself is testable without a
 * five-second test.
 */

/** A phase slower than this announces itself even when nothing asked for timing. */
export const SLOW_PHASE_MS = 5_000;

const slowPhaseThresholdMs = (): number => {
  const raw = process.env.IOC_SLOW_PHASE_MS;
  if (raw === undefined || raw === "") {
    return SLOW_PHASE_MS;
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : SLOW_PHASE_MS;
};

const timingRequested = (): boolean => process.env.IOC_DEBUG === "1";

/** `1234` → `"1.23s"`, `12` → `"12ms"` — durations read at the scale they occur at. */
export const formatDuration = (ms: number): string =>
  ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;

/** The debug register: one line per phase, always. */
export const formatPhaseLine = (phase: string, ms: number): string =>
  `[ioc:phase] ${phase} ${formatDuration(ms)}`;

/**
 * The no-flag register: one line, past tense, naming the phase that took the time.
 *
 * Past tense on purpose — it is printed when the phase ENDS, because a phase cannot be measured
 * before it is over. Saying "still working" would be a lie by the time it is read.
 */
export const formatSlowPhaseLine = (phase: string, ms: number): string =>
  `[ioc] ${phase} took ${formatDuration(ms)}.` +
  ` Re-run with IOC_DEBUG=1 for a per-phase breakdown.`;

/** One completed phase. Collected so a run can be summarised or asserted as a whole. */
export type PhaseTiming = { phase: string; ms: number };

const timings: PhaseTiming[] = [];

/** Every phase recorded so far, in completion order. */
export const recordedPhaseTimings = (): readonly PhaseTiming[] => [...timings];

/** Drops recorded timings. For tests, and for a process that generates more than one package. */
export const resetPhaseTimings = (): void => {
  timings.length = 0;
};

const report = (phase: string, ms: number): void => {
  timings.push({ phase, ms });
  if (timingRequested()) {
    console.error(formatPhaseLine(phase, ms));
    return;
  }
  if (ms >= slowPhaseThresholdMs()) {
    console.error(formatSlowPhaseLine(phase, ms));
  }
};

/**
 * Runs `body`, records how long it took under `phase`, and returns its result.
 *
 * The timing is recorded even when `body` throws: a phase that fails after two minutes is exactly
 * the case the reader needs the number for.
 */
export const timePhase = <T>(phase: string, body: () => T): T => {
  const started = performance.now();
  try {
    return body();
  } finally {
    report(phase, performance.now() - started);
  }
};

/** {@link timePhase} for a phase that awaits. */
export const timePhaseAsync = async <T>(
  phase: string,
  body: () => Promise<T>,
): Promise<T> => {
  const started = performance.now();
  try {
    return await body();
  } finally {
    report(phase, performance.now() - started);
  }
};

/**
 * {@link timePhase} where the label gains a detail only the RESULT can supply — a file count, a
 * byte total.
 *
 * A duration alone is rarely a diagnosis. "scan-set glob 4.10s" says a glob was slow; "scan-set
 * glob — 41234 files 4.10s" says which bug it is, and the two readings point at opposite fixes. The
 * detail therefore belongs in the label rather than on a line of its own, where it would be one
 * more thing for a reader to correlate.
 *
 * A body that THROWS still reports, under the bare phase name: there is no result to describe, and
 * the duration of a phase that failed after two minutes is exactly the number the reader came for.
 */
export const timePhaseDetailed = <T>(
  phase: string,
  detail: (result: T) => string,
  body: () => T,
): T => {
  const started = performance.now();
  let label = phase;
  try {
    const result = body();
    label = `${phase} — ${detail(result)}`;
    return result;
  } finally {
    report(label, performance.now() - started);
  }
};

/** {@link timePhaseDetailed} for a phase that awaits. */
export const timePhaseAsyncDetailed = async <T>(
  phase: string,
  detail: (result: T) => string,
  body: () => Promise<T>,
): Promise<T> => {
  const started = performance.now();
  let label = phase;
  try {
    const result = await body();
    label = `${phase} — ${detail(result)}`;
    return result;
  } finally {
    report(label, performance.now() - started);
  }
};
