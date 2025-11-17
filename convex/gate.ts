import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha256";

function toHex(u8: Uint8Array): string {
  return Array.from(u8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let res = 0;
  for (let i = 0; i < a.length; i++) res |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return res === 0;
}

export const gate = httpAction(async (ctx, request) => {
  const secret = (process.env.CONVEX_GATEWAY_SECRET || "").trim();
  if (!secret) return new Response("Gateway not configured", { status: 503 });

  const ts = request.headers.get("x-zatoshi-gate-ts") || "";
  const sig = request.headers.get("x-zatoshi-gate-sign") || "";
  if (!ts || !sig) return new Response("Missing auth headers", { status: 401 });

  const now = Date.now();
  const tsNum = parseInt(ts, 10);
  if (!(Number.isFinite(tsNum) && Math.abs(now - tsNum) <= 5 * 60 * 1000)) {
    return new Response("Stale or invalid timestamp", { status: 401 });
  }

  const bodyText = await request.text();
  const preimage = new TextEncoder().encode(`${ts}.${bodyText}`);
  const mac = hmac(sha256, new TextEncoder().encode(secret), preimage);
  const expected = toHex(mac);
  if (!timingSafeEq(sig, expected)) return new Response("Unauthorized", { status: 403 });

  let payload: any;
  try { payload = JSON.parse(bodyText); } catch {
    return new Response("Invalid JSON", { status: 400 });
  }

  const op = payload?.op;
  const params = payload?.params ?? {};

  try {
    switch (op) {
      case "ping": {
        return Response.json({ ok: true, ts: Date.now() });
      }
      case "unsignedCommit": {
        const r = await ctx.runAction(internal.inscriptionsActions.i_buildUnsignedCommitAction, params);
        return Response.json(r);
      }
      case "finalizeCommit": {
        const r = await ctx.runAction(internal.inscriptionsActions.i_finalizeCommitAndGetRevealPreimageAction, params);
        return Response.json(r);
      }
      case "broadcastReveal": {
        const r = await ctx.runAction(internal.inscriptionsActions.i_broadcastSignedRevealAction, params);
        return Response.json(r);
      }
      case "splitBuild": {
        const r = await ctx.runAction(internal.inscriptionsActions.i_buildUnsignedSplitAction, params);
        return Response.json(r);
      }
      case "splitBroadcast": {
        const r = await ctx.runAction(internal.inscriptionsActions.i_broadcastSignedSplitAction, params);
        return Response.json(r);
      }
      case "batchMint": {
        const r = await ctx.runAction(internal.inscriptionsActions.i_batchMintAction, params);
        return Response.json(r);
      }
      default:
        return new Response("Unknown op", { status: 400 });
    }
  } catch (e: any) {
    return Response.json({ error: e?.message || String(e) }, { status: 500 });
  }
});
