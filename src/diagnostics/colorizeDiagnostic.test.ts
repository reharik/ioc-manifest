/**
 * Colour for thrown diagnostics, applied at the CLI boundary.
 *
 * Two properties, and the second is the one that lets the rest of the suite keep asserting real
 * text: with colour off the pass is the identity function, byte for byte.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ansi } from "./ansi.js";
import {
  colorizeDiagnosticMessage,
  formatCaughtErrorForTerminal,
} from "./colorizeDiagnostic.js";

const PLAIN = ansi(false);
const COLOR = ansi(true);

/** A real aggregated demand-model error, shortened — every landmark the pass tints appears. */
const DEMAND_MODEL_ERROR = [
  "[ioc] 1 deps property does not name any of the five things a dependency can be:",
  "→ docs: https://reharik.github.io/ioc-manifest/concepts/conventions#demanding-a-dependency",
  '  - [grouped-member-demand] Factory "buildAuthService" at src/factories/buildAuthService.ts:12 property "activatePendingUserWriteService" demands it by name.',
].join("\n");

describe("colorizeDiagnosticMessage", () => {
  describe("When colour is disabled", () => {
    it("should return the message byte-identical", () => {
      assert.equal(colorizeDiagnosticMessage(DEMAND_MODEL_ERROR, PLAIN), DEMAND_MODEL_ERROR);
    });

    it("should be the identity for every message shape the tool throws", () => {
      for (const message of [
        "[ioc-config] scopeProvided declares \"viewerId\", but it is built by a local supplier.",
        "[externals] Unsatisfied: nothing supplies \"logger\", which @apps/api (this app) expects the container to already have.",
        "plain prose with no structure at all",
        "",
      ]) {
        assert.equal(colorizeDiagnosticMessage(message, PLAIN), message);
      }
    });
  });

  describe("When colour is enabled", () => {
    const colored = colorizeDiagnosticMessage(DEMAND_MODEL_ERROR, COLOR);

    it("should tint the tool prefix as severity and a diagnostic code as a label", () => {
      assert.ok(colored.includes(`${COLOR.bold}${COLOR.red}[ioc]${COLOR.reset}`));
      assert.ok(
        colored.includes(
          `${COLOR.bold}${COLOR.magenta}[grouped-member-demand]${COLOR.reset}`,
        ),
      );
    });

    it("should keep the offender line's leading dash outside the tag", () => {
      assert.match(colored, /\n {2}- \x1b\[1m\x1b\[35m\[grouped-member-demand\]/);
    });

    it("should tint file:line and quoted keys", () => {
      assert.ok(
        colored.includes(
          `${COLOR.cyan}src/factories/buildAuthService.ts:12${COLOR.reset}`,
        ),
      );
      assert.ok(
        colored.includes(
          `${COLOR.cyan}"activatePendingUserWriteService"${COLOR.reset}`,
        ),
      );
    });

    it("should underline the docs URL behind a dimmed arrow", () => {
      assert.match(colored, /\x1b\[2m→ docs: \x1b\[0m\x1b\[2m\x1b\[4mhttps:\/\//);
    });

    it("should leave prose untouched", () => {
      // Stripping every escape must give the original message back — colour ADDS, never rewrites.
      // eslint-disable-next-line no-control-regex
      assert.equal(colored.replace(/\x1b\[[0-9;]*m/g, ""), DEMAND_MODEL_ERROR);
    });
  });
});

describe("formatCaughtErrorForTerminal", () => {
  describe("When the caught value is an Error", () => {
    it("should print its message, coloured, and leave Error.message escape-free", () => {
      const error = new Error(DEMAND_MODEL_ERROR);
      const rendered = formatCaughtErrorForTerminal(error, { color: true });

      assert.ok(rendered.includes("\x1b["));
      // The whole reason colour is applied at this boundary: the message itself never carries it.
      assert.doesNotMatch(error.message, /\x1b\[/);
    });

    it("should be byte-stable with colour off", () => {
      assert.equal(
        formatCaughtErrorForTerminal(new Error(DEMAND_MODEL_ERROR), {
          color: false,
        }),
        DEMAND_MODEL_ERROR,
      );
    });
  });

  describe("When the caught value is not an Error", () => {
    it("should stringify it through the same pass", () => {
      assert.equal(
        formatCaughtErrorForTerminal("[ioc] thrown as a string", {
          color: false,
        }),
        "[ioc] thrown as a string",
      );
    });
  });
});

describe("the FORCE_COLOR / NO_COLOR / TTY discipline", () => {
  const withEnv = <T>(env: Record<string, string | undefined>, run: () => T): T => {
    const saved = new Map(Object.keys(env).map((k) => [k, process.env[k]]));
    for (const [k, v] of Object.entries(env)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
    try {
      return run();
    } finally {
      for (const [k, v] of saved) {
        if (v === undefined) {
          delete process.env[k];
        } else {
          process.env[k] = v;
        }
      }
    }
  };

  describe("When FORCE_COLOR is set", () => {
    it("should colour even off a TTY", () => {
      const rendered = withEnv(
        { NO_COLOR: undefined, FORCE_COLOR: "1" },
        () => formatCaughtErrorForTerminal(new Error(DEMAND_MODEL_ERROR)),
      );
      assert.ok(rendered.includes("\x1b["));
    });
  });

  describe("When NO_COLOR is set alongside FORCE_COLOR", () => {
    it("should stay plain — NO_COLOR wins", () => {
      const rendered = withEnv({ NO_COLOR: "1", FORCE_COLOR: "1" }, () =>
        formatCaughtErrorForTerminal(new Error(DEMAND_MODEL_ERROR)),
      );
      assert.equal(rendered, DEMAND_MODEL_ERROR);
    });
  });
});
