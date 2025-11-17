// Server-only utility to call the Convex HTTP Gate securely

import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha256";

function toHex(u8: Uint8Array): string {
  return Array.from(u8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function callConvexGate<T = any>(op: string, params: Record<string, any>): Promise<T> {
  const url = (process.env.CONVEX_GATEWAY_URL || process.env.NEXT_PUBLIC_CONVEX_URL || "").replace(/\/$/, "") + "/gate";
  const secret = process.env.CONVEX_GATEWAY_SECRET || "";
  if (!url || !secret) throw new Error("Convex gateway not configured");
  const ts = Date.now().toString();
  const body = JSON.stringify({ op, params });
  const preimage = new TextEncoder().encode(`${ts}.${body}`);
  const sig = toHex(hmac(sha256, new TextEncoder().encode(secret), preimage));
  const r = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-zatoshi-gate-ts": ts,
      "x-zatoshi-gate-sign": sig,
    },
    body,
  });
  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Gate error ${r.status}: ${text}`);
  }
  return r.json();
}

