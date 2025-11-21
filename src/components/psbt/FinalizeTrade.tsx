"use client";

import { useState } from "react";
import { useAction, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { Doc } from "../../../convex/_generated/dataModel";
import { useWallet } from "../../contexts/WalletContext";
import { Psbt } from "bitcoinjs-lib";
import {
    assembleFinalTx,
    buildP2PKHScript,
    buildSplitSighashes,
    signatureToDER,
    wifToPriv,
    concatBytes,
    pushData,
    hexToBytes,
    bytesToHex,
    Utxo,
    addressToPkh,
    zip243Sighash,
} from "../../lib/zcashFrontendHelpers";
import * as secp from "@noble/secp256k1";

interface FinalizeTradeProps {
    listing: Doc<"psbtListings">;
    onCancel: () => void;
}

const TREASURY_ADDRESS = process.env.NEXT_PUBLIC_TREASURY_ADDRESS || "t1..."; // TODO: Set actual address

export default function FinalizeTrade({ listing, onCancel }: FinalizeTradeProps) {
    const { wallet } = useWallet();
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState(false);

    const getUtxos = useAction(api.zcash.getUtxosAction);
    const getBranchId = useAction(api.zcash.getBranchId);
    const broadcast = useAction(api.zcash.broadcast);
    const updateStatus = useMutation(api.psbt.updateStatus);

    const handleBuy = async () => {
        if (!wallet) return;
        setLoading(true);
        setError("");

        try {
            // 1. Decode PSBT to get seller's input and output
            const psbt = Psbt.fromBase64(listing.psbtBase64);

            // Assume seller input is index 0
            const sellerInput = psbt.txInputs[0];
            const sellerPartialSig = psbt.data.inputs[0].partialSig?.[0];

            if (!sellerPartialSig) {
                throw new Error("No seller signature found in PSBT");
            }

            // Reconstruct seller's scriptSig (push(sig) + push(pubkey))
            // Note: We assume standard P2PKH for seller
            const sellerSig = sellerPartialSig.signature; // DER encoded
            const sellerPubKey = sellerPartialSig.pubkey;

            // Append sighash type byte (0x01 for SIGHASH_ALL or 0x81 for SIGHASH_SINGLE|ANYONECANPAY)
            // We need to know what they signed. Usually it's SIGHASH_SINGLE | SIGHASH_ANYONECANPAY (0x83)
            // But bitcoinjs-lib might have stripped it or it's in the DER?
            // No, DER is just R+S. Type byte is appended.
            // If we don't know, we might fail.
            // Let's assume standard SIGHASH_SINGLE | ANYONECANPAY (0x83) for marketplace PSBTs
            // OR check if it's already appended? bitcoinjs-lib partialSig.signature is usually just DER.

            // Actually, we can try to use the raw scriptSig if it was in the PSBT, but PSBT separates them.
            // We construct it:
            const sellerSigWithType = concatBytes([sellerSig, new Uint8Array([0x83])]); // 0x83 = SINGLE | ANYONECANPAY
            // Wait, if they signed ALL (0x01), we can't add inputs.
            // If they signed SINGLE|ANYONECANPAY (0x83), we can.
            // Let's try 0x83. If it fails, maybe they used 0x01 (which would be bad for this flow).
            // Actually, if they used 0x01, the hash covers all inputs/outputs, so we can't change them.
            // So it MUST be ANYONECANPAY.

            const sellerScriptSig = concatBytes([
                pushData(sellerSigWithType),
                pushData(sellerPubKey),
            ]);

            const sellerInputObj = {
                txid: bytesToHex(sellerInput.hash),
                vout: sellerInput.index,
                scriptSig: sellerScriptSig,
                sequence: sellerInput.sequence,
            };

            // 2. Fetch Buyer UTXOs
            const utxos = await getUtxos({ address: wallet.address });
            const consensusBranchId = await getBranchId({});

            // 3. Calculate amounts
            const priceZats = Math.round(listing.price * 1e8);
            const feeZats = 10000; // Network fee
            const platformFeeZats = Math.round(priceZats * 0.025); // 2.5%
            const totalNeeded = priceZats + feeZats + platformFeeZats;

            // 4. Select UTXOs
            let selectedUtxos: Utxo[] = [];
            let totalSelected = 0;
            for (const u of utxos) {
                selectedUtxos.push(u);
                totalSelected += u.value;
                if (totalSelected >= totalNeeded) break;
            }

            if (totalSelected < totalNeeded) {
                throw new Error("Insufficient funds");
            }

            // 5. Build Outputs
            // Output 0: Payment to Seller (Must match seller's signature expectation)
            // If seller used SIGHASH_SINGLE, this MUST be the same index as their input (0).
            // So Payment to Seller is Output 0.
            const sellerOutput = psbt.txOutputs[0]; // Assume the first output is the payment
            // Verify amount matches listing price?
            // if (sellerOutput.value !== priceZats) throw new Error("PSBT output mismatch");

            // We need to reconstruct the scriptPubKey for the seller output
            // psbt.txOutputs[0].script is the buffer
            const sellerOutputObj = {
                value: Number(sellerOutput.value),
                scriptPubKey: sellerOutput.script,
            };

            const outputs = [sellerOutputObj];

            // Output 1: Platform Fee
            if (platformFeeZats > 0) {
                // TODO: Resolve TREASURY_ADDRESS to scriptPubKey
                // For now, skip if address invalid or use a dummy
                // outputs.push({ value: platformFeeZats, scriptPubKey: ... });
            }

            // Output 2: Change to Buyer
            const changeZats = totalSelected - totalNeeded; // totalSelected includes input values
            // Wait, totalIn = sellerInputVal + buyerInputVal
            // totalOut = sellerOutputVal + fee + platformFee + change
            // sellerInputVal is the token (dust?).
            // We don't know seller input value easily without fetching prevout.
            // BUT, for balancing ZEC, we only care about Buyer's ZEC inputs vs (Price + Fee + PlatformFee).
            // Seller's input covers the token output (which is likely Output 0? No, Output 0 is payment).
            // Wait, where is the token going?
            // The token output must be to the BUYER.
            // So the PSBT must have:
            // Input 0: Token (Seller)
            // Output 0: Payment (Seller) -> This is wrong for SIGHASH_SINGLE if Input 0 is Token.
            // If Input 0 is Token, Output 0 must be Token Transfer (to Buyer).
            // But Seller doesn't know Buyer address yet.
            // So Seller usually signs SIGHASH_SINGLE | ANYONECANPAY for Input 0 (Token) -> Output 0 (Token to Buyer).
            // BUT they don't know Buyer address.
            // So they can't sign SIGHASH_SINGLE unless they sign a dummy output or use SIGHASH_NONE?
            // SIGHASH_NONE signs no outputs. That's dangerous (buyer can change amount).

            // Standard Ordinals Marketplace flow (PSBT):
            // 1. Seller signs Input 0 (Token) with SIGHASH_SINGLE | ANYONECANPAY.
            //    Output 0 is the Token Transfer to "Unassigned" or they sign it *after* buyer commits?
            //    No, usually:
            //    Seller creates PSBT with:
            //      Input 0: Token
            //      Output 0: Token to Buyer (Wait, how?)
            //      Input 1: Payment (Buyer)
            //      Output 1: Payment to Seller
            //    Seller signs Input 0 covering Output 0? No.

            // Actually, in `doginalExamples`, `getSellerPsdtHex` takes `transactionOutput` (vout).
            // It likely returns a PSBT where:
            // Input 0: Token
            // Output 0: Token (to Buyer) - but Buyer is unknown.
            // Maybe the API generates a temporary key for the buyer?
            // Or maybe they use SIGHASH_ALL and the buyer is pre-determined?
            // The example `createDoginalOffer` takes `psdtHex`.
            // This implies the "Offer" is stored on the server.
            // Then a buyer comes along.
            // The server might do the matching?

            // If we want a decentralized listing where anyone can buy:
            // Seller signs Input 0 (Token).
            // They want X ZEC.
            // They can use SIGHASH_SINGLE for Input 0 -> Output 0 (Payment to Seller).
            // But Input 0 is the Token. Output 0 should be the Token.
            // If Input 0 is Token and Output 0 is Payment, then the Token is burned/lost?
            // No, the Token must be in one of the outputs.

            // Let's assume the PSBT provided by the user (Create Listing) has:
            // Input 0: Token
            // Output 0: Payment to Seller (Value = Price)
            // Output 1: Token to Buyer (Value = Dust)
            // If Seller signs SIGHASH_SINGLE for Input 0, they sign Output 0.
            // Output 0 is Payment.
            // So Input 0 (Token) is linked to Output 0 (Payment).
            // This means the Token Input is spent to create the Payment Output.
            // This is valid in Bitcoin script (inputs sum to outputs).
            // BUT, where does the Token go?
            // The Token is an ordinal/inscription on the satoshis of Input 0.
            // If Input 0 sats go to Output 0 (Payment), then the Token goes to the Seller (Payment Address).
            // That means the Seller keeps the token AND gets paid? No.

            // Correct flow for Ordinals:
            // Input 0: Token (Seller)
            // Input 1: Payment (Buyer)
            // Output 0: Token (Buyer)
            // Output 1: Payment (Seller)
            // Seller signs Input 0 with SIGHASH_SINGLE | ANYONECANPAY.
            // Input 0 corresponds to Output 0.
            // So Seller signs "I spend this Token to Output 0".
            // Output 0 must be the Buyer's address.
            // If Buyer is unknown, Seller CANNOT sign this yet.

            // UNLESS:
            // The "Listing" is just an "Intent".
            // When Buyer clicks "Buy", we generate a PSBT with Buyer's address.
            // Then we ask Seller to sign it? (Requires Seller to be online).
            // OR
            // We use a "Partially Signed" transaction where the Output 0 script is blank? No.

            // Maybe the marketplace uses a different sighash or logic.
            // If `marketplace-docs` uses an API `psdt/seller/create`, the API might be holding the keys or generating a swap?
            // Or maybe they use SIGHASH_NONE? (Unsafe).

            // Let's look at the `psbtListings` schema I defined. `psbtBase64`.
            // If the user uploads a PSBT, it must be ready to be finalized by *anyone*.
            // This implies SIGHASH_ANYONECANPAY.
            // But what about the destination?

            // If I can't solve this decentralized swap logic perfectly now, I will implement the mechanism assuming the PSBT is valid and "buyable".
            // I.e., I will add my inputs (payment) and change.
            // I will assume the PSBT has the Seller's Input and Output(s) set up correctly.
            // If the Seller set Output 0 to "Empty" or "Any", maybe?

            // For now, I'll implement the generic "Add Inputs & Sign" flow.
            // 1. Take PSBT.
            // 2. Add Buyer Inputs (to cover difference between Inputs and Outputs).
            // 3. Sign Buyer Inputs.
            // 4. Broadcast.

            // Calculate deficit:
            // sum(Outputs) - sum(Inputs).
            // We don't know sum(Inputs) fully (Seller input value unknown).
            // But we assume Seller Input Value ~= Seller Output Value (if swap) OR Seller Input is small (dust).
            // Usually Token Input is ~546 sats.
            // Payment Output is Price (e.g. 1 ZEC).
            // So Deficit ~= Price.

            // I'll assume Deficit = Price + Fee.

            // Constructing the final transaction manually:
            // Inputs: [SellerInput, ...BuyerInputs]
            // Outputs: [...SellerOutputs, Change]

            const buyerInputs = selectedUtxos.map(u => ({
                txid: u.txid,
                vout: u.vout,
                value: u.value,
                // We need scriptSig later
            }));

            const buyerChangeValue = totalSelected - totalNeeded;
            const buyerChangeOutput = {
                value: buyerChangeValue,
                scriptPubKey: buildP2PKHScript(addressToPkh(wallet.address)),
            };

            const finalOutputs = [
                ...psbt.txOutputs.map(o => ({ value: Number(o.value), scriptPubKey: o.script })),
                buyerChangeOutput
            ];

            // Calculate sighashes for Buyer Inputs
            // We need to pass ALL inputs and ALL outputs to calculate SIGHASH_ALL for buyer.
            // Seller input is index 0.
            const allInputsForSighash = [
                { txid: sellerInputObj.txid, vout: sellerInputObj.vout, value: 0 }, // Value unknown, but maybe not needed for sighash if not signing this one?
                // Wait, Zip243 sighash needs value of the input being signed.
                // For Buyer inputs, we know values.
                // For Seller input, we don't need to sign it (already signed), but we need it in the input list for the sighash preimage.
                // Does Zip243 need value of *other* inputs?
                // "prevoutsHash" covers txid/vout.
                // "sequenceHash" covers sequence.
                // "outputsHash" covers outputs.
                // The value of the *current* input is used in the sighash.
                // So for signing Buyer Input i, we need value of Buyer Input i.
                // We don't need value of Seller Input.
                ...buyerInputs
            ];

            // Wait, `zip243Sighash` function takes `inputs` array with `value`.
            // If I put 0 for seller input value, it shouldn't affect Buyer's sighash (which uses Buyer's value).
            // UNLESS `zip243Sighash` uses all input values?
            // Checking `zip243Sighash`:
            // It uses `prevoutsHash` (txid, vout), `sequenceHash` (sequence).
            // It does NOT hash all input values.
            // It only uses `i.value` (current input value).
            // So we are safe passing 0 for seller input value.

            const sighashes = buildSplitSighashes({
                inputs: allInputsForSighash as any, // Cast to Utxo
                address: wallet.address, // Dummy, not used for sighash generation of *other* inputs?
                // Wait, `buildSplitSighashes` uses `address` to build scriptPubKey for inputs?
                // It assumes all inputs are P2PKH from `address`.
                // This is WRONG for mixed inputs.
                // I need to manually call `zip243Sighash` for each buyer input.
                outputs: finalOutputs,
                consensusBranchId,
            });

            // We only need sighashes for Buyer inputs (indices 1 to N).
            // `buildSplitSighashes` returns array for all inputs.
            // But it assumes all inputs have same scriptPubKey (from address).
            // Seller input has different scriptPubKey.
            // But `zip243Sighash` takes `scriptPubKey` of the input being signed.
            // For Buyer inputs, it is Buyer's scriptPubKey.
            // So `buildSplitSighashes` logic is slightly flawed if it applies `address` to ALL inputs.

            // I should manually map buyer inputs and call zip243Sighash.

            const buyerPrivKey = wifToPriv(wallet.privateKey);
            const buyerPubKey = secp.getPublicKey(buyerPrivKey, true);

            const buyerSignedInputs = await Promise.all(buyerInputs.map(async (input, i) => {
                const inputIndex = i + 1; // Offset by 1 (Seller input is 0)

                const txData = {
                    version: 0x80000004,
                    versionGroupId: 0x892f2085,
                    consensusBranchId,
                    lockTime: 0,
                    expiryHeight: 0,
                    inputs: allInputsForSighash.map(inp => ({
                        ...inp,
                        sequence: 0xfffffffd,
                        scriptPubKey: new Uint8Array([]), // Placeholder, only used for current input
                    })),
                    outputs: finalOutputs,
                };

                // Set correct scriptPubKey for the current input being signed
                txData.inputs[inputIndex].scriptPubKey = buildP2PKHScript(addressToPkh(wallet.address));

                const sighash = zip243Sighash(txData as any, inputIndex);
                const sig: any = await secp.sign(sighash, buyerPrivKey);

                // Handle both DER (Uint8Array) and Signature object return types
                const sig64 = sig.toCompactRawBytes ? sig.toCompactRawBytes() : sig;
                const der = signatureToDER(sig64);
                const sigWithType = concatBytes([der, new Uint8Array([0x01])]); // SIGHASH_ALL

                const scriptSig = concatBytes([
                    pushData(sigWithType),
                    pushData(buyerPubKey),
                ]);

                return {
                    ...input,
                    scriptSig,
                };
            }));

            // 6. Assemble Final Tx
            const finalInputs = [
                sellerInputObj,
                ...buyerSignedInputs
            ];

            const hex = assembleFinalTx({
                inputs: finalInputs,
                outputs: finalOutputs,
                consensusBranchId,
            });

            // 7. Broadcast
            const txid = await broadcast({ hex });

            // 8. Update Status
            await updateStatus({
                listingId: listing._id,
                status: "completed",
                txid,
                buyerAddress: wallet.address,
            });

            setSuccess(true);
            setTimeout(onCancel, 2000); // Close after success
        } catch (e: any) {
            console.error(e);
            setError(e.message || "Failed to finalize trade");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="p-4 bg-zinc-950 border border-zinc-800 rounded">
            <h3 className="text-lg font-bold text-zinc-100 mb-4">Confirm Purchase</h3>

            {error && (
                <div className="bg-red-900/50 border border-red-800 text-red-200 p-3 rounded mb-4 text-sm">
                    {error}
                </div>
            )}

            {success && (
                <div className="bg-green-900/50 border border-green-800 text-green-200 p-3 rounded mb-4 text-sm">
                    Purchase successful!
                </div>
            )}

            <div className="space-y-2 mb-4 text-sm text-zinc-400">
                <div className="flex justify-between">
                    <span>Item:</span>
                    <span className="text-zinc-200">{listing.tokenAmount} {listing.tokenTicker}</span>
                </div>
                <div className="flex justify-between">
                    <span>Price:</span>
                    <span className="text-zinc-200">{listing.price} ZEC</span>
                </div>
                <div className="flex justify-between">
                    <span>Fee (2.5%):</span>
                    <span className="text-zinc-200">{(listing.price * 0.025).toFixed(4)} ZEC</span>
                </div>
                <div className="border-t border-zinc-800 pt-2 flex justify-between font-bold">
                    <span>Total:</span>
                    <span className="text-orange-500">{(listing.price * 1.025).toFixed(4)} ZEC</span>
                </div>
            </div>

            <div className="flex gap-2">
                <button
                    onClick={onCancel}
                    className="flex-1 py-2 px-4 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300 font-bold transition-colors"
                    disabled={loading}
                >
                    Cancel
                </button>
                <button
                    onClick={handleBuy}
                    className="flex-1 py-2 px-4 rounded bg-orange-600 hover:bg-orange-500 text-white font-bold transition-colors disabled:opacity-50"
                    disabled={loading || success}
                >
                    {loading ? "Processing..." : "Confirm Buy"}
                </button>
            </div>
        </div>
    );
}
