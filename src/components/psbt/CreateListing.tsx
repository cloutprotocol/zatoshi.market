"use client";

import { useState, useEffect } from "react";
import { useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useWallet } from "../../contexts/WalletContext";
import { Psbt } from "bitcoinjs-lib";
import { zcashRPC } from "../../services/zcash";
import {
    buildP2PKHScript,
    addressToPkh,
    wifToPriv,
    bytesToHex,
    hexToBytes,
    concatBytes,
    pushData,
    signatureToDER,
    zip243Sighash,
} from "../../lib/zcashFrontendHelpers";
import * as secp from "@noble/secp256k1";

interface CreateListingProps {
    onCancel?: () => void;
    onSuccess?: () => void;
}

export default function CreateListing({ onCancel, onSuccess }: CreateListingProps) {
    const { wallet } = useWallet();
    const createListing = useMutation(api.psbt.createListing);

    const [inscriptions, setInscriptions] = useState<any[]>([]);
    const [loadingInscriptions, setLoadingInscriptions] = useState(false);
    const [selectedInscription, setSelectedInscription] = useState<any | null>(null);

    const [price, setPrice] = useState("");
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState(false);

    useEffect(() => {
        if (wallet?.address) {
            fetchInscriptions();
        }
    }, [wallet?.address]);

    const fetchInscriptions = async () => {
        if (!wallet) return;
        setLoadingInscriptions(true);
        setError("");

        try {
            const data = await zcashRPC.getInscriptions(wallet.address, true);
            console.log(`[CreateListing] Found ${data.inscriptions.length} total inscriptions`);

            // Filter and parse for ZRC-20 transfers
            const validTransfers: any[] = [];

            for (let idx = 0; idx < data.inscriptions.length; idx++) {
                const ins = data.inscriptions[idx];
                console.log(`[CreateListing] Inscription ${idx + 1}/${data.inscriptions.length}:`, ins);

                // Check if content_type indicates text/json
                const validContentTypes = [
                    'text/plain',
                    'text/plain;charset=utf-8',
                    'application/json',
                    'text/json'
                ];

                const isValidContentType = validContentTypes.some(type =>
                    ins.content_type?.toLowerCase().includes(type.toLowerCase())
                );

                if (isValidContentType && ins.content) {
                    try {
                        // Try to parse the content as JSON
                        const trimmedContent = ins.content.trim();
                        console.log(`[CreateListing] Content:`, trimmedContent);

                        if (trimmedContent.startsWith('{') || trimmedContent.startsWith('[')) {
                            const json = JSON.parse(trimmedContent);
                            console.log(`[CreateListing] Parsed JSON:`, json);

                            // Check for ZRC-20 transfer
                            if (json.p === 'zrc-20' && json.op === 'transfer' && json.tick && json.amt) {
                                console.log(`[CreateListing] ✓ Valid ZRC-20 transfer found:`, json);
                                validTransfers.push({
                                    ...ins,
                                    zrc20: {
                                        tick: json.tick,
                                        amt: json.amt
                                    }
                                });
                            } else {
                                console.log(`[CreateListing] ✗ Not a valid ZRC-20 transfer. Fields:`, {
                                    p: json.p,
                                    op: json.op,
                                    tick: json.tick,
                                    amt: json.amt
                                });
                            }
                        } else {
                            console.log(`[CreateListing] Content doesn't look like JSON`);
                        }
                    } catch (e: any) {
                        console.log(`[CreateListing] Failed to parse inscription:`, e.message);
                    }
                } else {
                    console.log(`[CreateListing] Skipping - contentType "${ins.content_type}" not valid or no content`);
                }
            }

            console.log(`[CreateListing] Found ${validTransfers.length} valid ZRC-20 transfers`);
            setInscriptions(validTransfers);

            if (validTransfers.length === 0) {
                setError("No valid ZRC-20 transfer inscriptions found. Check console for details.");
            }
        } catch (e: any) {
            console.error("[CreateListing] Failed to fetch inscriptions:", e);
            setError(`Failed to load inscriptions: ${e.message}`);
        } finally {
            setLoadingInscriptions(false);
        }
    };

    const handleCreate = async () => {
        if (!wallet || !selectedInscription || !price) return;
        setLoading(true);
        setError("");

        try {
            const zrc20 = selectedInscription.zrc20;

            if (!zrc20) throw new Error("Selected item is not a valid ZRC-20 transfer");

            // Extract txid and vout from location (format: "txid:vout")
            const location = selectedInscription.location;
            if (!location || !location.includes(':')) {
                throw new Error("Invalid inscription location");
            }

            const [txid, voutStr] = location.split(':');
            const vout = parseInt(voutStr, 10);

            console.log(`[CreateListing] Creating listing for inscription at ${location}`);

            // 1. Construct PSBT
            const privKey = wifToPriv(wallet.privateKey);
            const pubKey = secp.getPublicKey(privKey, true);
            const pkh = addressToPkh(wallet.address);
            const scriptPubKey = buildP2PKHScript(pkh);

            const psbt = new Psbt({ network: undefined });
            psbt.setVersion(0x80000004);

            // Input: Token
            psbt.addInput({
                hash: txid,
                index: vout,
                sequence: 0xfffffffd,
            });

            // Output: Payment to Seller
            const priceZats = Math.round(parseFloat(price) * 1e8);
            psbt.addOutput({
                script: buildP2PKHScript(pkh),
                value: BigInt(priceZats),
            });

            // 3. Sign Input 0 (SIGHASH_SINGLE | ANYONECANPAY)
            // ... (Signing logic would go here, simplified for now as discussed)

            // 4. Save to Convex
            await createListing({
                psbtBase64: psbt.toBase64(),
                sellerAddress: wallet.address,
                price: parseFloat(price),
                tokenTicker: zrc20.tick,
                tokenAmount: parseFloat(zrc20.amt),
            });

            setSuccess(true);
            if (onSuccess) {
                setTimeout(onSuccess, 1500);
            }
        } catch (e: any) {
            console.error(e);
            setError(e.message || "Failed to create listing");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="w-full">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-gold-500">Create Listing</h2>
                {onCancel && (
                    <button onClick={onCancel} className="text-gold-300/60 hover:text-gold-100">
                        ✕
                    </button>
                )}
            </div>

            {!wallet ? (
                <div className="text-center py-8 text-gold-300/60">
                    Please connect your wallet to create a listing.
                </div>
            ) : (
                <div className="space-y-6">
                    {/* Inscription Selection */}
                    <div>
                        <label className="block text-sm font-bold text-gold-300/60 mb-2">
                            Select ZRC-20 Transfer to Sell
                        </label>
                        {loadingInscriptions ? (
                            <div className="text-gold-500 animate-pulse">Scanning for valid transfers...</div>
                        ) : inscriptions.length === 0 ? (
                            <div className="text-gold-300/60">No valid ZRC-20 transfer inscriptions found.</div>
                        ) : (
                            <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto p-2 border border-gold-500/20 rounded bg-black/40">
                                {inscriptions.map((ins: any, idx: number) => (
                                    <div
                                        key={ins.id || ins.inscription_id || idx}
                                        onClick={() => setSelectedInscription(ins)}
                                        className={`p-3 rounded cursor-pointer border transition-all ${
                                            selectedInscription?.id === ins.id || selectedInscription?.inscription_id === ins.inscription_id
                                            ? "border-gold-500 bg-gold-500/10"
                                            : "border-gold-500/10 hover:border-gold-500/30"
                                            }`}
                                    >
                                        <div className="text-xs text-gold-300/60 mb-1">
                                            #{ins.number || ins.inscription_number || idx + 1}
                                        </div>
                                        <div className="text-lg font-bold text-gold-100">
                                            {ins.zrc20?.amt} {ins.zrc20?.tick}
                                        </div>
                                        <div className="text-xs text-gold-300/40 truncate">
                                            {(ins.id || ins.inscription_id || ins.location || '').substring(0, 12)}...
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Price Input */}
                    <div>
                        <label className="block text-sm font-bold text-gold-300/60 mb-2">
                            Price (ZEC)
                        </label>
                        <input
                            type="number"
                            value={price}
                            onChange={(e) => setPrice(e.target.value)}
                            className="w-full bg-black/40 border border-gold-500/20 rounded p-3 text-gold-100 focus:outline-none focus:border-gold-500 transition-colors placeholder-gold-300/20"
                            placeholder="0.1"
                            step="0.0001"
                        />
                    </div>

                    {/* Token Details (Read-only) */}
                    {selectedInscription && (
                        <div className="p-3 bg-black/40 rounded border border-gold-500/20 text-sm text-gold-300/60">
                            <div className="flex justify-between">
                                <span>Token:</span>
                                <span className="text-gold-200">{(selectedInscription as any).zrc20?.tick}</span>
                            </div>
                            <div className="flex justify-between">
                                <span>Amount:</span>
                                <span className="text-gold-200">{(selectedInscription as any).zrc20?.amt}</span>
                            </div>
                        </div>
                    )}
                    {/* Error/Success Messages */}
                    {error && (
                        <div className="bg-red-900/20 border border-red-800/50 text-red-200 p-3 rounded text-sm">
                            {error}
                        </div>
                    )}
                    {success && (
                        <div className="bg-green-900/20 border border-green-800/50 text-green-200 p-3 rounded text-sm">
                            Listing created successfully!
                        </div>
                    )}

                    {/* Submit Button */}
                    <button
                        onClick={handleCreate}
                        disabled={loading || !selectedInscription || !price}
                        className="w-full py-3 bg-gold-500 hover:bg-gold-400 text-black font-bold rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(234,179,8,0.2)]"
                    >
                        {loading ? "Creating Listing..." : "List Item"}
                    </button>
                </div>
            )}
        </div>
    );
}
