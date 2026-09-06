import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  join,
  relative,
  resolve,
} from "node:path";

export const HARNESSES = ["codex", "opencode2", "all"] as const;

export type Harness = (typeof HARNESSES)[number];
export type CommandExecutor = (argv: readonly string[]) => string;

export interface InstallOptions {
  harness: Harness;
  configureDefaults?: boolean;
  execute?: CommandExecutor;
  homeDir?: string;
  pluginRoot?: string;
}

export interface InstallResult {
  harnesses: readonly Exclude<Harness, "all">[];
  openCodeEntry?: string;
  openCodeSkillsRoot?: string;
  version: string;
}

interface PluginMetadata {
  marketplaceName: string;
  pluginName: string;
  pluginRoot: string;
  repositoryRoot: string;
  version: string;
}

interface GeneratedSkill {
  directoryName: string;
  skillMarkdown: string;
  sourceDirectory: string;
}

interface FilePlan {
  content: string;
  path: string;
}

interface OpenCodePlan {
  config: FilePlan;
  generatedSkills: readonly GeneratedSkill[];
  skillsRoot: string;
  versionRoot: string;
}

type JsonObject = Record<string, unknown>;

const DEFAULT_PLUGIN_ROOT = resolve(import.meta.dir, "../../..");
const MANAGED_VIEW_MARKER = ".open-pstack-opencode2-view.json";
const MANAGED_VIEW_FORMAT = 1;
const MODEL_BLOCK_BEGIN = "<!-- pstack:models:begin -->";
const MODEL_BLOCK_END = "<!-- pstack:models:end -->";
const OPEN_CODE_AGENT_SYSTEM_PREFIX = "[open-pstack managed agent]";
const OPEN_CODE_LEGACY_AGENT_SYSTEM_PREFIX =
  "Use pstack skills through their `pstack-*` OpenCode names.";
const OPEN_CODE_AGENT_DESCRIPTION =
  "Open Pstack primary agent. Select it explicitly with --agent pstack.";
const OPEN_CODE_AGENT_MODEL = "openai/gpt-5.6-sol#high";
const OPEN_CODE_ENTRY = "opencode2 run --agent pstack";

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJsonObject(text: string, label: string): JsonObject {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
  if (!isObject(value)) {
    throw new Error(`${label} must contain a JSON object`);
  }
  return value;
}

