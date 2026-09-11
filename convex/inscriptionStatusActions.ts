"use node";

/**
 * Inscription confirmation tracker.
 *
 * Rows in `inscriptions` are inserted as "pending" by broadcastSignedRevealAction and were
 * previously never updated. This module closes the loop:
 *
 * - `refreshPendingInscriptions` (cron, see crons.ts) walks pending rows oldest-first and
 *   flips them to "confirmed" (with blockHeight) once the reveal tx has >= 1 confirmation,
 *   or to "failed" if no provider knows the tx after PENDING_TIMEOUT_MS.
 * - `checkInscriptionOnChain` is the on-demand variant behind GET /api/inscriptions/status/[id].
 *
 * Chain truth comes from getTxConfirmation (Zatoshi RPC -> Tatum -> Blockchair failover).
 */

import { action, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import { getTxConfirmation } from "./zcashHelpers";

// Zcash mempool expiry is 72h by default; our reveal txs use expiryHeight=0 (never expire),
// so anything unseen for a full day has been dropped by every relay we can reach.
const PENDING_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const CONFIRMATIONS_REQUIRED = 1;
const BATCH_LIMIT = 25;

export type InscriptionStatusResult = {
  inscriptionId: string;
  txid: string;
  status: "pending" | "confirmed" | "failed";
  confirmations: number;
  blockHeight?: number;
  blockHash?: string;
  createdAt: number;
  confirmedAt?: number;
  checkedAt: number;
  source: "chain" | "db";
};

function txidFromInscriptionId(id: string): string {
  // "<txid>i0" -> "<txid>"; a bare txid passes through
  const m = /^([0-9a-fA-F]{64})(?:i\d+)?$/.exec(id.trim());
  if (!m) throw new Error("Invalid inscription id or txid");
  return m[1].toLowerCase();
}

async function resolveStatus(
  ctx: { runQuery: any; runMutation: any },
  row: { inscriptionId: string; txid: string; status: string; createdAt: number; confirmedAt?: number; blockHeight?: number }
): Promise<InscriptionStatusResult> {
  const checkedAt = Date.now();
  let conf;
  try {
    conf = await getTxConfirmation(row.txid);
  } catch (e: any) {
    // Every provider errored: report what the DB knows, do not change state.
    console.warn(`[inscription-status] ${row.txid} lookup failed: ${e?.message || e}`);
    return {
      inscriptionId: row.inscriptionId,
      txid: row.txid,
      status: row.status as InscriptionStatusResult["status"],
      confirmations: row.status === "confirmed" ? CONFIRMATIONS_REQUIRED : 0,
      blockHeight: row.blockHeight,
      createdAt: row.createdAt,
      confirmedAt: row.confirmedAt,
      checkedAt,
      source: "db",
    };
  }

  let status: InscriptionStatusResult["status"] = row.status as any;
  if (conf.found && conf.confirmations >= CONFIRMATIONS_REQUIRED) {
    status = "confirmed";
  } else if (conf.found) {
    status = "pending";
  } else if (row.status === "confirmed") {
    // Was confirmed before but no provider sees it now (reorg or provider gap): keep DB state.
    status = "confirmed";
  } else if (checkedAt - row.createdAt > PENDING_TIMEOUT_MS) {
    status = "failed";
  } else {
    status = "pending";
  }

  if (status !== row.status || (conf.blockHeight && conf.blockHeight !== row.blockHeight)) {
    await ctx.runMutation(internal.inscriptions.setStatusByTxid, {
      txid: row.txid,
      status,
      blockHeight: conf.blockHeight,
    });
  }

  return {
    inscriptionId: row.inscriptionId,
    txid: row.txid,
    status,
    confirmations: conf.confirmations,
    blockHeight: conf.blockHeight ?? row.blockHeight,
    blockHash: conf.blockHash,
    createdAt: row.createdAt,
    confirmedAt: status === "confirmed" ? row.confirmedAt ?? checkedAt : undefined,
    checkedAt,
    source: "chain",
  };
}

type PendingRow = {
  inscriptionId: string;
  txid: string;
  status: string;
  createdAt: number;
  confirmedAt?: number;
  blockHeight?: number;
};

type RefreshSummary = { checked: number; confirmed: number; failed: number; pending: number; errored: number };

/** Cron entry point: advance pending rows. Safe to run concurrently (transitions are idempotent). */
// Explicit return types on these handlers avoid the Convex circular-type inference that
// otherwise collapses `internal`/`api` to `{}` for every module referencing them.
export const refreshPendingInscriptions = internalAction({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<RefreshSummary> => {
    const rows: PendingRow[] = await ctx.runQuery(internal.inscriptions.listPendingInscriptions, {
      limit: args.limit ?? BATCH_LIMIT,
    });
    let confirmed = 0, failed = 0, pending = 0, errored = 0;
    for (const row of rows) {
      try {
        const r = await resolveStatus(ctx, row);
        if (r.source === "db") errored++;
        else if (r.status === "confirmed") confirmed++;
        else if (r.status === "failed") failed++;
        else pending++;
      } catch (e) {
        errored++;
        console.error(`[inscription-status] ${row.txid}:`, e);
      }
    }
    if (rows.length > 0) {
      console.log(`[inscription-status] checked=${rows.length} confirmed=${confirmed} failed=${failed} pending=${pending} errored=${errored}`);
    }
    return { checked: rows.length, confirmed, failed, pending, errored };
  },
});

/** On-demand status for one inscription id or txid. Persists a confirmed/failed transition. */
export const checkInscriptionOnChain = action({
  args: { id: v.string() },
  handler: async (ctx, args): Promise<InscriptionStatusResult | null> => {
    const txid = txidFromInscriptionId(args.id);
    const row: PendingRow | null = await ctx.runQuery(internal.inscriptions.getByTxid, { txid });
    if (!row) return null;
    return await resolveStatus(ctx, row);
  },
});
