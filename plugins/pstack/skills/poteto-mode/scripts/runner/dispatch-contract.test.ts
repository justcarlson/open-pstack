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
] as const;
const PANEL_ROLES = [
  "how critics",
  "arena runners",
  "arena cross-judge pool",
  "architect runners",
  "interrogate reviewers",
] as const;
const DEFAULT_ROUTES = [
  "claude[anthropic]:claude-fable-5@max",
  "codex[openai]:gpt-5.6-sol@max",
  "grok[xai]:grok-4.6@xhigh",
  "claude[anthropic]:claude-opus-5@xhigh",
] as const;

function firstRunSheet(setup: string): string {
  const match = setup.match(
    /```markdown\n(# pstack model configuration\n[\s\S]*?)```/
  );
  if (!match) throw new Error("setup-pstack is missing the first-run sheet");
  return match[1];
}

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

function parseFrontmatter(text: string): Record<string, string> {
  if (!text.startsWith("---\n")) throw new Error("missing frontmatter");
  const end = text.indexOf("\n---\n", 4);
  if (end < 0) throw new Error("unterminated frontmatter");
  const fields: Record<string, string> = {};
  for (const line of text.slice(4, end).split("\n")) {
    const separator = line.indexOf(": ");
    if (separator < 0) throw new Error(`bad frontmatter line: ${line}`);
    fields[line.slice(0, separator)] = line.slice(separator + 2);
  }
  return fields;
}

describe("dispatch configuration contract", () => {
  const dispatch = readFileSync(DISPATCH_PATH, "utf8");
  const setup = readFileSync(SETUP_PATH, "utf8");
  const sheet = firstRunSheet(setup);
  const rows = roleRows(sheet);

  it("uses schema 2 and keeps every documented role", () => {
    expect(sheet).toContain("Schema: 2");
    expect([...rows.keys()]).toEqual([...SHEET_ROLES]);
  });

  it("accepts models with slashes and keeps harness/provider compatibility", () => {
    const openRouter = parseDescriptor(
      "codex[openrouter]:anthropic/claude-sonnet-4.5@high"
    );
    expect(openRouter.slice(1)).toEqual([
      "codex",
      "openrouter",
      "anthropic/claude-sonnet-4.5",
      "high",
    ]);
    expect(
      parseDescriptor("omp[openrouter]:z-ai/glm-5.3-flash@high").slice(1)
    ).toEqual([
      "omp",
      "openrouter",
      "z-ai/glm-5.3-flash",
      "high",
    ]);

    for (const values of rows.values()) {
      for (const value of values) {
        if (value === "inherit-parent" || value === "auto") continue;
        const [, harness, provider, model, effort] = parseDescriptor(value);
        expect(model.length).toBeGreaterThan(0);
        expect(EFFORTS.some((candidate) => candidate === effort)).toBe(true);
        if (harness === "claude") expect(provider).toBe("anthropic");
        if (harness === "grok") expect(provider).toBe("xai");
      }
    }
  });

  it("keeps the four upstream defaults without restricting later routes", () => {
    for (const route of DEFAULT_ROUTES) expect(sheet).toContain(route);
    expect(dispatch).toContain("They do not restrict later choices.");
    expect(dispatch).toContain("codex[openrouter]");
    expect(dispatch).toContain('model_provider="<id>"');
    expect(dispatch).toContain("omp[openrouter]:z-ai/glm-5.3-flash@high");
  });

  it("keeps one lane per default in every model-diverse panel", () => {
    for (const role of PANEL_ROLES) {
      expect(rows.get(role)).toEqual([...DEFAULT_ROUTES]);
    }
  });

  it("ships exactly the declared Claude native agent files", () => {
    const expected = new Set<string>();
    for (const [stem, model] of [
      ["fable", "claude-fable-5"],
      ["opus", "claude-opus-5"],
    ] as const) {
      for (const effort of EFFORTS) {
        const name = `pstack-${stem}-${effort}`;
        expected.add(`${name}.md`);
        expect(parseFrontmatter(readFileSync(join(AGENTS_DIR, `${name}.md`), "utf8"))).toMatchObject({
          name,
          description: `Native Claude lane for pstack roles configured as claude[anthropic]:${model}@${effort}.`,
          model,
          effort,
          background: "true",
        });
      }
    }
    const actual = new Set(
      readdirSync(AGENTS_DIR).filter((name) => /^pstack-(fable|opus)-/.test(name))
    );
    expect(actual).toEqual(expected);
  });

  it("changes roles before probing and writes only after confirmation", () => {
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
