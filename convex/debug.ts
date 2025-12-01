import { query, action } from "./_generated/server";
import { v } from "convex/values";
import { hexToBytes, bytesToHex, callZcashRPC } from "./zcashHelpers";
import { api } from "./_generated/api";

export const inspectListing = query({
    args: { listingId: v.string() },
    handler: async (ctx, args) => {
        const listing: any = await ctx.db.get(args.listingId as any);
        if (!listing) return { error: "Listing not found" };

        const scriptSig = listing.sellerScriptSigHex ? hexToBytes(listing.sellerScriptSigHex) : null;
        let decoded = null;

        if (scriptSig) {
            try {
                // P2PKH scriptSig: <sig> <pubkey>
                // <push_len> <sig_der> <sighash_type> <push_len> <pubkey>

                let i = 0;
                const sigLen = scriptSig[i++];
                const sig = scriptSig.slice(i, i + sigLen - 1); // Exclude sighash type
                const sighashType = scriptSig[i + sigLen - 1];
                i += sigLen;

                const pubkeyLen = scriptSig[i++];
                const pubkey = scriptSig.slice(i, i + pubkeyLen);

                decoded = {
                    signatureDer: bytesToHex(sig),
                    sighashType: sighashType, // Should be 0x83 (SIGHASH_SINGLE | ANYONECANPAY) or 0x03 (SIGHASH_SINGLE) + 0x80
                    sighashTypeHex: sighashType.toString(16),
                    pubkey: bytesToHex(pubkey),
                    pubkeyLen,
                    sigLen
                };
            } catch (e: any) {
                decoded = { error: "Failed to decode scriptSig", message: e.message };
            }
        }

        return {
            listingId: listing._id,
            status: listing.status,
            price: listing.price,
            tokenLocation: listing.tokenLocation,
            sellerAddress: listing.sellerAddress,
            sellerPayoutZats: listing.sellerPayoutZats,
            sellerPayoutScriptHex: listing.sellerPayoutScriptHex,
            sellerScriptSigHex: listing.sellerScriptSigHex,
            decodedScriptSig: decoded,
            // Expected output 1 (Payout)
            expectedOutput1: {
                value: listing.sellerPayoutZats,
                script: listing.sellerPayoutScriptHex
            }
        };
    },
});

/**
 * Decode and analyze a transaction hex to debug PSBT issues.
 *
 * Usage: npx convex run debug:analyzeTx --args '{"hex": "YOUR_TX_HEX", "listingId": "YOUR_LISTING_ID"}'
 */
export const analyzeTx = action({
    args: {
        hex: v.string(),
        listingId: v.string()
    },
    handler: async (ctx, args) => {
        const listing: any = await ctx.runQuery(api.psbt.getListing, { listingId: args.listingId as any });
        if (!listing) return { error: "Listing not found" };

        // Decode via RPC
        const decoded: any = await callZcashRPC('decoderawtransaction', [args.hex]);

        const inputs = decoded.vin?.map((v: any, i: number) => ({
            index: i,
            txid: v.txid,
            vout: v.vout,
            sequence: v.sequence,
            sequenceHex: '0x' + v.sequence?.toString(16),
            scriptSigHex: v.scriptSig?.hex,
            scriptSigAsm: v.scriptSig?.asm,
        }));

        const outputs = decoded.vout?.map((v: any, i: number) => ({
            index: i,
            value: v.value,
            valueZat: v.valueZat || Math.round(v.value * 1e8),
            scriptHex: v.scriptPubKey?.hex,
            addresses: v.scriptPubKey?.addresses,
        }));

        // Extract sighash type from seller input
        let sellerSighashType = null;
        if (inputs && inputs[1]?.scriptSigHex) {
            try {
                const scriptSig = hexToBytes(inputs[1].scriptSigHex);
                const sigLength = scriptSig[0];
                const sighashByte = scriptSig[sigLength];
                sellerSighashType = {
                    byte: sighashByte,
                    hex: '0x' + sighashByte.toString(16),
                    name: sighashByte === 0x01 ? 'ALL' :
                          sighashByte === 0x03 ? 'SINGLE' :
                          sighashByte === 0x81 ? 'ALL|ANYONECANPAY' :
                          sighashByte === 0x83 ? 'SINGLE|ANYONECANPAY' :
                          'UNKNOWN'
                };
            } catch (e) {
                sellerSighashType = { error: 'Failed to decode' };
            }
        }

        // Compare with listing expectations
        const priceZats = Math.round(listing.price * 1e8);
        const expectedPayoutZats = listing.sellerPayoutZats;
        const expectedFeeZats = priceZats - expectedPayoutZats;

        const [expectedTxid, expectedVoutStr] = String(listing.tokenLocation).split(':');
        const expectedVout = parseInt(expectedVoutStr, 10);

        return {
            txid: decoded.txid,

            comparison: {
                sellerInput: {
                    expected: {
                        txid: expectedTxid,
                        vout: expectedVout,
                        sequence: listing.sellerInputSequence,
                        scriptSigHex: listing.sellerScriptSigHex,
                    },
                    actual: inputs?.[1],
                    matches: {
                        txid: inputs?.[1]?.txid === expectedTxid,
                        vout: inputs?.[1]?.vout === expectedVout,
                        sequence: inputs?.[1]?.sequence === listing.sellerInputSequence,
                        scriptSig: inputs?.[1]?.scriptSigHex?.toLowerCase() === listing.sellerScriptSigHex?.toLowerCase(),
                    }
                },

                output1_sellerPayout: {
                    expected: {
                        valueZats: expectedPayoutZats,
                        scriptHex: listing.sellerPayoutScriptHex,
                    },
                    actual: outputs?.[1],
                    matches: {
                        value: outputs?.[1]?.valueZat === expectedPayoutZats,
                        script: outputs?.[1]?.scriptHex?.toLowerCase() === listing.sellerPayoutScriptHex?.toLowerCase(),
                    }
                },

                output2_treasury: {
                    expected: {
                        valueZats: expectedFeeZats,
                    },
                    actual: outputs?.[2],
                    matches: {
                        value: outputs?.[2]?.valueZat === expectedFeeZats,
                    }
                },

                sellerSighashType,
            },

            allInputs: inputs,
            allOutputs: outputs,

            verdict: (
                inputs?.[1]?.txid === expectedTxid &&
                inputs?.[1]?.vout === expectedVout &&
                inputs?.[1]?.sequence === listing.sellerInputSequence &&
                inputs?.[1]?.scriptSigHex?.toLowerCase() === listing.sellerScriptSigHex?.toLowerCase() &&
                outputs?.[1]?.valueZat === expectedPayoutZats &&
                outputs?.[1]?.scriptHex?.toLowerCase() === listing.sellerPayoutScriptHex?.toLowerCase() &&
                outputs?.[2]?.valueZat === expectedFeeZats
            ) ? '✅ Transaction appears correct' : '❌ Transaction has mismatches'
        };
    }
});
