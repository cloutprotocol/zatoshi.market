"use client";

import { useMemo, useState } from "react";
import { useWallet } from "@/contexts/WalletContext";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";
import {
  assembleFinalTx,
  buildP2PKHScript,
  pushData,
  signatureToDER,
  wifToPriv,
  addressToPkh,
  zip243Sighash,
  bytesToHex,
  decodeTransparentOutputs,
} from "@/lib/zcashFrontendHelpers";
import * as secp from "@noble/secp256k1";
import { useToast } from "@/contexts/ToastContext";

type Offer = Doc<"psbtOffers">;

export default function SalesInbox() {
  const { wallet } = useWallet();
  const sellerAddress = wallet?.address || "";
  const offers = useQuery(api.psbt.listOffersForSeller, sellerAddress ? { sellerAddress } : "skip");
  const getBranchId = useAction(api.zcash.getBranchId);
  const finalizeAndBroadcast = useAction(api.psbt.finalizeAndBroadcast);
  const markOfferCompleted = useMutation(api.psbt.markOfferCompleted);
  const getListing = useQuery(api.psbt.getListing, offers && offers.length ? { listingId: offers[0].listingId } : "skip");

  const [processing, setProcessing] = useState<Id<"psbtOffers"> | null>(null);
  const { success: toastSuccess, error: toastError } = useToast();
  const pending = offers?.filter((o) => o.status === "pending") || [];

  const onFinalize = async (offer: Offer) => {
    if (!wallet) return;
    setProcessing(offer._id);
    try {
      const payload = JSON.parse(offer.offerPayload) as {
        sellerInput: { txid: string; vout: number; sequence: number };
        buyerInputs: { txid: string; vout: number; value: number; scriptSigHex: string; sequence: number }[];
        outputs: { value: number; scriptHex: string }[];
        buyerAddress: string;
      };

      const consensusBranchId = await getBranchId({});

      // Fetch seller prevout details to build correct sighash preimage
      const sellerTx = await fetch(`/api/zcash/tx/${payload.sellerInput.txid}`);
      if (!sellerTx.ok) throw new Error('Failed to fetch seller token UTXO');
      const { raw } = await sellerTx.json();
      const outs = decodeTransparentOutputs(raw);
      const sellerOut = outs[payload.sellerInput.vout];
      if (!sellerOut) throw new Error('Seller token output missing');
      const sellerScript = buildP2PKHScript(addressToPkh(wallet.address));
      const scriptMatches = sellerOut.script.length === sellerScript.length && sellerOut.script.every((b, idx) => b === sellerScript[idx]);
      if (!scriptMatches) throw new Error('Seller input does not belong to your address');

      // Build seller scriptSig for input 0 (SIGHASH_SINGLE|ANYONECANPAY)
      const sellerPriv = wifToPriv(wallet.privateKey);
      const sellerPub = secp.getPublicKey(sellerPriv, true);
      const inputsForSig = [
        {
          txid: payload.sellerInput.txid,
          vout: payload.sellerInput.vout,
          value: sellerOut.value,
          sequence: payload.sellerInput.sequence,
          scriptPubKey: sellerScript,
        },
        ...payload.buyerInputs.map((bi) => ({
          txid: bi.txid,
          vout: bi.vout,
          value: bi.value,
          sequence: bi.sequence,
          scriptPubKey: new Uint8Array([]),
        })),
      ];
      const outputs = payload.outputs.map((o) => ({ value: o.value, scriptPubKey: Uint8Array.from(Buffer.from(o.scriptHex, "hex")) }));

      const txData = {
        version: 0x80000004,
        versionGroupId: 0x892f2085,
        consensusBranchId,
        lockTime: 0,
        expiryHeight: 0,
        inputs: inputsForSig,
        outputs,
      } as any;

      const sighash = zip243Sighash(txData, 0, 0x83);
      const sig: any = await secp.sign(sighash, sellerPriv);
      const sig64 = sig.toCompactRawBytes ? sig.toCompactRawBytes() : sig;
      const der = signatureToDER(sig64);
      const sigWithType = new Uint8Array([...der, 0x83]); // SINGLE | ANYONECANPAY
      const sellerScriptSig = bytesToHex(pushData(sigWithType)) + bytesToHex(pushData(sellerPub));

      // Compose final inputs array with scriptSigs
      const finalInputs = [
        {
          txid: payload.sellerInput.txid,
          vout: payload.sellerInput.vout,
          scriptSig: Uint8Array.from(Buffer.from(sellerScriptSig, "hex")),
          sequence: payload.sellerInput.sequence,
        },
        ...payload.buyerInputs.map((bi) => ({
          txid: bi.txid,
          vout: bi.vout,
          scriptSig: Uint8Array.from(Buffer.from(bi.scriptSigHex, "hex")),
          sequence: bi.sequence,
        })),
      ];

      const finalHex = assembleFinalTx({ inputs: finalInputs as any, outputs: outputs as any, consensusBranchId });
      const txid = await finalizeAndBroadcast({ listingId: offer.listingId, hex: finalHex, buyerAddress: payload.buyerAddress });
      await markOfferCompleted({ offerId: offer._id, txid });
      toastSuccess('Sale completed', `Tx: ${txid.slice(0, 10)}…`);
    } catch (e) {
      console.error("Finalize offer failed", e);
      const msg = (e as any)?.message || String(e);
      toastError('Sale finalize failed', msg);
    } finally {
      setProcessing(null);
    }
  };

  if (!wallet) return null;
  return (
    <div className="glass-card p-4 border border-gold-500/20 rounded">
      <h3 className="text-lg font-bold mb-3">Sales Inbox</h3>
      {pending.length === 0 ? (
        <div className="text-sm text-gold-300/70">No pending offers.</div>
      ) : (
        <div className="space-y-3">
          {pending.map((offer) => (
            <div key={offer._id} className="p-3 border border-gold-500/20 rounded bg-black/30 flex items-center justify-between">
              <div>
                <div className="text-sm text-gold-100">Offer from {offer.buyerAddress.slice(0,6)}...{offer.buyerAddress.slice(-4)}</div>
                <div className="text-xs text-gold-300/60">Created {new Date(offer.createdAt).toLocaleString()}</div>
              </div>
              <button
                onClick={() => onFinalize(offer)}
                disabled={processing === offer._id}
                className="px-3 py-1.5 rounded bg-gold-500 text-black text-sm font-bold disabled:opacity-50"
              >
                {processing === offer._id ? 'Processing…' : 'Review & Sign'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
