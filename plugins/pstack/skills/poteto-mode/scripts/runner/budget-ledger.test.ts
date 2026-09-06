import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  BudgetExceededError,
  MONTH_LIMIT_MICRO_USD,
  REQUEST_HOLD_MICRO_USD,
  TASK_LIMIT_MICRO_USD,
  openBudgetLedger,
} from "./budget-ledger.ts";

const scratchDirectories: string[] = [];

function ledgerPath(): string {
  const directory = mkdtempSync(join(tmpdir(), "pstack-budget-ledger-"));
  scratchDirectories.push(directory);
  return join(directory, "budget.sqlite");
}

afterEach(() => {
  for (const directory of scratchDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("budget ledger", () => {
  it("uses the conservative fixed per-attempt reservation", () => {
    expect(REQUEST_HOLD_MICRO_USD).toBe(165_479);
    expect(TASK_LIMIT_MICRO_USD).toBe(500_000);
    expect(MONTH_LIMIT_MICRO_USD).toBe(5_000_000);
  });

  it("atomically stops the fourth worst-case attempt for one task across connections", async () => {
    const path = ledgerPath();
    const ledgers = Array.from({ length: 4 }, () => openBudgetLedger(path));
    try {
      const attempts = await Promise.allSettled(
        ledgers.map(async (ledger, index) =>
          ledger.reserve({
            taskId: "task-shared",
            laneId: `lane-${index}`,
          })
        )
      );
      expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(3);
      const rejection = attempts.find((attempt) => attempt.status === "rejected");
      expect(rejection?.status).toBe("rejected");
      if (rejection?.status === "rejected") {
        expect(rejection.reason).toBeInstanceOf(BudgetExceededError);
        expect(String(rejection.reason)).toContain("task");
      }
    } finally {
      for (const ledger of ledgers) ledger.close();
    }
  });

  it("shares task and monthly limits across competing processes", async () => {
    const path = ledgerPath();
    const initialized = openBudgetLedger(path);
    initialized.close();
    const modulePath = join(import.meta.dir, "budget-ledger.ts");
    const script = `
      import { openBudgetLedger, BudgetExceededError } from ${JSON.stringify(modulePath)};
      const ledger = openBudgetLedger(process.argv[1]);
      let accepted = 0;
      for (let i = 0; i < 12; i++) {
        try {
          ledger.reserve({taskId: process.argv[2] === "shared" ? "shared" : process.pid + ":" + i, laneId: process.pid + ":" + i});
          accepted++;
        } catch (error) { if (!(error instanceof BudgetExceededError)) throw error; }
      }
      ledger.close();
      console.log(accepted);
    `;
    async function race(scope: string): Promise<number> {
      const children = Array.from({length: 4}, () => Bun.spawn([process.execPath, "-e", script, path, scope], {stdout: "pipe", stderr: "pipe"}));
      const results = await Promise.all(children.map(async (child) => {
        const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        expect(stderr).toBe("");
        expect(exitCode).toBe(0);
        return Number(stdout.trim());
      }));
      return results.reduce((sum, count) => sum + count, 0);
    }
    expect(await race("shared")).toBe(3);
    expect(await race("independent")).toBe(27);
    const ledger = openBudgetLedger(path);
    try {
      expect(ledger.status().monthUsedMicroUsd).toBe(30 * REQUEST_HOLD_MICRO_USD);
    } finally { ledger.close(); }
  });

  it("keeps an unreconciled attempt held after reopening the database", () => {
    const path = ledgerPath();
    const first = openBudgetLedger(path);
    first.reserve({ taskId: "task-crash", laneId: "lane-crash" });
    first.close();

    const reopened = openBudgetLedger(path);
    try {
      expect(reopened.evidence("lane-crash")).toMatchObject({
        requestCount: 1,
        chargedMicroUsd: 0,
        heldMicroUsd: REQUEST_HOLD_MICRO_USD,
      });
    } finally {
      reopened.close();
    }
  });

  it("reconciles trusted cost and records an over-bound actual without clamping", () => {
    const path = ledgerPath();
    const ledger = openBudgetLedger(path);
    try {
      const first = ledger.reserve({ taskId: "task-cost", laneId: "lane-cost" });
      ledger.reconcile({
        reservationId: first.reservationId,
        costUsd: 0.02,
        generationId: "gen-1",
        reportedModel: "z-ai/glm-5.3-flash",
      });
      const second = ledger.reserve({ taskId: "task-over", laneId: "lane-over" });
      ledger.reconcile({
        reservationId: second.reservationId,
        costUsd: 0.2,
        generationId: "gen-2",
        reportedModel: "z-ai/glm-5.3-flash-v1",
      });

      expect(ledger.evidence("lane-cost")).toEqual({
        requestCount: 1,
        chargedMicroUsd: 20_000,
        heldMicroUsd: 0,
        generationIds: ["gen-1"],
        reportedModels: ["z-ai/glm-5.3-flash"],
        failure: null,
      });
      expect(ledger.evidence("lane-over")).toMatchObject({
        chargedMicroUsd: 200_000,
        heldMicroUsd: 0,
        failure: expect.stringContaining("exceeded reserved"),
      });
    } finally {
      ledger.close();
    }
  });
});
