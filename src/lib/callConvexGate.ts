// Server-side helper to call the Convex HTTP Gate with HMAC timestamp signing
// Note: Import and use only from server code (e.g., Next.js API routes)

import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha256";

function toHex(u8: Uint8Array): string {
  return Array.from(u8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function callConvexGate<T = any>(op: string, params: Record<string, any>): Promise<T> {
  const base = (process.env.CONVEX_GATEWAY_URL || process.env.NEXT_PUBLIC_CONVEX_URL || "").replace(/\/$/, "");
  const url = `${base}/gate`;
  const secret = process.env.CONVEX_GATEWAY_SECRET || "";
  if (!base || !secret) throw new Error("Convex gateway not configured");

  const ts = Date.now().toString();
  const body = JSON.stringify({ op, params });
  const preimage = new TextEncoder().encode(`${ts}.${body}`);
  const sig = toHex(hmac(sha256, new TextEncoder().encode(secret), preimage));

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-zatoshi-gate-ts": ts,
      "x-zatoshi-gate-sign": sig,
    },
    body,
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gate error ${res.status}: ${text}`);
  }
  return res.json();
}