function requiredString(
  object: JsonObject,
  key: string,
  label: string
): string {
  const value = object[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label}.${key} must be a non-empty string`);
  }
  return value;
}

function readMetadata(pluginRootInput: string): PluginMetadata {
  const pluginRoot = canonicalPath(pluginRootInput);
  const repositoryRoot = canonicalPath(resolve(pluginRoot, "../.."));
  const pluginManifestPath = join(
    pluginRoot,
    ".codex-plugin",
    "plugin.json"
  );
  const marketplaceManifestPath = join(
    repositoryRoot,
    ".claude-plugin",
    "marketplace.json"
  );
  const pluginManifest = parseJsonObject(
    readFileSync(pluginManifestPath, "utf8"),
    pluginManifestPath
  );
  const marketplaceManifest = parseJsonObject(
    readFileSync(marketplaceManifestPath, "utf8"),
    marketplaceManifestPath
  );
  const version = requiredString(pluginManifest, "version", pluginManifestPath);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(version)) {
    throw new Error(`Unsafe plugin version in ${pluginManifestPath}: ${version}`);
  }

  return {
    marketplaceName: requiredString(
      marketplaceManifest,
      "name",
      marketplaceManifestPath
    ),
    pluginName: requiredString(pluginManifest, "name", pluginManifestPath),
    pluginRoot,
    repositoryRoot,
    version,
  };
}

function canonicalPath(path: string): string {
  const absolutePath = resolve(path);
  return existsSync(absolutePath) ? realpathSync(absolutePath) : absolutePath;
}

function samePath(left: string, right: string): boolean {
  return canonicalPath(left) === canonicalPath(right);
}

function defaultExecutor(argv: readonly string[]): string {
  const result = Bun.spawnSync([...argv], {
    stderr: "pipe",
    stdout: "pipe",
  });
  if (result.exitCode !== 0) {
    const stderr = result.stderr.toString().trim();
    throw new Error(
      `${argv.join(" ")} exited with status ${result.exitCode}${
        stderr.length > 0 ? `: ${stderr}` : ""
      }`
    );
  }
  return result.stdout.toString();
}

function objectArray(
  object: JsonObject,
  key: string,
  label: string
): JsonObject[] {
  const value = object[key];
  if (!Array.isArray(value) || !value.every(isObject)) {
    throw new Error(`${label}.${key} must be an array of objects`);
  }
  return value;
}

function marketplacePath(marketplace: JsonObject): string | undefined {
  if (typeof marketplace.root === "string") {
    return marketplace.root;
  }
  if (
    isObject(marketplace.marketplaceSource) &&
    typeof marketplace.marketplaceSource.source === "string"
  ) {
    return marketplace.marketplaceSource.source;
  }
  return undefined;
}

function installedPluginPath(plugin: JsonObject): string | undefined {
  if (isObject(plugin.source) && typeof plugin.source.path === "string") {
    return plugin.source.path;
  }
  return undefined;
}

function installCodex(
  metadata: PluginMetadata,
  execute: CommandExecutor
): void {
  const marketplaceLabel = "codex plugin marketplace list --json";
  const marketplaceResult = parseJsonObject(
    execute(["codex", "plugin", "marketplace", "list", "--json"]),
    marketplaceLabel
  );
  const matchingMarketplaces = objectArray(
    marketplaceResult,
    "marketplaces",
    marketplaceLabel
  ).filter((item) => item.name === metadata.marketplaceName);

  if (matchingMarketplaces.length > 1) {
    throw new Error(
      `Codex has multiple marketplaces named ${metadata.marketplaceName}`
    );
  }
  const marketplace = matchingMarketplaces[0];
  if (marketplace !== undefined) {
    const configuredPath = marketplacePath(marketplace);
    if (
      configuredPath === undefined ||
      !samePath(configuredPath, metadata.repositoryRoot)
    ) {
      throw new Error(
        `Codex marketplace ${metadata.marketplaceName} belongs to another source; refusing to overwrite it`
      );
    }
  } else {
    execute([
      "codex",
      "plugin",
      "marketplace",
      "add",
      metadata.repositoryRoot,
      "--json",
    ]);
  }

  const pluginLabel = "codex plugin list --json";
  const pluginResult = parseJsonObject(
    execute(["codex", "plugin", "list", "--json"]),
    pluginLabel
  );
  const pluginId = `${metadata.pluginName}@${metadata.marketplaceName}`;
  const matchingPlugins = objectArray(
    pluginResult,
    "installed",
    pluginLabel
  ).filter((item) => item.pluginId === pluginId);
  if (matchingPlugins.length > 1) {
    throw new Error(`Codex has multiple installed plugins named ${pluginId}`);
  }

  const installedPlugin = matchingPlugins[0];
  if (installedPlugin !== undefined) {
    const configuredPath = installedPluginPath(installedPlugin);
    if (
      configuredPath === undefined ||
      !samePath(configuredPath, metadata.pluginRoot)
    ) {
      throw new Error(
        `Codex plugin ${pluginId} belongs to another source; refusing to overwrite it`
      );
    }
  }

  execute(["codex", "plugin", "add", pluginId, "--json"]);
}

function countOccurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

export function updateModelBlock(
  original: string,
  modelSheet: string
): string {
  const beginCount = countOccurrences(original, MODEL_BLOCK_BEGIN);
  const endCount = countOccurrences(original, MODEL_BLOCK_END);
  if (beginCount !== endCount || beginCount > 1) {
    throw new Error(
      "AGENTS.md has incomplete or duplicate pstack model block markers"
    );
  }

  const normalizedSheet = modelSheet.endsWith("\n")
    ? modelSheet
    : `${modelSheet}\n`;
  const block = `${MODEL_BLOCK_BEGIN}\n${normalizedSheet}${MODEL_BLOCK_END}`;
  if (beginCount === 0) {
    if (original.length === 0) {
      return `${block}\n`;
    }
    const separator = original.endsWith("\n\n")
      ? ""
      : original.endsWith("\n")
        ? "\n"
        : "\n\n";
    return `${original}${separator}${block}\n`;
  }

  const begin = original.indexOf(MODEL_BLOCK_BEGIN);
  const end = original.indexOf(MODEL_BLOCK_END);
  if (end < begin) {
    throw new Error("AGENTS.md has reversed pstack model block markers");
  }
  return `${original.slice(0, begin)}${block}${original.slice(
    end + MODEL_BLOCK_END.length
  )}`;
}

function readOptionalFile(path: string): string {
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

function planDefaultFiles(
  metadata: PluginMetadata,
  homeDir: string,
  harnesses: readonly Exclude<Harness, "all">[],
  configureDefaults: boolean
): FilePlan[] {
  if (!configureDefaults) {
    return [];
  }

  const sourceModelPath = join(
    metadata.pluginRoot,
    "config",
    "pstack-models.md"
  );
  if (!existsSync(sourceModelPath)) {
    throw new Error(`Missing default model sheet: ${sourceModelPath}`);
  }
  const modelSheet = readFileSync(sourceModelPath, "utf8");
  const plans: FilePlan[] = [];

  if (harnesses.includes("codex")) {
    const sourceProfilePath = join(
      metadata.pluginRoot,
      "config",
      "pstack.config.toml"
    );
    if (!existsSync(sourceProfilePath)) {
      throw new Error(`Missing Codex profile: ${sourceProfilePath}`);
    }
    const codexDirectory = join(homeDir, ".codex");
    const agentsPath = join(codexDirectory, "AGENTS.md");
    plans.push(
      {
        content: modelSheet,
        path: join(codexDirectory, "pstack-models.md"),
      },
      {
        content: readFileSync(sourceProfilePath, "utf8"),
        path: join(codexDirectory, "pstack.config.toml"),
      },
      {
        content: updateModelBlock(readOptionalFile(agentsPath), modelSheet),
        path: agentsPath,
      }
    );
  }

  if (harnesses.includes("opencode2")) {
    const openCodeDirectory = join(homeDir, ".config", "opencode");
    const agentsPath = join(openCodeDirectory, "AGENTS.md");
    plans.push(
      {
        content: modelSheet,
        path: join(openCodeDirectory, "pstack-models.md"),
      },
      {
        content: updateModelBlock(readOptionalFile(agentsPath), modelSheet),
        path: agentsPath,
      }
    );
  }
  return plans;
}

function replaceFrontmatterName(
  source: string,
  generatedName: string,
  directoryName: string
): string {
  const header = source.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (header === null) {
    throw new Error(`${directoryName}/SKILL.md has no YAML frontmatter`);
  }
  const frontmatter = header[1];
  const namePattern = /(^|\n)([ \t]*name:[ \t]*)([^\r\n]*)/g;
  const matches = [...frontmatter.matchAll(namePattern)];
  if (matches.length !== 1) {
    throw new Error(
      `${directoryName}/SKILL.md must have exactly one frontmatter name`
    );
  }
  const generatedFrontmatter = frontmatter.replace(
    namePattern,
    `$1$2${generatedName}`
  );
  const generatedHeader = header[0].replace(
    frontmatter,
    generatedFrontmatter
  );
  const body = source.slice(header[0].length);
  const note =
    `> **OpenCode 2:** This generated skill is named \`${generatedName}\` to avoid collisions. ` +
    "Map unprefixed pstack skill names to `pstack-*`. " +
    "Resolve tools with [`opencode-tools.md`](../pstack-poteto-mode/references/opencode-tools.md); " +
    "plugin agents are under [`../../agents`](../../agents).";
  return `${generatedHeader}${note}\n\n${body}`;
}

