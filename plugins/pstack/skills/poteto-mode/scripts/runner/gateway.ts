import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  BudgetExceededError,
  MAX_COMPLETION_PRICE_USD_PER_MILLION,
  MAX_PROMPT_PRICE_USD_PER_MILLION,
  RESERVED_OUTPUT_TOKENS,
  defaultBudgetLedgerPath,
  openBudgetLedger,
  type BudgetLedger,
  type LedgerEvidence,
} from "./budget-ledger.ts";

const UPSTREAM_URL = "https://openrouter.ai/api/v1/responses";
const MODEL = "z-ai/glm-5.3-flash";
const PROVIDER_ENDPOINT = "z-ai/fp8" as const;
const MAX_REQUEST_BODY_BYTES = 32 * 1024 * 1024;
const MAX_BUFFERED_RESPONSE_BYTES = 8 * 1024 * 1024;
const MAX_SSE_EVENT_CHARACTERS = 1024 * 1024;

const ALLOWED_REQUEST_FIELDS = new Set([
  "client_metadata",
  "include",
  "input",
  "instructions",
  "max_output_tokens",
  "max_tool_calls",
  "metadata",
  "model",
  "parallel_tool_calls",
  "prompt_cache_key",
  "prompt_cache_retention",
  "provider",
  "reasoning",
  "safety_identifier",
  "service_tier",
  "store",
  "stream",
  "stream_options",
  "temperature",
  "text",
  "tool_choice",
  "tools",
  "top_logprobs",
  "top_p",
  "truncation",
  "user",
]);

const FORBIDDEN_INPUT_TYPES = new Set([
  "input_audio",
  "input_file",
  "input_image",
  "item_reference",
  "file_search_call",
  "web_search_call",
  "audio",
  "image",
  "image_url",
]);
const FORBIDDEN_INPUT_KEYS = new Set([
  "audio_url",
  "file_data",
  "file_id",
  "file_url",
  "image_url",
]);
const ALLOWED_TOOL_TYPES = new Set(["function", "custom"]);

export interface GatewayBinding {
  readonly baseUrl: string;
  readonly token: string;
  readonly protectedPaths: readonly string[];
}

export interface PaidRouteEvidence {
  readonly taskId: string;
  readonly laneId: string;
  readonly requestCount: number;
  readonly chargedUsd: number;
  readonly heldUsd: number;
  readonly generationIds: readonly string[];
  readonly reportedModels: readonly string[];
  readonly providerEndpoint: typeof PROVIDER_ENDPOINT;
  readonly failure: string | null;
}

export interface ScopedGateway {
  readonly binding: GatewayBinding;
  close(): Promise<PaidRouteEvidence>;
}

export interface OpenScopedGatewayOptions {
  readonly taskId: string;
  readonly laneId: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  readonly ledgerPath?: string;
}

interface JsonObject {
  [key: string]: unknown;
}

interface TerminalObservation {
  readonly cost: unknown;
  readonly generationId?: string;
  readonly reportedModel?: string;
}

class RequestError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "RequestError";
    this.status = status;
  }
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateIdentifier(name: string, value: string): void {
  if (value.length === 0 || value.length > 512) {
    throw new TypeError(`${name} must contain between 1 and 512 characters`);
  }
}

function openCodeCredentialDirectory(env: Readonly<Record<string, string | undefined>>): string {
  return join(resolve(env.XDG_DATA_HOME?.trim() || join(homedir(), ".local", "share")), "opencode");
}

function resolveApiKey(env: Readonly<Record<string, string | undefined>>): string {
  const environmentKey = env.OPENROUTER_API_KEY?.trim();
  if (environmentKey) return environmentKey;

  try {
    const raw = readFileSync(join(openCodeCredentialDirectory(env), "auth.json"), "utf8");
    const auth: unknown = JSON.parse(raw);
    if (isObject(auth) && isObject(auth.openrouter)) {
      const entry = auth.openrouter;
      if (entry.type === "api" && typeof entry.key === "string" && entry.key.trim()) {
        return entry.key.trim();
      }
    }
  } catch {
    // Report one stable error below without leaking paths, file contents, or parse details.
  }

  throw new Error("OpenRouter API key is unavailable");
}

function responseHeaders(upstream: Response): Headers {
  const headers = new Headers(upstream.headers);
  headers.delete("connection");
  headers.delete("content-encoding");
  headers.delete("content-length");
  headers.delete("keep-alive");
  headers.delete("transfer-encoding");
  return headers;
}

function errorResponse(status: number, message: string): Response {
  return Response.json({ error: { message } }, { status });
}

