import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openScopedGateway } from "./gateway.ts";

const UPSTREAM_URL = "https://openrouter.ai/api/v1/responses";
const scratchDirectories: string[] = [];
const originalFetch = globalThis.fetch;

function scratch(): { readonly directory: string; readonly ledgerPath: string } {
  const directory = mkdtempSync(join(tmpdir(), "pstack-gateway-"));
  scratchDirectories.push(directory);
  return { directory, ledgerPath: join(directory, "budget.sqlite") };
}

function authorization(token: string): HeadersInit {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

function fakeUpstream(
  handler: (request: Request) => Response | Promise<Response>
): { readonly server: Bun.Server<undefined>; readonly url: string } {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 0,
    fetch: handler,
  });
  return { server, url: `http://127.0.0.1:${server.port}/responses` };
}

function routeFetchTo(url: string): void {
  globalThis.fetch = Object.assign(
    async (
      input: Parameters<typeof originalFetch>[0],
      init?: Parameters<typeof originalFetch>[1]
    ) => {
      expect(String(input)).toBe(UPSTREAM_URL);
      return originalFetch(url, init);
    },
    { preconnect: originalFetch.preconnect }
  );
}

afterEach(async () => {
  globalThis.fetch = originalFetch;
  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("scoped Responses gateway", () => {
  it("requires its lane token before parsing or forwarding", async () => {
    const state = scratch();
    let calls = 0;
    globalThis.fetch = Object.assign(
      async () => {
        calls += 1;
        return new Response("unexpected");
      },
      { preconnect: originalFetch.preconnect }
    );
    const gateway = await openScopedGateway({
      taskId: "task-auth",
      laneId: "lane-auth",
      env: { OPENROUTER_API_KEY: "upstream-secret" },
      ledgerPath: state.ledgerPath,
    });
    const response = await originalFetch(`${gateway.binding.baseUrl}/responses`, {
      method: "POST",
      body: "{}",
    });
    expect(response.status).toBe(401);
    expect(calls).toBe(0);
    const firstClose = await gateway.close();
    expect(firstClose).toMatchObject({ requestCount: 0 });
    expect(await gateway.close()).toEqual(firstClose);
  });

  it("pins route fields while allowing local function and custom tools", async () => {
    const state = scratch();
    let forwarded: unknown = null;
    const upstream = fakeUpstream(async (request) => {
      forwarded = await request.json();
      return Response.json({
        id: "gen-json",
        model: "z-ai/glm-5.3-flash",
        output: [],
        usage: { cost: 0.01 },
      });
    });
    routeFetchTo(upstream.url);
    const gateway = await openScopedGateway({
      taskId: "task-route",
      laneId: "lane-route",
      env: { OPENROUTER_API_KEY: "upstream-secret" },
      ledgerPath: state.ledgerPath,
    });
    try {
      const response = await originalFetch(`${gateway.binding.baseUrl}/responses`, {
        method: "POST",
        headers: authorization(gateway.binding.token),
        body: JSON.stringify({
          model: "attacker/model",
          max_output_tokens: 999_999,
          reasoning: { effort: "low", summary: "auto" },
          parallel_tool_calls: true,
          include: ["reasoning.encrypted_content"],
          service_tier: "priority",
          provider: { only: ["attacker/provider"], allow_fallbacks: true },
          input: "read a local marker",
          tools: [
            { type: "function", name: "shell", parameters: {} },
            { type: "custom", name: "apply_patch" },
          ],
        }),
      });
      expect(response.status).toBe(200);
      await response.text();
      expect(forwarded).toMatchObject({
        model: "z-ai/glm-5.3-flash",
        max_output_tokens: 16_384,
        reasoning: { effort: "max" },
        provider: {
          only: ["z-ai/fp8"],
          allow_fallbacks: false,
          require_parameters: true,
          max_price: { prompt: 0.15, completion: 0.5, request: 0, image: 0 },
        },
      });
      expect(forwarded).not.toHaveProperty("parallel_tool_calls");
      expect(forwarded).not.toHaveProperty("include");
      expect(forwarded).not.toHaveProperty("service_tier");
      expect(await gateway.close()).toMatchObject({
        requestCount: 1,
        chargedUsd: 0.01,
        heldUsd: 0,
        generationIds: ["gen-json"],
        reportedModels: ["z-ai/glm-5.3-flash"],
        providerEndpoint: "z-ai/fp8",
        failure: null,
      });
    } finally {
      await upstream.server.stop(true);
    }
  });

  it.each([
    { input: [{ role: "user", content: [{ type: "input_image", image_url: "https://example.com/a.png" }] }] },
    { input: [{ role: "user", content: [{ type: "input_file", file_url: "https://example.com/a.pdf" }] }] },
    { input: "search", tools: [{ type: "web_search" }] },
    { input: "search", tools: [{ type: "file_search", vector_store_ids: ["remote"] }] },
    { input: "search", plugins: [{ id: "web" }] },
  ])("rejects media, remote inputs, and chargeable server tools", async (body) => {
    const state = scratch();
    let calls = 0;
    globalThis.fetch = Object.assign(
      async () => {
        calls += 1;
        return new Response("unexpected");
      },
      { preconnect: originalFetch.preconnect }
    );
    const gateway = await openScopedGateway({
      taskId: "task-deny",
      laneId: crypto.randomUUID(),
      env: { OPENROUTER_API_KEY: "upstream-secret" },
      ledgerPath: state.ledgerPath,
    });
    const response = await originalFetch(`${gateway.binding.baseUrl}/responses`, {
      method: "POST",
      headers: authorization(gateway.binding.token),
      body: JSON.stringify(body),
    });
    expect(response.status).toBe(400);
    expect(calls).toBe(0);
    expect((await gateway.close()).requestCount).toBe(0);
  });

  it("parses a split SSE terminal event and reconciles trusted cost", async () => {
    const state = scratch();
    const payload = `data: ${JSON.stringify({
      type: "response.completed",
      response: {
        id: "gen-sse",
        model: "z-ai/glm-5.3-flash-202609",
        usage: { cost: 0.012345 },
      },
    })}\n\n`;
    const upstream = fakeUpstream(() => {
      const stream = new ReadableStream<Uint8Array>({
        async start(controller) {
          const encoded = new TextEncoder().encode(payload);
          controller.enqueue(encoded.slice(0, 17));
          await Bun.sleep(5);
          controller.enqueue(encoded.slice(17));
          controller.close();
        },
      });
      return new Response(stream, { headers: { "content-type": "text/event-stream" } });
    });
    routeFetchTo(upstream.url);
    const gateway = await openScopedGateway({
      taskId: "task-sse",
      laneId: "lane-sse",
      env: { OPENROUTER_API_KEY: "upstream-secret" },
      ledgerPath: state.ledgerPath,
    });
    try {
      const response = await originalFetch(`${gateway.binding.baseUrl}/responses`, {
        method: "POST",
        headers: authorization(gateway.binding.token),
        body: JSON.stringify({ input: "hello", stream: true }),
      });
      expect(await response.text()).toBe(payload);
      expect(await gateway.close()).toMatchObject({
        chargedUsd: 0.012345,
        heldUsd: 0,
        generationIds: ["gen-sse"],
        reportedModels: ["z-ai/glm-5.3-flash-202609"],
      });
    } finally {
      await upstream.server.stop(true);
    }
  });

  it("retains the full reservation for malformed terminal cost", async () => {
    const state = scratch();
    const upstream = fakeUpstream(() =>
      Response.json({
        id: "gen-bad-cost",
        model: "z-ai/glm-5.3-flash",
        output: [],
        usage: { cost: "unknown" },
      })
    );
    routeFetchTo(upstream.url);
    const gateway = await openScopedGateway({
      taskId: "task-bad-cost",
      laneId: "lane-bad-cost",
      env: { OPENROUTER_API_KEY: "upstream-secret" },
      ledgerPath: state.ledgerPath,
    });
    try {
      const response = await originalFetch(`${gateway.binding.baseUrl}/responses`, {
        method: "POST",
        headers: authorization(gateway.binding.token),
        body: JSON.stringify({ input: "hello" }),
      });
      await response.text();
      expect(await gateway.close()).toMatchObject({
        requestCount: 1,
        chargedUsd: 0,
        heldUsd: 0.165479,
        failure: expect.stringContaining("trusted usage.cost"),
      });
    } finally {
      await upstream.server.stop(true);
    }
  });

  it("records the charge but fails evidence for an unexpected reported model", async () => {
    const state = scratch();
    const upstream = fakeUpstream(() =>
      Response.json({
        id: "gen-wrong-model",
        model: "attacker/model",
        output: [],
        usage: { cost: 0.01 },
      })
    );
    routeFetchTo(upstream.url);
    const gateway = await openScopedGateway({
      taskId: "task-wrong-model",
      laneId: "lane-wrong-model",
      env: { OPENROUTER_API_KEY: "upstream-secret" },
      ledgerPath: state.ledgerPath,
    });
    try {
      const response = await originalFetch(`${gateway.binding.baseUrl}/responses`, {
        method: "POST",
        headers: authorization(gateway.binding.token),
        body: JSON.stringify({ input: "hello" }),
      });
      await response.text();
      expect(await gateway.close()).toMatchObject({
        chargedUsd: 0.01,
        heldUsd: 0,
        reportedModels: ["attacker/model"],
        failure: expect.stringContaining("unexpected model"),
      });
    } finally {
      await upstream.server.stop(true);
    }
  });

  it("aborts in-flight upstream work and retains its reservation on close", async () => {
    const state = scratch();
    let upstreamStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      upstreamStarted = resolve;
    });
    const upstream = fakeUpstream(() => {
      upstreamStarted();
      return new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("data: {\"type\":\"response.created\"}\n\n"));
          },
        }),
        { headers: { "content-type": "text/event-stream" } }
      );
    });
    routeFetchTo(upstream.url);
    const gateway = await openScopedGateway({
      taskId: "task-cancel",
      laneId: "lane-cancel",
      env: { OPENROUTER_API_KEY: "upstream-secret" },
      ledgerPath: state.ledgerPath,
    });
    try {
      const response = await originalFetch(`${gateway.binding.baseUrl}/responses`, {
        method: "POST",
        headers: authorization(gateway.binding.token),
        body: JSON.stringify({ input: "hello", stream: true }),
      });
      await started;
      expect(response.status).toBe(200);
      const evidence = await gateway.close();
      expect(evidence).toMatchObject({
        requestCount: 1,
        chargedUsd: 0,
        heldUsd: 0.165479,
        failure: expect.stringContaining("aborted"),
      });
    } finally {
      await upstream.server.stop(true);
    }
  });
});