function rewriteSiblingSkillLinks(
  markdown: string,
  sourceNames: readonly string[]
): string {
  const alternatives = sourceNames
    .map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  const siblingPath = new RegExp(
    `((?:\\.\\./)+)(${alternatives})(?=/)`,
    "g"
  );
  return markdown.replace(
    siblingPath,
    (_match, parents: string, sourceName: string) =>
      `${parents}pstack-${sourceName}`
  );
}

function prepareGeneratedSkills(metadata: PluginMetadata): GeneratedSkill[] {
  const sourceSkillsRoot = join(metadata.pluginRoot, "skills");
  const directories = readdirSync(sourceSkillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  if (directories.length === 0) {
    throw new Error(`No pstack skills found in ${sourceSkillsRoot}`);
  }
  const sourceNames = directories.map((entry) => entry.name);

  const generatedSkills = directories.map((entry) => {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(entry.name)) {
      throw new Error(`Unsafe pstack skill directory name: ${entry.name}`);
    }
    const sourceDirectory = join(sourceSkillsRoot, entry.name);
    const skillPath = join(sourceDirectory, "SKILL.md");
    if (!existsSync(skillPath) || !lstatSync(skillPath).isFile()) {
      throw new Error(`Missing skill definition: ${skillPath}`);
    }
    const generatedName = `pstack-${entry.name}`;
    return {
      directoryName: generatedName,
      skillMarkdown: rewriteSiblingSkillLinks(
        replaceFrontmatterName(
          readFileSync(skillPath, "utf8"),
          generatedName,
          entry.name
        ),
        sourceNames
      ),
      sourceDirectory,
    };
  });

  const mappingPath = join(
    sourceSkillsRoot,
    "poteto-mode",
    "references",
    "opencode-tools.md"
  );
  if (!existsSync(mappingPath)) {
    throw new Error(`Missing OpenCode tool mapping: ${mappingPath}`);
  }
  const agentsPath = join(metadata.pluginRoot, "agents");
  if (!existsSync(agentsPath) || !lstatSync(agentsPath).isDirectory()) {
    throw new Error(`Missing plugin agents directory: ${agentsPath}`);
  }
  return generatedSkills;
}

