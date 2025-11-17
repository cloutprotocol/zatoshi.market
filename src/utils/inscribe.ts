"use client";

import { sanitizeError } from "./errorMessages";

async function gatePost<T = any>(op: string, params: any): Promise<T> {
  const res = await fetch('/api/gate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op, params }),
    cache: 'no-store',
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Gate proxy error ${res.status}: ${text}`);
  }
  return res.json();
}

export type InscribeArgs = {
  address: string;
  pubKeyHex: string;
  content?: string;
  contentJson?: string;
  contentType?: string;
  type?: string;
  inscriptionAmount?: number;
  fee?: number;
};

export type Signer = (sighashHex: string) => Promise<string>; // returns raw 64-byte sig hex

/**
 * Sanitize Convex action errors before re-throwing
 * Removes all Convex-specific details, stack traces, request IDs
 */
function sanitizeConvexError(error: unknown): never {
  const cleaned = sanitizeError(error);
  throw new Error(cleaned);
}

export async function safeMintInscription(
  args: InscribeArgs,
  signer: Signer
) {
  try {
    // Step 1: server assembles and returns commit preimage via secure gate
    const { contextId, commitSigHashHex } = await gatePost('unsignedCommit', {
      address: args.address,
      pubKeyHex: args.pubKeyHex,
      content: args.content,
      contentJson: args.contentJson,
      contentType: args.contentType,
      type: args.type,
      inscriptionAmount: args.inscriptionAmount,
      fee: args.fee,
    });

    // Step 2: client signs commit locally
    const commitSignatureRawHex = await signer(commitSigHashHex);

    const { commitTxid, revealSigHashHex } = await gatePost('finalizeCommit', {
      contextId,
      commitSignatureRawHex,
    });

    // Step 3: client signs reveal and server broadcasts
    const revealSignatureRawHex = await signer(revealSigHashHex);

    const { revealTxid, inscriptionId } = await gatePost('broadcastReveal', {
      contextId,
      revealSignatureRawHex,
    });

    return { commitTxid, revealTxid, inscriptionId };
  } catch (error) {
    // Sanitize all Convex errors before re-throwing to user
    sanitizeConvexError(error);
  }
}