async function readBoundedBody(
  body: ReadableStream<Uint8Array> | null,
  maximumBytes: number
): Promise<Uint8Array<ArrayBuffer>> {
  if (body === null) return new Uint8Array();
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > maximumBytes) {
        try {
          await reader.cancel("body exceeds configured limit");
        } catch {
          // Keep the stable size error when cancellation races with disconnect.
        }
        throw new RequestError(413, "request body is too large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const joined = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

async function parseRequestBody(request: Request): Promise<JsonObject> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (Number.isFinite(parsedLength) && parsedLength > MAX_REQUEST_BODY_BYTES) {
      throw new RequestError(413, "request body is too large");
    }
  }

  const bytes = await readBoundedBody(request.body, MAX_REQUEST_BODY_BYTES);
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new RequestError(400, "request body must be valid JSON");
  }
  if (!isObject(value)) throw new RequestError(400, "request body must be a JSON object");
  return value;
}

function hasForbiddenInput(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasForbiddenInput);
  if (!isObject(value)) return false;

  if (typeof value.type === "string" && FORBIDDEN_INPUT_TYPES.has(value.type)) return true;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_INPUT_KEYS.has(key)) return true;
    if (hasForbiddenInput(child)) return true;
  }
  return false;
}

function validatePolicy(body: JsonObject): void {
  for (const field of Object.keys(body)) {
    if (!ALLOWED_REQUEST_FIELDS.has(field)) {
      throw new RequestError(400, "request contains an unsupported field");
    }
  }
  if (hasForbiddenInput(body.input)) {
    throw new RequestError(400, "media and remote file inputs are disabled");
  }

  if (body.include !== undefined) {
    if (
      !Array.isArray(body.include) ||
      body.include.some((value) => value !== "reasoning.encrypted_content")
    ) {
      throw new RequestError(400, "remote response artifacts are disabled");
    }
  }

  if (body.tools === undefined) return;
  if (!Array.isArray(body.tools)) throw new RequestError(400, "tools must be an array");
  for (const tool of body.tools) {
    if (!isObject(tool) || typeof tool.type !== "string" || !ALLOWED_TOOL_TYPES.has(tool.type)) {
      throw new RequestError(400, "only local function and custom tools are allowed");
    }
  }
}

function pinnedBody(body: JsonObject): JsonObject {
  const forwarded: JsonObject = {};
  for (const field of ["input", "instructions", "tools", "tool_choice", "stream", "temperature", "top_p", "text"]) {
    if (body[field] !== undefined) forwarded[field] = body[field];
  }
  return {
    ...forwarded,
    model: MODEL,
    max_output_tokens: RESERVED_OUTPUT_TOKENS,
    reasoning: { effort: "max" },
    store: false,
    provider: {
      only: [PROVIDER_ENDPOINT],
      allow_fallbacks: false,
      require_parameters: true,
      max_price: {
        prompt: MAX_PROMPT_PRICE_USD_PER_MILLION,
        completion: MAX_COMPLETION_PRICE_USD_PER_MILLION,
        request: 0,
        image: 0,
      },
    },
  };
}

function terminalFromObject(value: JsonObject): TerminalObservation {
  const usage = isObject(value.usage) ? value.usage : null;
  return {
    cost: usage?.cost,
    ...(typeof value.id === "string" && value.id.length <= 512 ? { generationId: value.id } : {}),
    ...(typeof value.model === "string" && value.model.length <= 512 ? { reportedModel: value.model } : {}),
  };
}

function terminalFromSseEvent(value: unknown): TerminalObservation | null {
  if (!isObject(value) || value.type !== "response.completed" || !isObject(value.response)) return null;
  return terminalFromObject(value.response);
}

function reconcileTerminal(
  ledger: BudgetLedger,
  reservationId: string,
  terminal: TerminalObservation | null
): void {
  const details = terminal === null
    ? {}
    : {
        ...(terminal.generationId === undefined ? {} : { generationId: terminal.generationId }),
        ...(terminal.reportedModel === undefined ? {} : { reportedModel: terminal.reportedModel }),
      };
  if (terminal === null || typeof terminal.cost !== "number" || !Number.isFinite(terminal.cost) || terminal.cost < 0) {
    ledger.recordFailure(
      reservationId,
      "response did not contain a trusted usage.cost; reservation retained",
      details
    );
    return;
  }
  ledger.reconcile({ reservationId, costUsd: terminal.cost, ...details });
  if (
    terminal.reportedModel !== MODEL &&
    !/^z-ai\/glm-5\.3-flash-(?:\d{6}|\d{8})$/.test(terminal.reportedModel ?? "")
  ) {
    ledger.recordFailure(reservationId, "upstream reported an unexpected model", details);
  }
}