function ownedViewMarker(versionRoot: string): JsonObject | undefined {
  const markerPath = join(versionRoot, MANAGED_VIEW_MARKER);
  if (!existsSync(markerPath)) {
    return undefined;
  }
  const markerStat = lstatSync(markerPath);
  if (!markerStat.isFile() || markerStat.isSymbolicLink()) {
    return undefined;
  }
  try {
    return parseJsonObject(readFileSync(markerPath, "utf8"), markerPath);
  } catch {
    return undefined;
  }
}

function isOwnedVersionRoot(versionRoot: string): boolean {
  const marker = ownedViewMarker(versionRoot);
  return (
    marker?.owner === "open-pstack" &&
    marker?.harness === "opencode2" &&
    marker?.format === MANAGED_VIEW_FORMAT
  );
}

function assertReplaceableVersionRoot(versionRoot: string): void {
  if (!existsSync(versionRoot)) {
    return;
  }
  const stat = lstatSync(versionRoot);
  if (!stat.isDirectory() || stat.isSymbolicLink() || !isOwnedVersionRoot(versionRoot)) {
    throw new Error(
      `Refusing to replace unowned OpenCode view: ${versionRoot}`
    );
  }
}

function managedSkillsPath(
  candidate: string,
  managedRoot: string,
  currentSkillsRoot: string
): boolean {
  const resolvedCandidate = resolve(candidate);
  if (resolvedCandidate === currentSkillsRoot) {
    return true;
  }
  if (
    basename(resolvedCandidate) !== "skills" ||
    dirname(dirname(resolvedCandidate)) !== managedRoot
  ) {
    return false;
  }
  return isOwnedVersionRoot(dirname(resolvedCandidate));
}

function validatePermissions(value: unknown, configPath: string): JsonObject[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value) || !value.every(isObject)) {
    throw new Error(`${configPath}.permissions must be an array of objects`);
  }
  for (const permission of value) {
    if (
      typeof permission.action !== "string" ||
      typeof permission.resource !== "string" ||
      typeof permission.effect !== "string"
    ) {
      throw new Error(
        `${configPath}.permissions entries must have string action, resource, and effect fields`
      );
    }
  }
  return value;
}

