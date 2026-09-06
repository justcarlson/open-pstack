import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const RESERVED_INPUT_TOKENS = 1_048_576;
export const RESERVED_OUTPUT_TOKENS = 16_384;
export const MAX_PROMPT_PRICE_USD_PER_MILLION = 0.15;
export const MAX_COMPLETION_PRICE_USD_PER_MILLION = 0.5;
export const REQUEST_HOLD_MICRO_USD = Math.ceil(
  RESERVED_INPUT_TOKENS * MAX_PROMPT_PRICE_USD_PER_MILLION +
    RESERVED_OUTPUT_TOKENS * MAX_COMPLETION_PRICE_USD_PER_MILLION
);
export const TASK_LIMIT_MICRO_USD = 500_000;
export const MONTH_LIMIT_MICRO_USD = 5_000_000;

type BudgetScope = "task" | "month";

export class BudgetExceededError extends Error {
  readonly scope: BudgetScope;

  constructor(scope: BudgetScope) {
    super(`${scope} paid-model budget is exhausted`);
    this.name = "BudgetExceededError";
    this.scope = scope;
  }
}

export interface BudgetReservation {
  readonly reservationId: string;
}

export interface LedgerEvidence {
  readonly requestCount: number;
  readonly chargedMicroUsd: number;
  readonly heldMicroUsd: number;
  readonly generationIds: readonly string[];
  readonly reportedModels: readonly string[];
  readonly failure: string | null;
}

export interface BudgetStatus {
  readonly utcMonth: string;
  readonly monthUsedMicroUsd: number;
  readonly monthLimitMicroUsd: number;
  readonly taskUsedMicroUsd: number | null;
  readonly taskLimitMicroUsd: number;
}

export interface BudgetLedger {
  reserve(input: { readonly taskId: string; readonly laneId: string }): BudgetReservation;
  reconcile(input: {
    readonly reservationId: string;
    readonly costUsd: number;
    readonly generationId?: string;
    readonly reportedModel?: string;
  }): void;
  recordFailure(
    reservationId: string,
    message: string,
    evidence?: { readonly generationId?: string; readonly reportedModel?: string }
  ): void;
  evidence(laneId: string): LedgerEvidence;
  status(taskId?: string): BudgetStatus;
  close(): void;
}

export function defaultBudgetLedgerPath(
  env: Readonly<Record<string, string | undefined>> = process.env
): string {
  const stateRoot = env.XDG_STATE_HOME?.trim() || join(homedir(), ".local", "state");
  return join(stateRoot, "pstack-openai", "budget.sqlite3");
}

interface UsedRow {
  readonly used: number;
}

interface ReservationRow {
  readonly held_micro_usd: number;
  readonly charged_micro_usd: number | null;
}

interface EvidenceRow extends ReservationRow {
  readonly generation_id: string | null;
  readonly reported_model: string | null;
  readonly failure: string | null;
}

function utcMonth(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7);
}

function validateIdentifier(name: string, value: string): void {
  if (value.length === 0 || value.length > 512) {
    throw new TypeError(`${name} must contain between 1 and 512 characters`);
  }
}

function dollarsToMicroUsd(costUsd: number): number | null {
  if (!Number.isFinite(costUsd) || costUsd < 0) return null;
  const microUsd = Math.ceil(costUsd * 1_000_000);
  return Number.isSafeInteger(microUsd) ? microUsd : null;
}

