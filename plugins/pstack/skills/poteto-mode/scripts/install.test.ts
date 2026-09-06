import { afterEach, describe, expect, it } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  installPstack,
  type CommandExecutor,
  updateModelBlock,
} from "./install.ts";

interface Fixture {
  homeDir: string;
  pluginRoot: string;
  repositoryRoot: string;
  root: string;
  version: string;
}

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function write(path: string, content: string): void {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

function writeJson(path: string, value: unknown): void {
  write(path, `${JSON.stringify(value, null, 2)}\n`);
}

function makeFixture(version = "9.8.7-test.1"): Fixture {
  const root = mkdtempSync(join(tmpdir(), "open-pstack-install-"));
  temporaryRoots.push(root);
  const repositoryRoot = join(root, "repository");
  const pluginRoot = join(repositoryRoot, "plugins", "pstack");
  const homeDir = join(root, "home");
  writeJson(join(repositoryRoot, ".claude-plugin", "marketplace.json"), {
    name: "open-pstack",
  });
  writeJson(join(pluginRoot, ".codex-plugin", "plugin.json"), {
    name: "pstack",
    version,
  });
  write(
    join(pluginRoot, "skills", "tdd", "SKILL.md"),
    "---\nname: tdd\ndescription: Test first.\n---\n# TDD\n\nKeep this body byte-for-byte.\n"
  );
  write(
    join(pluginRoot, "skills", "architect", "SKILL.md"),
    "---\nname: architect\ndescription: Design first.\n---\n# Architect\n\nRead [poteto mode](../poteto-mode/SKILL.md).\n"
  );
  write(
    join(
      pluginRoot,
      "skills",
      "architect",
      "references",
      "rationale-template.md"
    ),
    "Continue with [TDD](../../tdd/SKILL.md).\n"
  );
  write(
    join(pluginRoot, "skills", "poteto-mode", "SKILL.md"),
    "---\nname: poteto-mode\ndescription: Work carefully.\n---\n# Poteto mode\n"
  );
  write(
    join(
      pluginRoot,
      "skills",
      "poteto-mode",
      "references",
      "opencode-tools.md"
    ),
    "# OpenCode mapping\n"
  );
  write(
    join(pluginRoot, "skills", "poteto-mode", "scripts", "runner"),
    "#!/bin/sh\n"
  );
  write(
    join(pluginRoot, "skills", "setup-pstack", "SKILL.md"),
    "---\nname: setup-pstack\ndescription: Configure pstack.\n---\n# Setup\n\nRead [models](../../config/pstack-models.md).\n"
  );
  write(
    join(pluginRoot, "agents", "poteto-agent.md"),
    "# Poteto agent\n"
  );
  write(
    join(pluginRoot, "config", "pstack-models.md"),
    "# pstack model configuration\n\nfeature: codex[openai]:gpt-test@high\n"
  );
  write(
    join(pluginRoot, "config", "pstack.config.toml"),
    'model = "gpt-test"\n'
  );
  return { homeDir, pluginRoot, repositoryRoot, root, version };
}

function openCodeVersionRoot(fixture: Fixture): string {
  return join(
    fixture.homeDir,
    ".local",
    "share",
    "pstack",
    "opencode2",
    fixture.version
  );
}

function openCodeConfigPath(fixture: Fixture): string {
  return join(fixture.homeDir, ".config", "opencode", "opencode2.json");
}

function snapshotTree(path: string): string[] {
  const results: string[] = [];
  function visit(current: string): void {
    for (const name of readdirSync(current).sort()) {
      const child = join(current, name);
      const key = relative(path, child);
      const stat = lstatSync(child);
      if (stat.isSymbolicLink()) {
        results.push(`link:${key}:${readlinkSync(child)}`);
      } else if (stat.isDirectory()) {
        results.push(`directory:${key}`);
        visit(child);
      } else {
        results.push(`file:${key}:${readFileSync(child, "utf8")}`);
      }
    }
  }
  visit(path);
  return results;
}

interface FakeCodexOptions {
  marketplacePath?: string;
  pluginPath?: string;
  pluginVersion?: string;
}

function fakeCodex(fixture: Fixture, options: FakeCodexOptions = {}): {
  calls: string[][];
  execute: CommandExecutor;
} {
  const calls: string[][] = [];
  let marketplaces =
    options.marketplacePath === undefined
      ? []
      : [{ name: "open-pstack", root: options.marketplacePath }];
  let installed =
    options.pluginPath === undefined
      ? [{ pluginId: "foreign@elsewhere", version: "1.0.0" }]
      : [
          {
            installed: true,
            pluginId: "pstack@open-pstack",
            source: { path: options.pluginPath },
            version: options.pluginVersion ?? fixture.version,
          },
        ];

  const execute: CommandExecutor = (argv) => {
    const call = [...argv];
    calls.push(call);
    const command = call.join(" ");
    if (command === "codex plugin marketplace list --json") {
      return JSON.stringify({ marketplaces });
    }
    if (
      command ===
      `codex plugin marketplace add ${fixture.repositoryRoot} --json`
    ) {
      marketplaces = [
        { name: "open-pstack", root: fixture.repositoryRoot },
      ];
      return "{}";
    }
    if (command === "codex plugin list --json") {
      return JSON.stringify({ installed });
    }
    if (command === "codex plugin add pstack@open-pstack --json") {
      installed = [
        {
          installed: true,
          pluginId: "pstack@open-pstack",
          source: { path: fixture.pluginRoot },
          version: fixture.version,
        },
      ];
      return "{}";
    }
    throw new Error(`Unexpected command: ${command}`);
  };
  return { calls, execute };
}

describe("OpenCode 2 installation", () => {
  it("generates prefixed skills without disturbing a colliding plain skill", () => {
    const fixture = makeFixture();
    const plainSkill = join(
      fixture.homeDir,
      ".config",
      "opencode",
      "skills",
      "tdd",
      "SKILL.md"
    );
    write(plainSkill, "personal tdd\n");
    writeJson(openCodeConfigPath(fixture), {
      default_agent: "build",
      foreign: { keep: true },
      permissions: [
        { action: "skill", resource: "*", effect: "deny" },
        { action: "shell", resource: "git", effect: "allow" },
        { action: "skill", resource: "pstack-*", effect: "allow" },
        { action: "skill", resource: "pstack-*", effect: "allow" },
      ],
      plugins: ["file:///keep/plugin.js"],
      skills: ["/keep/skills"],
    });

    const result = installPstack({
      harness: "opencode2",
      homeDir: fixture.homeDir,
      pluginRoot: fixture.pluginRoot,
    });

    const versionRoot = openCodeVersionRoot(fixture);
    const generatedTdd = join(
      versionRoot,
      "skills",
      "pstack-tdd",
      "SKILL.md"
    );
    const generated = readFileSync(generatedTdd, "utf8");
    expect(generated).toContain("name: pstack-tdd");
    expect(generated).toContain("Map unprefixed pstack skill names to `pstack-*`");
    expect(generated).toEndWith("# TDD\n\nKeep this body byte-for-byte.\n");
    expect(existsSync(join(versionRoot, "skills", "tdd"))).toBe(false);
    expect(readFileSync(plainSkill, "utf8")).toBe("personal tdd\n");
    expect(
      lstatSync(join(versionRoot, "skills", "pstack-poteto-mode", "scripts"))
        .isSymbolicLink()
    ).toBe(true);
    expect(
      readFileSync(
        join(
          versionRoot,
          "skills",
          "pstack-tdd",
          "..",
          "pstack-poteto-mode",
          "references",
          "opencode-tools.md"
        ),
        "utf8"
      )
    ).toBe(
      readFileSync(
        join(
          fixture.pluginRoot,
          "skills",
          "poteto-mode",
          "references",
          "opencode-tools.md"
        ),
        "utf8"
      )
    );
    expect(
      readFileSync(
        join(versionRoot, "skills", "pstack-architect", "SKILL.md"),
        "utf8"
      )
    ).toContain("](../pstack-poteto-mode/SKILL.md)");
    expect(
      readFileSync(
        join(
          versionRoot,
          "skills",
          "pstack-architect",
          "references",
          "rationale-template.md"
        ),
        "utf8"
      )
    ).toBe("Continue with [TDD](../../pstack-tdd/SKILL.md).\n");
    expect(
      realpathSync(
        join(
          versionRoot,
          "skills",
          "pstack-tdd",
          "..",
          "..",
          "agents",
          "poteto-agent.md"
        )
      )
    ).toBe(
      realpathSync(join(fixture.pluginRoot, "agents", "poteto-agent.md"))
    );
    expect(
      realpathSync(
        join(
          versionRoot,
          "skills",
          "pstack-setup-pstack",
          "..",
          "..",
          "config",
          "pstack-models.md"
        )
      )
    ).toBe(
      realpathSync(join(fixture.pluginRoot, "config", "pstack-models.md"))
    );
    expect(
      realpathSync(
        join(
          versionRoot,
          "skills",
          "pstack-poteto-mode",
          "references",
          "..",
          "..",
          "..",
          "config",
          "pstack-models.md"
        )
      )
    ).toBe(
      realpathSync(join(fixture.pluginRoot, "config", "pstack-models.md"))
    );
    expect(result.openCodeEntry).toBe("opencode2 run --agent pstack");

    const config = JSON.parse(readFileSync(openCodeConfigPath(fixture), "utf8"));
    expect(config.default_agent).toBe("build");
    expect(config.foreign).toEqual({ keep: true });
    expect(config.plugins).toEqual(["file:///keep/plugin.js"]);
    expect(config.skills).toEqual([
      "/keep/skills",
      join(versionRoot, "skills"),
    ]);
    expect(config.permissions).toEqual([
      { action: "skill", resource: "*", effect: "deny" },
      { action: "shell", resource: "git", effect: "allow" },
      { action: "skill", resource: "pstack-*", effect: "allow" },
    ]);
    expect(config.agents).toBeUndefined();
  });

  it("is byte-idempotent and retires an older managed skills path", () => {
    const fixture = makeFixture();
    const oldVersionRoot = join(
      fixture.homeDir,
      ".local",
      "share",
      "pstack",
      "opencode2",
      "1.0.0"
    );
    writeJson(join(oldVersionRoot, ".open-pstack-opencode2-view.json"), {
      format: 1,
      harness: "opencode2",
      owner: "open-pstack",
      version: "1.0.0",
    });
    mkdirSync(join(oldVersionRoot, "skills"));
    writeJson(openCodeConfigPath(fixture), {
      permissions: [],
      skills: [join(oldVersionRoot, "skills")],
    });

    installPstack({
      harness: "opencode2",
      homeDir: fixture.homeDir,
      pluginRoot: fixture.pluginRoot,
    });
    const firstConfig = readFileSync(openCodeConfigPath(fixture), "utf8");
    const firstView = snapshotTree(openCodeVersionRoot(fixture));
    installPstack({
      harness: "opencode2",
      homeDir: fixture.homeDir,
      pluginRoot: fixture.pluginRoot,
    });

    expect(readFileSync(openCodeConfigPath(fixture), "utf8")).toBe(
      firstConfig
    );
    expect(snapshotTree(openCodeVersionRoot(fixture))).toEqual(firstView);
    const config = JSON.parse(firstConfig);
    expect(config.skills).toEqual([
      join(openCodeVersionRoot(fixture), "skills"),
    ]);
    expect(
      config.permissions.filter(
        (permission: Record<string, string>) =>
          permission.action === "skill" &&
          permission.resource === "pstack-*" &&
          permission.effect === "allow"
      )
    ).toHaveLength(1);
  });

  it("leaves a foreign version directory and config untouched", () => {
    const fixture = makeFixture();
    const versionRoot = openCodeVersionRoot(fixture);
    write(join(versionRoot, "keep.txt"), "foreign\n");
    writeJson(openCodeConfigPath(fixture), { keep: true });
    const originalConfig = readFileSync(openCodeConfigPath(fixture), "utf8");

    expect(() =>
      installPstack({
        harness: "opencode2",
        homeDir: fixture.homeDir,
        pluginRoot: fixture.pluginRoot,
      })
    ).toThrow("Refusing to replace unowned OpenCode view");
    expect(readFileSync(join(versionRoot, "keep.txt"), "utf8")).toBe(
      "foreign\n"
    );
    expect(readFileSync(openCodeConfigPath(fixture), "utf8")).toBe(
      originalConfig
    );
  });
});

describe("default configuration", () => {
  it("installs both defaults while preserving existing profiles and agents", () => {
    const fixture = makeFixture();
    const codexAgents = join(fixture.homeDir, ".codex", "AGENTS.md");
    const openCodeAgents = join(
      fixture.homeDir,
      ".config",
      "opencode",
      "AGENTS.md"
    );
    write(codexAgents, "# Codex preferences\n\nKeep me.\n");
    write(openCodeAgents, "# OpenCode preferences\n");
    writeJson(openCodeConfigPath(fixture), {
      agents: {
        build: { model: "openai/gpt-existing#max", system: "Keep build." },
      },
      default_agent: "build",
      permissions: [{ action: "skill", resource: "*", effect: "deny" }],
      providers: { keep: true },
    });
    const codex = fakeCodex(fixture, {
      marketplacePath: fixture.repositoryRoot,
      pluginPath: fixture.pluginRoot,
    });

    installPstack({
      configureDefaults: true,
      execute: codex.execute,
      harness: "all",
      homeDir: fixture.homeDir,
      pluginRoot: fixture.pluginRoot,
    });
    const firstCodexAgents = readFileSync(codexAgents, "utf8");
    const firstOpenCodeAgents = readFileSync(openCodeAgents, "utf8");
    const firstConfig = readFileSync(openCodeConfigPath(fixture), "utf8");
    installPstack({
      configureDefaults: true,
      execute: codex.execute,
      harness: "all",
      homeDir: fixture.homeDir,
      pluginRoot: fixture.pluginRoot,
    });

    const modelSheet = readFileSync(
      join(fixture.pluginRoot, "config", "pstack-models.md"),
      "utf8"
    );
    const profile = readFileSync(
      join(fixture.pluginRoot, "config", "pstack.config.toml"),
      "utf8"
    );
    expect(
      readFileSync(join(fixture.homeDir, ".codex", "pstack-models.md"), "utf8")
    ).toBe(modelSheet);
    expect(
      readFileSync(join(fixture.homeDir, ".codex", "pstack.config.toml"), "utf8")
    ).toBe(profile);
    expect(
      readFileSync(
        join(
          fixture.homeDir,
          ".config",
          "opencode",
          "pstack-models.md"
        ),
        "utf8"
      )
    ).toBe(modelSheet);
    expect(readFileSync(codexAgents, "utf8")).toBe(firstCodexAgents);
    expect(readFileSync(openCodeAgents, "utf8")).toBe(firstOpenCodeAgents);
    expect(readFileSync(openCodeConfigPath(fixture), "utf8")).toBe(
      firstConfig
    );
    expect(firstCodexAgents).toContain("Keep me.");
    expect(firstOpenCodeAgents).toContain("# OpenCode preferences");
    expect(firstCodexAgents.match(/pstack:models:begin/g)).toHaveLength(1);
    expect(firstOpenCodeAgents.match(/pstack:models:begin/g)).toHaveLength(1);

    const config = JSON.parse(firstConfig);
    expect(config.default_agent).toBe("build");
    expect(config.providers).toEqual({ keep: true });
    expect(config.agents.build).toEqual({
      model: "openai/gpt-existing#max",
      system: "Keep build.",
    });
    expect(config.agents.pstack).toMatchObject({
      description:
        "Open Pstack primary agent. Select it explicitly with --agent pstack.",
      mode: "primary",
      model: "openai/gpt-5.6-sol#high",
    });
    expect(config.agents.pstack.system).toContain(
      join(
        openCodeVersionRoot(fixture),
        "skills",
        "pstack-poteto-mode",
        "references",
        "opencode-tools.md"
      )
    );
  });

  it("refuses to overwrite a foreign pstack agent", () => {
    const fixture = makeFixture();
    writeJson(openCodeConfigPath(fixture), {
      agents: { pstack: { description: "My personal agent" } },
    });

    expect(() =>
      installPstack({
        configureDefaults: true,
        harness: "opencode2",
        homeDir: fixture.homeDir,
        pluginRoot: fixture.pluginRoot,
      })
    ).toThrow("agents.pstack is not managed by open-pstack");
    expect(existsSync(openCodeVersionRoot(fixture))).toBe(false);
  });

  it("migrates the legacy managed pstack agent to the ownership marker", () => {
    const fixture = makeFixture();
    writeJson(openCodeConfigPath(fixture), {
      agents: {
        pstack: {
          description:
            "Open Pstack primary agent. Select it explicitly with --agent pstack.",
          mode: "primary",
          model: "openai/gpt-5.6-sol#high",
          system:
            "Use pstack skills through their `pstack-*` OpenCode names. Older managed instructions.",
        },
      },
    });

    installPstack({
      configureDefaults: true,
      harness: "opencode2",
      homeDir: fixture.homeDir,
      pluginRoot: fixture.pluginRoot,
    });

    const config = JSON.parse(readFileSync(openCodeConfigPath(fixture), "utf8"));
    expect(config.agents.pstack.system).toStartWith(
      "[open-pstack managed agent]"
    );
  });

  it("upgrades a managed pstack agent across mutable defaults", () => {
    const fixture = makeFixture();
    writeJson(openCodeConfigPath(fixture), {
      agents: {
        pstack: {
          description: "Older managed description.",
          mode: "primary",
          model: "openai/older-model#low",
          system: "[open-pstack managed agent] Older managed instructions.",
        },
      },
    });

    installPstack({
      configureDefaults: true,
      harness: "opencode2",
      homeDir: fixture.homeDir,
      pluginRoot: fixture.pluginRoot,
    });

    const config = JSON.parse(readFileSync(openCodeConfigPath(fixture), "utf8"));
    expect(config.agents.pstack).toMatchObject({
      description:
        "Open Pstack primary agent. Select it explicitly with --agent pstack.",
      mode: "primary",
      model: "openai/gpt-5.6-sol#high",
    });
    expect(config.agents.pstack.system).toStartWith(
      "[open-pstack managed agent]"
    );
  });

  it("rejects malformed bounded blocks", () => {
    expect(() =>
      updateModelBlock("before\n<!-- pstack:models:begin -->\n", "models\n")
    ).toThrow("incomplete or duplicate");
    expect(() =>
      updateModelBlock(
        "<!-- pstack:models:end -->\n<!-- pstack:models:begin -->\n",
        "models\n"
      )
    ).toThrow("reversed");
  });
});

describe("Codex installation", () => {
  it("adds the local marketplace once and refreshes the plugin every run", () => {
    const fixture = makeFixture();
    const codex = fakeCodex(fixture);

    installPstack({
      execute: codex.execute,
      harness: "codex",
      homeDir: fixture.homeDir,
      pluginRoot: fixture.pluginRoot,
    });
    expect(codex.calls.map((call) => call.join(" "))).toEqual([
      "codex plugin marketplace list --json",
      `codex plugin marketplace add ${fixture.repositoryRoot} --json`,
      "codex plugin list --json",
      "codex plugin add pstack@open-pstack --json",
    ]);
    expect(codex.calls.some((call) => call.includes("remove"))).toBe(false);

    codex.calls.length = 0;
    installPstack({
      execute: codex.execute,
      harness: "codex",
      homeDir: fixture.homeDir,
      pluginRoot: fixture.pluginRoot,
    });
    expect(codex.calls.map((call) => call.join(" "))).toEqual([
      "codex plugin marketplace list --json",
      "codex plugin list --json",
      "codex plugin add pstack@open-pstack --json",
    ]);
  });

  it("re-adds an outdated owned plugin", () => {
    const fixture = makeFixture();
    const codex = fakeCodex(fixture, {
      marketplacePath: fixture.repositoryRoot,
      pluginPath: fixture.pluginRoot,
      pluginVersion: "1.0.0",
    });

    installPstack({
      execute: codex.execute,
      harness: "codex",
      homeDir: fixture.homeDir,
      pluginRoot: fixture.pluginRoot,
    });
    expect(codex.calls.at(-1)?.join(" ")).toBe(
      "codex plugin add pstack@open-pstack --json"
    );
  });

  it("refuses a foreign marketplace without running a mutation", () => {
    const fixture = makeFixture();
    const codex = fakeCodex(fixture, {
      marketplacePath: join(fixture.root, "someone-else"),
    });

    expect(() =>
      installPstack({
        execute: codex.execute,
        harness: "codex",
        homeDir: fixture.homeDir,
        pluginRoot: fixture.pluginRoot,
      })
    ).toThrow("belongs to another source");
    expect(codex.calls).toHaveLength(1);
    expect(codex.calls[0]).toEqual([
      "codex",
      "plugin",
      "marketplace",
      "list",
      "--json",
    ]);
  });

  it("refuses a foreign installed plugin without re-adding it", () => {
    const fixture = makeFixture();
    const codex = fakeCodex(fixture, {
      marketplacePath: fixture.repositoryRoot,
      pluginPath: join(fixture.root, "someone-else", "pstack"),
      pluginVersion: "1.0.0",
    });

    expect(() =>
      installPstack({
        execute: codex.execute,
        harness: "codex",
        homeDir: fixture.homeDir,
        pluginRoot: fixture.pluginRoot,
      })
    ).toThrow("plugin pstack@open-pstack belongs to another source");
    expect(codex.calls.map((call) => call.join(" "))).toEqual([
      "codex plugin marketplace list --json",
      "codex plugin list --json",
    ]);
  });
});