function isManagedAgent(value: JsonObject): boolean {
  if (value.mode !== "primary" || typeof value.system !== "string") {
    return false;
  }
  if (value.system.startsWith(OPEN_CODE_AGENT_SYSTEM_PREFIX)) {
    return true;
  }
  return (
    value.description === OPEN_CODE_AGENT_DESCRIPTION &&
    value.model === OPEN_CODE_AGENT_MODEL &&
    value.system.startsWith(OPEN_CODE_LEGACY_AGENT_SYSTEM_PREFIX)
  );
}

function desiredOpenCodeAgent(mappingPath: string): JsonObject {
  return {
    description: OPEN_CODE_AGENT_DESCRIPTION,
    mode: "primary",
    model: OPEN_CODE_AGENT_MODEL,
    system:
      `${OPEN_CODE_AGENT_SYSTEM_PREFIX} ` +
      `${OPEN_CODE_LEGACY_AGENT_SYSTEM_PREFIX} ` +
      `Before working, read ${mappingPath}. ` +
      "Resolve provider routes once in the parent; children never reroute themselves. " +
      `Start non-interactive sessions with \`${OPEN_CODE_ENTRY}\`.`,
  };
}

function prepareOpenCodeConfig(
  homeDir: string,
  managedRoot: string,
  skillsRoot: string,
  configureDefaults: boolean
): FilePlan {
  const configPath = join(homeDir, ".config", "opencode", "opencode2.json");
  const configExists = existsSync(configPath);
  const config = configExists
    ? parseJsonObject(readFileSync(configPath, "utf8"), configPath)
    : { $schema: "https://opencode.ai/config.json" };

  const existingSkills = config.skills;
  if (
    existingSkills !== undefined &&
    (!Array.isArray(existingSkills) ||
      !existingSkills.every((item) => typeof item === "string"))
  ) {
    throw new Error(`${configPath}.skills must be an array of strings`);
  }
  config.skills = [
    ...((existingSkills ?? []) as string[]).filter(
      (item) => !managedSkillsPath(item, managedRoot, skillsRoot)
    ),
    skillsRoot,
  ];

  const permissions = validatePermissions(config.permissions, configPath);
  config.permissions = [
    ...permissions.filter(
      (permission) =>
        !(
          permission.action === "skill" &&
          permission.resource === "pstack-*" &&
          permission.effect === "allow"
        )
    ),
    { action: "skill", resource: "pstack-*", effect: "allow" },
  ];

  if (configureDefaults) {
    if (config.agents !== undefined && !isObject(config.agents)) {
      throw new Error(`${configPath}.agents must be an object`);
    }
    const agents = (config.agents ?? {}) as JsonObject;
    const existingAgent = agents.pstack;
    if (
      existingAgent !== undefined &&
      (!isObject(existingAgent) || !isManagedAgent(existingAgent))
    ) {
      throw new Error(
        `${configPath}.agents.pstack is not managed by open-pstack; refusing to overwrite it`
      );
    }
    const mappingPath = join(
      skillsRoot,
      "pstack-poteto-mode",
      "references",
      "opencode-tools.md"
    );
    config.agents = {
      ...agents,
      pstack: desiredOpenCodeAgent(mappingPath),
    };
  }

  return {
    content: `${JSON.stringify(config, null, 2)}\n`,
    path: configPath,
  };
}

function prepareOpenCode(
  metadata: PluginMetadata,
  homeDir: string,
  configureDefaults: boolean
): OpenCodePlan {
  const managedRoot = resolve(
    homeDir,
    ".local",
    "share",
    "pstack",
    "opencode2"
  );
  const versionRoot = join(managedRoot, metadata.version);
  const skillsRoot = join(versionRoot, "skills");
  assertReplaceableVersionRoot(versionRoot);
  const generatedSkills = prepareGeneratedSkills(metadata);
  const config = prepareOpenCodeConfig(
    homeDir,
    managedRoot,
    skillsRoot,
    configureDefaults
  );
  return { config, generatedSkills, skillsRoot, versionRoot };
}