class SseObserver {
  #buffer = "";
  #decoder = new TextDecoder();
  terminal: TerminalObservation | null = null;

  push(bytes: Uint8Array): void {
    this.#buffer += this.#decoder.decode(bytes, { stream: true });
    this.#drain(false);
    if (this.#buffer.length > MAX_SSE_EVENT_CHARACTERS) {
      throw new Error("upstream SSE event exceeds configured limit");
    }
  }

  finish(): void {
    this.#buffer += this.#decoder.decode();
    this.#drain(true);
  }

  #drain(flush: boolean): void {
    while (true) {
      const boundary = this.#buffer.search(/\r?\n\r?\n/);
      if (boundary < 0) break;
      const match = this.#buffer.slice(boundary).match(/^\r?\n\r?\n/);
      const separatorLength = match?.[0].length ?? 2;
      this.#observeFrame(this.#buffer.slice(0, boundary));
      this.#buffer = this.#buffer.slice(boundary + separatorLength);
    }
    if (flush && this.#buffer.trim()) this.#observeFrame(this.#buffer);
    if (flush) this.#buffer = "";
  }

  #observeFrame(frame: string): void {
    const data = frame
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).replace(/^ /, ""))
      .join("\n");
    if (!data || data === "[DONE]") return;
    try {
      const observed = terminalFromSseEvent(JSON.parse(data));
      if (observed !== null) this.terminal = observed;
    } catch {
      // An invalid event cannot provide trusted billing evidence.
    }
  }
}

function safeFailure(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") return "upstream response aborted; reservation retained";
  return "upstream request failed; reservation retained";
}

function toPaidEvidence(
  taskId: string,
  laneId: string,
  evidence: LedgerEvidence,
  runtimeFailure: string | null
): PaidRouteEvidence {
  return {
    taskId,
    laneId,
    requestCount: evidence.requestCount,
    chargedUsd: evidence.chargedMicroUsd / 1_000_000,
    heldUsd: evidence.heldMicroUsd / 1_000_000,
    generationIds: evidence.generationIds,
    reportedModels: evidence.reportedModels,
    providerEndpoint: PROVIDER_ENDPOINT,
    failure: evidence.failure ?? runtimeFailure,
  };
}

function emptyLedgerEvidence(failure: string): LedgerEvidence {
  return {
    requestCount: 0,
    chargedMicroUsd: 0,
    heldMicroUsd: 0,
    generationIds: [],
    reportedModels: [],
    failure,
  };
}