export function openBudgetLedger(path: string = defaultBudgetLedgerPath()): BudgetLedger {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

  const database = new Database(path, { create: true, strict: true });
  database.exec("PRAGMA busy_timeout = 5000");
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA synchronous = FULL");
  database.exec(`
    CREATE TABLE IF NOT EXISTS paid_reservations (
      reservation_id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      lane_id TEXT NOT NULL,
      utc_month TEXT NOT NULL,
      held_micro_usd INTEGER NOT NULL,
      charged_micro_usd INTEGER,
      generation_id TEXT,
      reported_model TEXT,
      failure TEXT,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS paid_reservations_month
      ON paid_reservations (utc_month);
    CREATE INDEX IF NOT EXISTS paid_reservations_task
      ON paid_reservations (task_id);
    CREATE INDEX IF NOT EXISTS paid_reservations_lane
      ON paid_reservations (lane_id, created_at, reservation_id);
  `);

  const usedByMonth = database.query<UsedRow, [string]>(`
    SELECT COALESCE(SUM(COALESCE(charged_micro_usd, held_micro_usd)), 0) AS used
    FROM paid_reservations
    WHERE utc_month = ?
  `);
  const usedByTask = database.query<UsedRow, [string]>(`
    SELECT COALESCE(SUM(COALESCE(charged_micro_usd, held_micro_usd)), 0) AS used
    FROM paid_reservations
    WHERE task_id = ?
  `);
  const insertReservation = database.query<unknown, [string, string, string, string, number, string]>(`
    INSERT INTO paid_reservations (
      reservation_id,
      task_id,
      lane_id,
      utc_month,
      held_micro_usd,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `);
  const reservationById = database.query<ReservationRow, [string]>(`
    SELECT held_micro_usd, charged_micro_usd
    FROM paid_reservations
    WHERE reservation_id = ?
  `);
  const reconcileReservation = database.query<unknown, [number, string | null, string | null, string | null, string]>(`
    UPDATE paid_reservations
    SET charged_micro_usd = ?, generation_id = ?, reported_model = ?, failure = ?
    WHERE reservation_id = ? AND charged_micro_usd IS NULL
  `);
  const failReservation = database.query<unknown, [string, string | null, string | null, string]>(`
    UPDATE paid_reservations
    SET
      failure = COALESCE(failure, ?),
      generation_id = COALESCE(generation_id, ?),
      reported_model = COALESCE(reported_model, ?)
    WHERE reservation_id = ?
  `);
  const evidenceByLane = database.query<EvidenceRow, [string]>(`
    SELECT held_micro_usd, charged_micro_usd, generation_id, reported_model, failure
    FROM paid_reservations
    WHERE lane_id = ?
    ORDER BY created_at, reservation_id
  `);

  let closed = false;

  function assertOpen(): void {
    if (closed) throw new Error("budget ledger is closed");
  }

  function used(statement: ReturnType<typeof database.query<UsedRow, [string]>>, key: string): number {
    return statement.get(key)?.used ?? 0;
  }

  return {
    reserve({ taskId, laneId }): BudgetReservation {
      assertOpen();
      validateIdentifier("taskId", taskId);
      validateIdentifier("laneId", laneId);

      const month = utcMonth();
      const reservationId = randomUUID();
      database.exec("BEGIN IMMEDIATE");
      try {
        if (used(usedByMonth, month) + REQUEST_HOLD_MICRO_USD > MONTH_LIMIT_MICRO_USD) {
          throw new BudgetExceededError("month");
        }
        if (used(usedByTask, taskId) + REQUEST_HOLD_MICRO_USD > TASK_LIMIT_MICRO_USD) {
          throw new BudgetExceededError("task");
        }
        insertReservation.run(
          reservationId,
          taskId,
          laneId,
          month,
          REQUEST_HOLD_MICRO_USD,
          new Date().toISOString()
        );
        database.exec("COMMIT");
        return { reservationId };
      } catch (error) {
        if (database.inTransaction) database.exec("ROLLBACK");
        throw error;
      }
    },

    reconcile({ reservationId, costUsd, generationId, reportedModel }): void {
      assertOpen();
      const chargedMicroUsd = dollarsToMicroUsd(costUsd);
      if (chargedMicroUsd === null) {
        failReservation.run(
          "response did not contain a trusted usage.cost; reservation retained",
          generationId ?? null,
          reportedModel ?? null,
          reservationId
        );
        return;
      }

      const reservation = reservationById.get(reservationId);
      if (reservation === null) throw new Error("unknown budget reservation");
      if (reservation.charged_micro_usd !== null) return;

      const failure = chargedMicroUsd > reservation.held_micro_usd
        ? `actual charge ${chargedMicroUsd} microUSD exceeded reserved ${reservation.held_micro_usd} microUSD`
        : null;
      reconcileReservation.run(
        chargedMicroUsd,
        generationId ?? null,
        reportedModel ?? null,
        failure,
        reservationId
      );
    },

    recordFailure(
      reservationId: string,
      message: string,
      details: { readonly generationId?: string; readonly reportedModel?: string } = {}
    ): void {
      assertOpen();
      const normalized = message.trim() || "paid request failed; reservation retained";
      failReservation.run(
        normalized.slice(0, 2_000),
        details.generationId ?? null,
        details.reportedModel ?? null,
        reservationId
      );
    },

    evidence(laneId: string): LedgerEvidence {
      assertOpen();
      validateIdentifier("laneId", laneId);
      const rows = evidenceByLane.all(laneId);
      let chargedMicroUsd = 0;
      let heldMicroUsd = 0;
      const generationIds: string[] = [];
      const reportedModels: string[] = [];
      let failure: string | null = null;

      for (const row of rows) {
        if (row.charged_micro_usd === null) heldMicroUsd += row.held_micro_usd;
        else chargedMicroUsd += row.charged_micro_usd;
        if (row.generation_id !== null) generationIds.push(row.generation_id);
        if (row.reported_model !== null) reportedModels.push(row.reported_model);
        failure ??= row.failure;
      }

      return {
        requestCount: rows.length,
        chargedMicroUsd,
        heldMicroUsd,
        generationIds,
        reportedModels,
        failure,
      };
    },

    status(taskId?: string): BudgetStatus {
      assertOpen();
      if (taskId !== undefined) validateIdentifier("taskId", taskId);
      const month = utcMonth();
      return {
        utcMonth: month,
        monthUsedMicroUsd: used(usedByMonth, month),
        monthLimitMicroUsd: MONTH_LIMIT_MICRO_USD,
        taskUsedMicroUsd: taskId === undefined ? null : used(usedByTask, taskId),
        taskLimitMicroUsd: TASK_LIMIT_MICRO_USD,
      };
    },

    close(): void {
      if (closed) return;
      closed = true;
      database.close();
    },
  };
}