function relativeSymlink(source: string, destination: string): void {
  const target = relative(dirname(destination), source);
  symlinkSync(target, destination);
}

function containsMarkdown(source: string): boolean {
  const stat = lstatSync(source);
  if (stat.isSymbolicLink()) {
    return false;
  }
  if (stat.isFile()) {
    return source.toLowerCase().endsWith(".md");
  }
  if (!stat.isDirectory()) {
    return false;
  }
  if (basename(source) === "node_modules") {
    return false;
  }
  return readdirSync(source).some((name) =>
    containsMarkdown(join(source, name))
  );
}

function mirrorSupportEntry(
  source: string,
  destination: string,
  sourceNames: readonly string[]
): void {
  const stat = lstatSync(source);
  if (stat.isFile() && source.toLowerCase().endsWith(".md")) {
    writeFileSync(
      destination,
      rewriteSiblingSkillLinks(readFileSync(source, "utf8"), sourceNames)
    );
    return;
  }
  if (
    stat.isDirectory() &&
    basename(source) !== "scripts" &&
    containsMarkdown(source)
  ) {
    mkdirSync(destination);
    for (const name of readdirSync(source).sort()) {
      mirrorSupportEntry(
        join(source, name),
        join(destination, name),
        sourceNames
      );
    }
    return;
  }
  relativeSymlink(source, destination);
}

function buildVersionView(
  plan: OpenCodePlan,
  metadata: PluginMetadata
): string {
  const parent = dirname(plan.versionRoot);
  mkdirSync(parent, { recursive: true });
  const temporaryRoot = join(
    parent,
    `.${basename(plan.versionRoot)}.tmp-${randomUUID()}`
  );
  mkdirSync(join(temporaryRoot, "skills"), { recursive: true });
  try {
    const sourceNames = plan.generatedSkills.map((skill) =>
      basename(skill.sourceDirectory)
    );
    writeFileSync(
      join(temporaryRoot, MANAGED_VIEW_MARKER),
      `${JSON.stringify(
        {
          format: MANAGED_VIEW_FORMAT,
          harness: "opencode2",
          owner: "open-pstack",
          version: metadata.version,
        },
        null,
        2
      )}\n`
    );
    for (const skill of plan.generatedSkills) {
      const generatedDirectory = join(
        temporaryRoot,
        "skills",
        skill.directoryName
      );
      mkdirSync(generatedDirectory);
      writeFileSync(join(generatedDirectory, "SKILL.md"), skill.skillMarkdown);
      for (const entry of readdirSync(skill.sourceDirectory).sort()) {
        if (entry === "SKILL.md") {
          continue;
        }
        mirrorSupportEntry(
          join(skill.sourceDirectory, entry),
          join(generatedDirectory, entry),
          sourceNames
        );
      }
    }
    relativeSymlink(
      join(metadata.pluginRoot, "agents"),
      join(temporaryRoot, "agents")
    );
    relativeSymlink(
      join(metadata.pluginRoot, "config"),
      join(temporaryRoot, "config")
    );
    return temporaryRoot;
  } catch (error) {
    rmSync(temporaryRoot, { force: true, recursive: true });
    throw error;
  }
}

function replaceVersionView(temporaryRoot: string, versionRoot: string): void {
  assertReplaceableVersionRoot(versionRoot);
  if (!existsSync(versionRoot)) {
    renameSync(temporaryRoot, versionRoot);
    return;
  }

  const backupRoot = join(
    dirname(versionRoot),
    `.${basename(versionRoot)}.backup-${randomUUID()}`
  );
  renameSync(versionRoot, backupRoot);
  try {
    renameSync(temporaryRoot, versionRoot);
  } catch (error) {
    renameSync(backupRoot, versionRoot);
    throw error;
  }
  rmSync(backupRoot, { force: true, recursive: true });
}

