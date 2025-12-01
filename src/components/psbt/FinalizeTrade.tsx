"use client";

import { useState } from "react";
import { useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Doc } from "../../../convex/_generated/dataModel";
import { useWallet } from "../../contexts/WalletContext";
import {
  assembleFinalTx,
  buildP2PKHScript,
  signatureToDER,
  wifToPriv,
  concatBytes,
  pushData,
  Utxo,
  addressToPkh,
  zip243Sighash,
} from "../../lib/zcashFrontendHelpers";
import * as secp from "@noble/secp256k1";
import { calcFees, MARKETPLACE_FEES, BUY_TX_FEE_FLOOR_ZATS } from "@/config/marketplace";
import { useToast } from "@/contexts/ToastContext";
import { getSafeUTXOs } from "@/utils/utxoProtection";
import { formatUSD } from "@/config/fees";

interface FinalizeTradeProps {
  listing: Doc<"psbtListings">;
  onCancel: () => void;
  zecPrice?: number | null;
}

export default function FinalizeTrade({ listing, onCancel, zecPrice }: FinalizeTradeProps) {
  const { wallet } = useWallet();
  const { success: toastSuccess, error: toastError } = useToast();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  const getUtxos = useAction(api.zcash.getUtxosAction);
  const getBranchId = useAction(api.zcash.getBranchId);
  const prepareBuyerTemplate = useAction(api.psbt.prepareBuyerTemplate);
  const finalizeAndBroadcast = useAction(api.psbt.finalizeAndBroadcast);

  const handleBuy = async () => {
    if (!wallet) return;
    setLoading(true);
    setError("");
    try {
      // Parse token location
      const [txid, voutStr] = String(listing.tokenLocation).split(":");
      const tokenVout = parseInt(voutStr, 10);

      // Fetch buyer UTXOs excluding seller token outpoint
      const utxosAll = await getUtxos({ address: wallet.address });
      const candidates: Utxo[] = utxosAll
        .filter((u: any) => !(u.txid === txid && u.vout === tokenVout));

      // CRITICAL: filter out any inscribed UTXOs to avoid destroying inscriptions
      const utxos: Utxo[] = await getSafeUTXOs(wallet.address, candidates, 'purchase');

      // Prefer larger inputs first to minimize action count/fees
      utxos.sort((a, b) => b.value - a.value);
      const consensusBranchId = await getBranchId({});

      // Canonical outputs from server
      const template = await prepareBuyerTemplate({ listingId: listing._id, buyerAddress: wallet.address });
      const tokenOut = { value: Number(template.tokenValueZats), scriptPubKey: Uint8Array.from(Buffer.from(template.outputs[0].scriptHex, 'hex')) };
      const sellerOut = { value: Number(template.outputs[1].valueZats), scriptPubKey: Uint8Array.from(Buffer.from(template.outputs[1].scriptHex, 'hex')) };
      const treasuryOut = { value: Number(template.outputs[2].valueZats), scriptPubKey: Uint8Array.from(Buffer.from(template.outputs[2].scriptHex, 'hex')) };
      const outputsBase = [tokenOut, sellerOut, treasuryOut];

      // Select buyer inputs + dynamic ZIP-317 fee based on logical actions
      const priceZats = Math.round(listing.price * 1e8);
      const { buyerFeeZats } = calcFees(priceZats);
      const DUST = 10000;

      let selected: Utxo[] = [];
      let sum = 0;
      let fee = BUY_TX_FEE_FLOOR_ZATS; // start at floor; dynamic loop scales up as needed
      const takeMore = (need: number) => {
        for (const u of utxos) {
          if (selected.find(s => s.txid === u.txid && s.vout === u.vout)) continue;
          selected.push(u); sum += u.value; if (sum >= need) break;
        }
      };
      takeMore(priceZats + buyerFeeZats + fee);
      if (sum < priceZats + buyerFeeZats + fee) throw new Error('Insufficient funds');

      // Iterate to converge fee based on actions = max(inputs, outputs)
      for (let iter = 0; iter < 8; iter++) {
        const changeProbe = sum - (priceZats + buyerFeeZats + fee);
        const outputsCount = outputsBase.length + (changeProbe >= DUST ? 1 : 0);
        const inputsCount = (selected.length + 1); // +1 for seller token input
        const actions = Math.max(inputsCount, outputsCount);
        const feeCandidate = Math.max(BUY_TX_FEE_FLOOR_ZATS, Math.ceil(actions * 5000 * 1.2)); // +20% buffer & floor
        if (feeCandidate <= fee) break;
        fee = feeCandidate;
        if (sum < priceZats + buyerFeeZats + fee) {
          takeMore(priceZats + buyerFeeZats + fee);
          if (sum < priceZats + buyerFeeZats + fee) throw new Error('Insufficient funds');
        }
      }

      const change = sum - (priceZats + buyerFeeZats + fee);
      const outputs = [...outputsBase];
      if (change >= DUST) outputs.push({ value: change, scriptPubKey: buildP2PKHScript(addressToPkh(wallet.address)) });

      // Inputs ordering: [buyer0, seller, buyer1...]
      const firstBuyer = selected[0];
      const rest = selected.slice(1);
      const inputsForSig = [
        { txid: firstBuyer.txid, vout: firstBuyer.vout, value: firstBuyer.value, sequence: 0xfffffffd, scriptPubKey: buildP2PKHScript(addressToPkh(wallet.address)) },
        { txid, vout: tokenVout, value: Number(template.tokenValueZats), sequence: (listing as any).sellerInputSequence || 0xfffffffd, scriptPubKey: buildP2PKHScript(addressToPkh(listing.sellerAddress)) },
        ...rest.map(u => ({ txid: u.txid, vout: u.vout, value: u.value, sequence: 0xfffffffd, scriptPubKey: buildP2PKHScript(addressToPkh(wallet.address)) })),
      ];

      // Sign buyer inputs (SIGHASH_ALL)
      const buyerPriv = wifToPriv(wallet.privateKey);
      const buyerPub = secp.getPublicKey(buyerPriv, true);
      const finalInputs: { txid: string; vout: number; scriptSig: Uint8Array; sequence: number }[] = [];
      for (let i = 0; i < inputsForSig.length; i++) {
        const input = inputsForSig[i];
        if (i === 1) {
          // seller scriptSig from listing
          const scriptSig = Uint8Array.from(Buffer.from((listing as any).sellerScriptSigHex, 'hex'));
          finalInputs.push({ txid: input.txid, vout: input.vout, scriptSig, sequence: input.sequence });
          continue;
        }
        const txData = {
          version: 0x80000004,
          versionGroupId: 0x892f2085,
          consensusBranchId,
          lockTime: 0,
          expiryHeight: 0,
          inputs: inputsForSig.map(row => ({ txid: row.txid, vout: row.vout, sequence: row.sequence, value: row.value, scriptPubKey: row.scriptPubKey })),
          outputs,
        } as any;
        const sighash = zip243Sighash(txData, i, 0x01);
        const sig: any = await secp.sign(sighash, buyerPriv);
        const sig64 = sig.toCompactRawBytes ? sig.toCompactRawBytes() : sig;
        const der = signatureToDER(sig64);
        const sigWithType = new Uint8Array([...der, 0x01]);
        const scriptSig = concatBytes([pushData(sigWithType), pushData(buyerPub)]);
        finalInputs.push({ txid: input.txid, vout: input.vout, scriptSig, sequence: input.sequence });
      }

      // Assemble and finalize
      const hex = assembleFinalTx({ inputs: finalInputs as any, outputs: outputs as any, consensusBranchId });
      const txidFinal = await finalizeAndBroadcast({ listingId: listing._id, hex, buyerAddress: wallet.address });
      toastSuccess('Purchase complete', `Tx: ${txidFinal.slice(0, 12)}…`);
      setSuccess(true);
      onCancel();
    } catch (e: any) {
      console.error(e);
      const msg = e?.message || 'Purchase failed';
      setError(msg);
      toastError('Purchase failed', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 bg-zinc-950 border border-zinc-800 rounded">
      <h3 className="text-lg font-bold text-zinc-100 mb-4">Confirm Purchase</h3>

      {error && (
        <div className="bg-red-900/50 border border-red-800 text-red-200 p-3 rounded mb-4 text-sm">{error}</div>
      )}
      {success && (
        <div className="bg-green-900/40 border border-green-800/60 text-green-200 p-3 rounded mb-4 text-sm">Purchase completed successfully.</div>
      )}

      <div className="space-y-2 mb-4 text-sm text-zinc-400">
        <div className="flex justify-between">
          <span>Item:</span>
          <span className="text-zinc-200">{listing.tokenAmount} {listing.tokenTicker}</span>
        </div>
        {(() => {
          const priceZats = Math.round(listing.price * 1e8);
          const { buyerTotalZats, sellerPayoutZats } = calcFees(priceZats);
          const buyerTotal = buyerTotalZats / 1e8;
          const netToSeller = sellerPayoutZats / 1e8;
          const pctSeller = (MARKETPLACE_FEES.SELLER_BPS / 100).toFixed(1);
          const priceUsd = zecPrice ? formatUSD(priceZats, zecPrice) : null;
          const buyerTotalUsd = zecPrice ? formatUSD(buyerTotalZats, zecPrice) : null;
          const sellerPayoutUsd = zecPrice ? formatUSD(sellerPayoutZats, zecPrice) : null;
          return (
            <>
              <div className="flex justify-between">
                <span>Price:</span>
                <span className="text-right text-zinc-200">
                  {listing.price.toFixed(8)} ZEC
                  {priceUsd && <span className="block text-xs text-gold-300/80">≈ {priceUsd} USD</span>}
                </span>
              </div>
              <div className="flex justify-between text-zinc-300">
                <span>No buyer fee</span>
                <span className="text-right text-zinc-200">
                  {buyerTotal.toFixed(8)} ZEC
                  {buyerTotalUsd && <span className="block text-xs text-gold-200/70">≈ {buyerTotalUsd} USD</span>}
                </span>
              </div>
              <div className="flex justify-between">
                <span>Net to Seller (after {pctSeller}%):</span>
                <span className="text-right text-zinc-200">
                  {netToSeller.toFixed(8)} ZEC
                  {sellerPayoutUsd && <span className="block text-xs text-gold-200/70">≈ {sellerPayoutUsd} USD</span>}
                </span>
              </div>
              <div className="border-t border-zinc-800 pt-2 flex justify-between font-bold">
                <span>Total (Buyer):</span>
                <span className="text-right text-orange-500">
                  {buyerTotal.toFixed(8)} ZEC
                  {buyerTotalUsd && <span className="block text-xs text-gold-200/80 font-normal">≈ {buyerTotalUsd} USD</span>}
                </span>
              </div>
            </>
          );
        })()}
      </div>

      <div className="flex gap-2">
        <button onClick={onCancel} className="flex-1 py-2 px-4 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold transition-colors" disabled={loading}>
          Cancel
        </button>
        <button onClick={handleBuy} className="flex-1 py-2 px-4 rounded bg-orange-600 hover:bg-orange-500 text-white font-bold transition-colors disabled:opacity-50" disabled={loading || success}>
          {loading ? 'Processing...' : 'Confirm Buy'}
        </button>
      </div>
    </div>
  );
}
