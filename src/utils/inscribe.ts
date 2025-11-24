"use client";

import { getConvexClient } from "@/lib/convexClient";
import { api } from "../../convex/_generated/api";

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

export async function safeMintInscription(
  args: InscribeArgs,
  signer: Signer
) {
  const convex = getConvexClient();
  if (!convex) throw new Error("Convex client not available");

  const MAX_ATTEMPTS = 5;
  const excluded: { txid: string; vout: number }[] = [];
  let lastError: any = null;

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    // Step 1: server assembles and returns commit preimage
    const step1 = await convex.action(
      api.inscriptionsActions.buildUnsignedCommitAction,
      {
        address: args.address,
        pubKeyHex: args.pubKeyHex,
        content: args.content,
        contentJson: args.contentJson,
        contentType: args.contentType,
        type: args.type,
        inscriptionAmount: args.inscriptionAmount,
        fee: args.fee,
        excludeUtxos: excluded,
      } as any
    );
    const currentInputs: { txid: string; vout: number }[] = step1?.inputs ?? [];

    try {
      // Step 2: client signs commit locally
      const commitSignaturesRawHex = await Promise.all(
        step1.commitSigHashHexes.map((hex: string) => signer(hex))
      );
      const { commitTxid, revealSigHashHex } = await convex.action(
        api.inscriptionsActions.finalizeCommitAndGetRevealPreimageAction,
        {
          contextId: step1.contextId,
          commitSignaturesRawHex,
        }
      );

      // Step 3: client signs reveal and server broadcasts
      const revealSignatureRawHex = await signer(revealSigHashHex);
      const { revealTxid, inscriptionId } = await convex.action(
        api.inscriptionsActions.broadcastSignedRevealAction,
        {
          contextId: step1.contextId,
          revealSignatureRawHex,
        }
      );

      return { commitTxid, revealTxid, inscriptionId };
    } catch (err: any) {
      const msg = String(err?.message || err).toLowerCase();
      if (msg.includes('previous mint is still pending')) {
        // Record the inputs that caused the conflict so we can skip them next time
        for (const input of currentInputs) {
          if (!excluded.find((ex) => ex.txid === input.txid && ex.vout === input.vout)) {
            excluded.push(input);
          }
        }
        lastError = err;
        await new Promise((resolve) => setTimeout(resolve, 750));
        continue;
      }
      throw err;
    }
  }

  throw lastError || new Error('All candidate UTXOs are still pending. Wait for confirmations or split a fresh coin, then try again.');
}