function writeFileAtomically(plan: FilePlan): void {
  if (existsSync(plan.path) && readFileSync(plan.path, "utf8") === plan.content) {
    return;
  }
  const parent = dirname(plan.path);
  mkdirSync(parent, { recursive: true });
  const temporaryPath = join(
    parent,
    `.${basename(plan.path)}.tmp-${randomUUID()}`
  );
  writeFileSync(temporaryPath, plan.content);
  try {
    renameSync(temporaryPath, plan.path);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
}

function applyOpenCode(
  plan: OpenCodePlan,
  metadata: PluginMetadata
): void {
  const temporaryRoot = buildVersionView(plan, metadata);
  try {
    replaceVersionView(temporaryRoot, plan.versionRoot);
  } catch (error) {
    if (existsSync(temporaryRoot)) {
      rmSync(temporaryRoot, { force: true, recursive: true });
    }
    throw error;
  }
  writeFileAtomically(plan.config);
}

function selectedHarnesses(
  harness: Harness
): readonly Exclude<Harness, "all">[] {
  return harness === "all" ? ["codex", "opencode2"] : [harness];
}

export function installPstack(options: InstallOptions): InstallResult {
  const harnesses = selectedHarnesses(options.harness);
  const configuredHome = options.homeDir ?? process.env.HOME;
  if (configuredHome === undefined || configuredHome.length === 0) {
    throw new Error("Cannot install without a home directory");
  }
  const homeDir = resolve(configuredHome);
  const metadata = readMetadata(options.pluginRoot ?? DEFAULT_PLUGIN_ROOT);
  const configureDefaults = options.configureDefaults ?? false;
  const openCodePlan = harnesses.includes("opencode2")
    ? prepareOpenCode(metadata, homeDir, configureDefaults)
    : undefined;
  const defaultFiles = planDefaultFiles(
    metadata,
    homeDir,
    harnesses,
    configureDefaults
  );

  if (harnesses.includes("codex")) {
    installCodex(metadata, options.execute ?? defaultExecutor);
  }
  if (openCodePlan !== undefined) {
    applyOpenCode(openCodePlan, metadata);
  }
  for (const file of defaultFiles) {
    writeFileAtomically(file);
  }

  return {
    harnesses,
    ...(openCodePlan === undefined
      ? {}
      : {
          openCodeEntry: OPEN_CODE_ENTRY,
          openCodeSkillsRoot: openCodePlan.skillsRoot,
        }),
    version: metadata.version,
  };
}

function usage(): string {
  return (
    "Usage: bun scripts/install.ts --harness <codex|opencode2|all> [--configure-defaults]\n"
  );
}

function isHarness(value: string | undefined): value is Harness {
  return HARNESSES.some((candidate) => candidate === value);
}

function parseArguments(
  argv: readonly string[]
):
  | { help: true }
  | { configureDefaults: boolean; harness: Harness } {
  let harness: Harness | undefined;
  let configureDefaults = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--configure-defaults") {
      configureDefaults = true;
      continue;
    }
    if (argument === "--harness") {
      const value = argv[index + 1];
      if (!isHarness(value)) {
        throw new Error("--harness must be codex, opencode2, or all");
      }
      harness = value;
      index += 1;
      continue;
    }
    if (argument === "--help" || argument === "-h") {
      return { help: true };
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  if (harness === undefined) {
    throw new Error("Missing required --harness option");
  }
  return { configureDefaults, harness };
}

export function runInstallerCli(argv: readonly string[]): number {
  try {
    const arguments_ = parseArguments(argv);
    if ("help" in arguments_) {
      process.stdout.write(usage());
      return 0;
    }
    const result = installPstack(arguments_);
    process.stdout.write(
      `Installed open-pstack ${result.version} for ${result.harnesses.join(
        ", "
      )}.\n`
    );
    if (result.openCodeEntry !== undefined) {
      process.stdout.write(`Start with: ${result.openCodeEntry}\n`);
    }
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`open-pstack install failed: ${message}\n`);
    return 1;
  }
}

if (import.meta.main) {
  process.exitCode = runInstallerCli(process.argv.slice(2));
}