export async function openScopedGateway({
  taskId,
  laneId,
  env = process.env,
  ledgerPath = defaultBudgetLedgerPath(env),
}: OpenScopedGatewayOptions): Promise<ScopedGateway> {
  validateIdentifier("taskId", taskId);
  validateIdentifier("laneId", laneId);
  const apiKey = resolveApiKey(env);
  const ledger = openBudgetLedger(ledgerPath);
  const token = randomBytes(32).toString("base64url");
  const controllers = new Set<AbortController>();
  const handlers = new Set<Promise<Response>>();
  const pumps = new Set<Promise<void>>();
  const runtimeFailures: string[] = [];
  let closing = false;

  function noteFailure(message: string): void {
    if (!runtimeFailures.includes(message)) runtimeFailures.push(message);
  }

  async function proxyUpstream(
    upstream: Response,
    reservationId: string,
    controller: AbortController
  ): Promise<Response> {
    const headers = responseHeaders(upstream);
    const contentType = upstream.headers.get("content-type")?.toLowerCase() ?? "";
    if (!contentType.includes("text/event-stream")) {
      try {
        const bytes = await readBoundedBody(upstream.body, MAX_BUFFERED_RESPONSE_BYTES);
        let terminal: TerminalObservation | null = null;
        try {
          const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
          if (isObject(parsed)) {
            terminal = parsed.type === "response.completed" && isObject(parsed.response)
              ? terminalFromObject(parsed.response)
              : terminalFromObject(parsed);
          }
        } catch {
          // Missing or malformed terminal data retains the reservation below.
        }
        reconcileTerminal(ledger, reservationId, terminal);
        return new Response(bytes, { status: upstream.status, statusText: upstream.statusText, headers });
      } catch (error) {
        const failure = safeFailure(error);
        ledger.recordFailure(reservationId, failure);
        noteFailure(failure);
        return errorResponse(502, "upstream response could not be read");
      } finally {
        controllers.delete(controller);
      }
    }

    if (upstream.body === null) {
      const failure = "upstream response ended without a body; reservation retained";
      ledger.recordFailure(reservationId, failure);
      noteFailure(failure);
      controllers.delete(controller);
      return new Response(null, { status: upstream.status, statusText: upstream.statusText, headers });
    }

    const observer = new SseObserver();
    const reader = upstream.body.getReader();
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(downstream) {
        const pump = (async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              observer.push(value);
              downstream.enqueue(value);
            }
            observer.finish();
            reconcileTerminal(ledger, reservationId, observer.terminal);
            downstream.close();
          } catch (error) {
            const failure = controller.signal.aborted || cancelled || closing
              ? "upstream response aborted; reservation retained"
              : safeFailure(error);
            ledger.recordFailure(reservationId, failure);
            noteFailure(failure);
            try {
              downstream.error(error);
            } catch {
              // The downstream connection may already be closed.
            }
          } finally {
            controllers.delete(controller);
            reader.releaseLock();
          }
        })();
        pumps.add(pump);
        void pump.finally(() => pumps.delete(pump));
      },
      async cancel() {
        cancelled = true;
        controller.abort();
        const failure = "downstream response aborted; reservation retained";
        ledger.recordFailure(reservationId, failure);
        noteFailure(failure);
        try {
          await reader.cancel();
        } catch {
          // The abort may already have closed the upstream reader.
        }
      },
    });
    return new Response(body, { status: upstream.status, statusText: upstream.statusText, headers });
  }

  async function handleRequest(request: Request): Promise<Response> {
    try {
      if (closing) return errorResponse(503, "gateway is closing");
      const url = new URL(request.url);
      if (url.pathname !== "/v1/responses") return errorResponse(404, "not found");
      if (request.method !== "POST") return errorResponse(405, "method not allowed");
      if (request.headers.get("authorization") !== `Bearer ${token}`) {
        return errorResponse(401, "unauthorized");
      }

      const body = await parseRequestBody(request);
      validatePolicy(body);
      if (closing) return errorResponse(503, "gateway is closing");

      const { reservationId } = ledger.reserve({ taskId, laneId });
      const controller = new AbortController();
      controllers.add(controller);
      let upstream: Response;
      try {
        upstream = await globalThis.fetch(UPSTREAM_URL, {
          method: "POST",
          headers: {
            accept: request.headers.get("accept") ?? "application/json",
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(pinnedBody(body)),
          redirect: "error",
          signal: controller.signal,
        });
      } catch (error) {
        controllers.delete(controller);
        const failure = controller.signal.aborted || closing
          ? "upstream request aborted; reservation retained"
          : safeFailure(error);
        ledger.recordFailure(reservationId, failure);
        noteFailure(failure);
        return errorResponse(502, "upstream request failed");
      }
      return proxyUpstream(upstream, reservationId, controller);
    } catch (error) {
      if (error instanceof RequestError) {
        noteFailure(error.message);
        return errorResponse(error.status, error.message);
      }
      if (error instanceof BudgetExceededError) {
        noteFailure(error.message);
        return errorResponse(429, error.message);
      }
      noteFailure("gateway request failed");
      return errorResponse(500, "gateway request failed");
    }
  }

  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    fetch(request) {
      const handler = handleRequest(request);
      handlers.add(handler);
      void handler.finally(() => handlers.delete(handler));
      return handler;
    },
  });

  let closePromise: Promise<PaidRouteEvidence> | null = null;

  async function closeGateway(): Promise<PaidRouteEvidence> {
    closing = true;
    try {
      server.stop(true);
    } catch {
      noteFailure("gateway server did not stop cleanly");
    }
    for (const controller of controllers) controller.abort();

    await Promise.allSettled([...handlers]);
    while (pumps.size > 0) await Promise.allSettled([...pumps]);

    let evidence: LedgerEvidence;
    try {
      evidence = ledger.evidence(laneId);
    } catch {
      const failure = "budget evidence could not be read";
      noteFailure(failure);
      evidence = emptyLedgerEvidence(failure);
    }
    try {
      ledger.close();
    } catch {
      noteFailure("budget ledger did not close cleanly");
    }
    return toPaidEvidence(taskId, laneId, evidence, runtimeFailures[0] ?? null);
  }

  return {
    binding: {
      baseUrl: `http://127.0.0.1:${server.port}/v1`,
      token,
      protectedPaths: [
        openCodeCredentialDirectory(env),
        join(resolve(env.CODEX_HOME?.trim() || join(homedir(), ".codex")), "auth.json"),
        dirname(ledgerPath),
        "/proc",
      ],
    },
    close(): Promise<PaidRouteEvidence> {
      closePromise ??= closeGateway();
      return closePromise;
    },
  };
}
