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

  // Step 1: server assembles and returns commit preimage
  const { contextId, commitSigHashHex } = await convex.action(
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
    } as any
  );

  // Step 2: client signs commit locally
  const commitSignatureRawHex = await signer(commitSigHashHex);
  const { commitTxid, revealSigHashHex } = await convex.action(
    api.inscriptionsActions.finalizeCommitAndGetRevealPreimageAction,
    {
      contextId,
      commitSignatureRawHex,
    }
  );

  // Step 3: client signs reveal and server broadcasts
  const revealSignatureRawHex = await signer(revealSigHashHex);
  const { revealTxid, inscriptionId } = await convex.action(
    api.inscriptionsActions.broadcastSignedRevealAction,
    {
      contextId,
      revealSignatureRawHex,
    }
  );

  return { commitTxid, revealTxid, inscriptionId };
}

