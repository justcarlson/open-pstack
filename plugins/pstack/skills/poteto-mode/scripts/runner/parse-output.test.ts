import { describe, expect, it } from "bun:test";
import { parseHarnessOutput, reportedModelMatches } from "./parse-output.ts";

describe("parseHarnessOutput", () => {
  it("extracts Claude text, model, usage, cost, and session", () => {
    const parsed = parseHarnessOutput("claude",
    JSON.stringify({
      result: "CLAUDE_OK",
      session_id: "claude-session",
      usage: { input_tokens: 10, output_tokens: 3 },
      total_cost_usd: 0.05,
      modelUsage: { "claude-fable-5": { inputTokens: 10 } },
    }),
    "",
    "claude-fable-5");
    expect(parsed).toMatchObject({
      text: "CLAUDE_OK",
      reportedModel: "claude-fable-5",
      sessionId: "claude-session",
      usage: { inputTokens: 10, outputTokens: 3 },
      costUsd: 0.05,
    });
  });

  it("extracts Codex JSONL without inventing a provider-reported model", () => {
    const parsed = parseHarnessOutput("codex",
    [
      JSON.stringify({ type: "thread.started", thread_id: "codex-session" }),
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: "CODEX_OK" },
      }),
      JSON.stringify({
        type: "turn.completed",
        usage: {
          input_tokens: 20,
          cached_input_tokens: 4,
          output_tokens: 5,
          reasoning_output_tokens: 2,
        },
      }),
    ].join("\n"),
    "model: gpt-5.6-sol\nreasoning effort: max\n",
    "gpt-5.6-sol");
    expect(parsed).toMatchObject({
      text: "CODEX_OK",
      reportedModel: null,
      sessionId: "codex-session",
      usage: {
        inputTokens: 20,
        cachedInputTokens: 4,
        outputTokens: 5,
        reasoningTokens: 2,
      },
    });
  });

  it("extracts OMP provider, model, usage, cost, and terminal text", () => {
    const stdout = [
      JSON.stringify({ type: "session", id: "omp-session" }),
      JSON.stringify({
        type: "message_end",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "OMP_OK" }],
          provider: "openrouter",
          model: "z-ai/glm-5.3-flash",
          usage: {
            input: 40,
            output: 5,
            cacheRead: 2,
            cacheWrite: 1,
            totalTokens: 48,
            cost: { total: 0.03 },
          },
          stopReason: "stop",
        },
      }),
      JSON.stringify({ type: "agent_end", messages: [], isTerminal: true }),
    ].join("\n");
    expect(
      parseHarnessOutput("omp", stdout, "", "z-ai/glm-5.3-flash")
    ).toEqual({
      text: "OMP_OK",
      reportedApiProvider: "openrouter",
      reportedModel: "z-ai/glm-5.3-flash",
      sessionId: "omp-session",
      usage: {
        inputTokens: 40,
        cachedInputTokens: 2,
        cacheCreationInputTokens: 1,
        outputTokens: 5,
        totalTokens: 48,
      },
      costUsd: 0.03,
    });
  });

  it("rejects OMP fallback and non-terminal output", () => {
    expect(() =>
      parseHarnessOutput(
        "omp",
        JSON.stringify({ type: "retry_fallback_applied" }),
        "",
        "z-ai/glm-5.3-flash"
      )
    ).toThrow("model fallback");
    expect(() =>
      parseHarnessOutput(
        "omp",
        JSON.stringify({
          type: "message_end",
          message: {
            role: "assistant",
            content: [{ type: "text", text: "partial" }],
            provider: "openrouter",
            model: "z-ai/glm-5.3-flash",
          },
        }),
        "",
        "z-ai/glm-5.3-flash"
      )
    ).toThrow("terminal event");
  });

  it("accepts Grok's reported build suffix", () => {
    const parsed = parseHarnessOutput("grok",
    [
      JSON.stringify({
        type: "assistant",
        message: { content: [{ type: "text", text: "progress" }] },
      }),
      JSON.stringify({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "GROK_OK",
        session_id: "grok-session",
        usage: {
          input_tokens: 30,
          cache_read_input_tokens: 6,
          output_tokens: 7,
          reasoning_tokens: 3,
          total_tokens: 43,
        },
        total_cost_usd: 0.02,
        modelUsage: { "grok-4.6-build": {} },
      }),
    ].join("\n"),
    "",
    "grok-4.6");
    expect(parsed.text).toBe("GROK_OK");
    expect(parsed.reportedModel).toBe("grok-4.6-build");
    expect(reportedModelMatches("grok-4.6", parsed.reportedModel)).toBe(
      true
    );
  });

  it("selects the requested Claude model when usage includes a side model", () => {
    const parsed = parseHarnessOutput("claude",
    JSON.stringify({
      result: "CLAUDE_OK",
      modelUsage: {
        "claude-haiku-4-5-20251001": {},
        "claude-fable-5": {},
      },
    }),
    "",
    "claude-fable-5");
    expect(parsed.reportedModel).toBe("claude-fable-5");
  });

  it("rejects malformed or textless responses", () => {
    expect(() =>
      parseHarnessOutput("claude", "not-json", "", "claude-fable-5")
    ).toThrow("valid JSON");
    expect(() =>
      parseHarnessOutput("codex",
      JSON.stringify({ type: "turn.completed" }),
      "",
      "gpt-5.6-sol")
    ).toThrow("final agent message");
  });
});
