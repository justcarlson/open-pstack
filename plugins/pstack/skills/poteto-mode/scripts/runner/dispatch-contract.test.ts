import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EFFORTS } from "./types.ts";

const PLUGIN_ROOT = join(import.meta.dir, "../../../..");
const DISPATCH_PATH = join(
  PLUGIN_ROOT,
  "skills/poteto-mode/references/provider-dispatch.md"
);
const SETUP_PATH = join(PLUGIN_ROOT, "skills/setup-pstack/SKILL.md");
const AGENTS_DIR = join(PLUGIN_ROOT, "agents");

const DESCRIPTOR_RE = /^(claude|codex|grok|omp)\[([A-Za-z0-9][A-Za-z0-9_-]*)\]:(.+)@(low|medium|high|xhigh|max)$/;
const SHEET_ROLES = [
  "feature, refactoring",
  "bug-fix",
  "perf-issue",
  "hillclimb",
  "judgment and prose",
  "hardest tasks",
  "how explorer",
  "how explainer",
  "how critics",
  "why investigators, synthesizer",
  "reflect tooling, judgment, divergent, synthesizer",
  "arena runners",
  "arena cross-judge pool",
  "swarm workers",
  "architect runners",
  "interrogate reviewers",
  "overflow workers",
] as const;
const PANEL_ROLES = [
  "how critics",
  "arena runners",
  "arena cross-judge pool",
  "architect runners",
  "interrogate reviewers",
] as const;
const DEFAULT_ROUTES = [
  "codex[openai]:gpt-5.6-sol@high",
  "codex[openai]:gpt-6-astra@high",
] as const;

function roleRows(sheet: string): Map<string, string[]> {
  const rows = new Map<string, string[]>();
  for (const line of sheet.split(/\r?\n/)) {
    const separator = line.indexOf(": ");
    if (separator < 0) continue;
    const role = line.slice(0, separator);
    if (!SHEET_ROLES.includes(role as (typeof SHEET_ROLES)[number])) continue;
    if (rows.has(role)) throw new Error(`duplicate role: ${role}`);
    rows.set(role, line.slice(separator + 2).split(", "));
  }
  return rows;
}

function parseDescriptor(value: string): RegExpMatchArray {
  const match = value.match(DESCRIPTOR_RE);
  if (!match) throw new Error(`invalid descriptor: ${value}`);
  return match;
}

describe("dispatch configuration contract", () => {
  const dispatch = readFileSync(DISPATCH_PATH, "utf8");
  const setup = readFileSync(SETUP_PATH, "utf8");
  const sheet = readFileSync(join(PLUGIN_ROOT, "config/pstack-models.md"), "utf8");
  const rows = roleRows(sheet);

  it("uses schema 2 and keeps every documented role", () => {
    expect(sheet).toContain("Schema: 2");
    expect([...rows.keys()]).toEqual([...SHEET_ROLES]);
  });

  it("keeps subscription routes and the single bounded overflow route", () => {
    for (const [role, values] of rows) {
      for (const value of values) {
        if (value === "inherit-parent" || value === "auto") continue;
        const [, harness, provider, model, effort] = parseDescriptor(value);
        expect(harness).toBe("codex");
        expect(EFFORTS.some((candidate) => candidate === effort)).toBe(true);
        if (role === "overflow workers") {
          expect(value).toBe("codex[openrouter]:z-ai/glm-5.3-flash@max");
        } else {
          expect(provider).toBe("openai");
          expect(model.startsWith("gpt-")).toBe(true);
        }
      }
    }
    expect(dispatch).toContain("only when the parent is verified to use OpenAI");
    expect(rows.get("hardest tasks")).toEqual(["codex[openai]:gpt-6-astra@xhigh"]);
    expect(rows.get("how explorer")).toEqual(["codex[openai]:gpt-5.6-luna@max"]);
  });

  it("keeps one lane per default in every model-diverse panel", () => {
    for (const role of PANEL_ROLES) {
      expect(rows.get(role)).toEqual([...DEFAULT_ROUTES]);
    }
  });

  it("does not ship native non-OpenAI model agents", () => {
    for (const name of readdirSync(AGENTS_DIR)) {
      const text = readFileSync(join(AGENTS_DIR, name), "utf8");
      expect(text).not.toMatch(/^model: /m);
    }
  });

  it("changes roles before probing and requires successful probes before writing", () => {
    const sections = [
      "### 2. Load and normalize the current sheet",
      "### 3. Collect route changes",
      "### 4. Validate the intended map",
      "### 5. Probe every distinct target",
      "### 6. Confirm the final map",
      "### 7. Write both targets atomically",
    ];
    let previous = -1;
    for (const section of sections) {
      const position = setup.indexOf(section);
      expect(position).toBeGreaterThan(previous);
      previous = position;
    }
    expect(setup).toContain("A failed probe writes nothing.");
    expect(setup).toContain("restore every snapshot");
  });
});
