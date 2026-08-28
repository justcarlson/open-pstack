import type {
  ExecutionHarness,
  NormalizedUsage,
  ParsedOutput,
} from "./types.ts";

type JsonObject = Record<string, unknown>;

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : null;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function normalizedUsage(value: unknown): NormalizedUsage | null {
  const usage = object(value);
  if (usage === null) return null;
  const result: NormalizedUsage = {
    inputTokens: finiteNumber(usage.input_tokens ?? usage.input),
    cachedInputTokens: finiteNumber(
      usage.cached_input_tokens ??
        usage.cache_read_input_tokens ??
        usage.cacheRead
    ),
    cacheCreationInputTokens: finiteNumber(
      usage.cache_creation_input_tokens ??
        usage.cache_write_input_tokens ??
        usage.cacheWrite
    ),
    outputTokens: finiteNumber(usage.output_tokens ?? usage.output),
    reasoningTokens: finiteNumber(
      usage.reasoning_tokens ?? usage.reasoning_output_tokens
    ),
    totalTokens: finiteNumber(usage.total_tokens ?? usage.totalTokens),
  };
  return Object.values(result).some((entry) => entry !== undefined)
    ? result
    : null;
}

function modelFromUsage(value: unknown, requestedModel: string): string | null {
  const usage = object(value);
  if (usage === null) return null;
  const models = Object.keys(usage);
  return models.find((model) => reportedModelMatches(requestedModel, model))
    ?? models[0]
    ?? null;
}

function parseClaude(stdout: string, requestedModel: string): ParsedOutput {
  let raw: unknown;
  try {
    raw = JSON.parse(stdout);
  } catch {
    throw new Error("claude did not emit valid JSON");
  }
  const value = object(raw);
  if (value === null) throw new Error("claude emitted a non-object result");

  const text = nullableString(value.result);
  if (text === null) throw new Error("claude result did not contain final text");
  if (value.is_error === true) throw new Error("claude reported an error result");

  return {
    text,
    reportedApiProvider: null,
    reportedModel: modelFromUsage(value.modelUsage, requestedModel),
    sessionId: nullableString(value.session_id ?? value.sessionId),
    usage: normalizedUsage(value.usage),
    costUsd: finiteNumber(value.total_cost_usd) ?? null,
  };
}

function parseGrok(stdout: string, requestedModel: string): ParsedOutput {
  let result: JsonObject | null = null;
  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      throw new Error("grok emitted a non-JSON event");
    }
    const event = object(raw);
    if (event?.type === "result") result = event;
  }

  if (result === null) throw new Error("grok result did not contain a terminal event");
  if (result.is_error === true || result.subtype !== "success") {
    throw new Error("grok reported an error result");
  }
  const text = nullableString(result.result);
  if (text === null) throw new Error("grok result did not contain final text");

  return {
    text,
    reportedModel: modelFromUsage(result.modelUsage, requestedModel),
    reportedApiProvider: null,
    sessionId: nullableString(result.session_id),
    usage: normalizedUsage(result.usage),
    costUsd: finiteNumber(result.total_cost_usd) ?? null,
  };
}

function parseCodex(stdout: string): ParsedOutput {
  let text: string | null = null;
  let usage: NormalizedUsage | null = null;
  let sessionId: string | null = null;

  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      throw new Error("codex emitted a non-JSON event");
    }
    const event = object(raw);
    if (event === null) continue;
    if (event.type === "thread.started") {
      sessionId = nullableString(event.thread_id) ?? sessionId;
    }
    if (event.type === "item.completed") {
      const item = object(event.item);
      if (item?.type === "agent_message") {
        text = nullableString(item.text) ?? text;
      }
    }
    if (event.type === "turn.completed") {
      usage = normalizedUsage(event.usage) ?? usage;
    }
    if (event.type === "turn.failed") {
      const error = object(event.error);
      throw new Error(nullableString(error?.message) ?? "codex reported a failed turn");
    }
  }

  if (text === null) throw new Error("codex result did not contain a final agent message");
  return {
    text,
    reportedModel: null,
    reportedApiProvider: null,
    sessionId,
    usage,
    costUsd: null,
  };
}

function textContent(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  let text = "";
  for (const rawBlock of value) {
    const block = object(rawBlock);
    if (block?.type === "text" && typeof block.text === "string") {
      text += block.text;
    }
  }
  return nullableString(text);
}

function parseOmp(stdout: string): ParsedOutput {
  let finalMessage: JsonObject | null = null;
  let sessionId: string | null = null;
  let terminal = false;

  for (const line of stdout.split("\n")) {
    if (line.trim().length === 0) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      throw new Error("omp emitted a non-JSON event");
    }
    const event = object(raw);
    if (event === null) continue;
    if (event.type === "retry_fallback_applied") {
      throw new Error("omp reported a model fallback");
    }
    if (event.type === "session") {
      sessionId = nullableString(event.id) ?? sessionId;
    }
    if (event.type === "message_end") {
      const message = object(event.message);
      if (message?.role === "assistant") finalMessage = message;
    }
    if (event.type === "agent_end" && event.isTerminal !== false) {
      terminal = true;
    }
  }

  if (!terminal) throw new Error("omp result did not contain a terminal event");
  if (finalMessage === null) {
    throw new Error("omp result did not contain a final assistant message");
  }
  if (
    finalMessage.stopReason === "error" ||
    finalMessage.stopReason === "aborted"
  ) {
    throw new Error(`omp reported ${finalMessage.stopReason}`);
  }
  const text = textContent(finalMessage.content);
  if (text === null) throw new Error("omp result did not contain final text");
  const usage = object(finalMessage.usage);
  const cost = object(usage?.cost);

  return {
    text,
    reportedApiProvider: nullableString(finalMessage.provider),
    reportedModel: nullableString(finalMessage.model),
    sessionId,
    usage: normalizedUsage(usage),
    costUsd: finiteNumber(cost?.total) ?? null,
  };
}

export function parseHarnessOutput(
  harness: ExecutionHarness,
  stdout: string,
  stderr: string,
  requestedModel: string
): ParsedOutput {
  switch (harness) {
    case "claude":
      return parseClaude(stdout, requestedModel);
    case "codex":
      return parseCodex(stdout);
    case "grok":
      return parseGrok(stdout, requestedModel);
    case "omp":
      return parseOmp(stdout);
  }

}

export function reportedModelMatches(
  requested: string,
  reported: string | null
): boolean {
  if (reported === null) return false;
  return reported === requested || reported.startsWith(`${requested}-`);
}
