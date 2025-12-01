
import * as secp from "@noble/secp256k1";
import { blake2b } from "@noble/hashes/blake2b";
import bs58check from "bs58check";

// Mock data from user
const listing = {
    sellerAddress: "t1ZemSSmv1kcqapcCReZJGH4driYmbALX1x",
    sellerInputTxid: "fcecb4520d03dc62ca1e7a3acbdbc0697bceb2ecd8b6ed725e9d2d334655b2c2",
    sellerInputVout: 0,
    sellerInputValue: 10000,
    sellerInputSequence: 4294967293,
    sellerPayoutZats: 97500,
    sellerPayoutScriptHex: "76a914ad147aafdeaeba4dbb59874e7aec3c44110283be88ac",
    sellerScriptSigHex: "4830450221008f71aae92349e2852aa84f16256202a594ef6c7c99d7950b6b3b1f2354a831f002201839f0ecdbcb504d6bc3729e74cfb49d429a9ba19328bb814fde587fb7199ddc832103cbe99e3fd41a3f4ed04961c7dafc5074b790ccc076fc3b7aafff5a59bac96a8b"
};

function hexToBytes(hex: string) {
    return Uint8Array.from(Buffer.from(hex, 'hex'));
}

function bytesToHex(bytes: Uint8Array) {
    return Buffer.from(bytes).toString('hex');
}

// ZIP-243 Sighash (simplified for SIGHASH_SINGLE | ANYONECANPAY)
function zip243Sighash(
    input: { txid: string, vout: number, value: number, sequence: number, scriptPubKey: Uint8Array },
    output: { value: number, scriptPubKey: Uint8Array },
    hashType: number
) {
    // For SIGHASH_SINGLE | ANYONECANPAY (0x83):
    // 1. Header (Version, VersionGroupId, ConsensusBranchId, LockTime, ExpiryHeight)
    // 2. hashPrevouts (zeros)
    // 3. hashSequence (zeros)
    // 4. hashOutputs (hash of ONLY output at index)
    // 5. hashJoinSplits (zeros)
    // 6. hashShieldedSpends (zeros)
    // 7. hashShieldedOutputs (zeros)
    // 8. LockTime (again?) - No, it's part of header
    // 9. Sighash type

    // Actually, let's use a simplified approach since we don't have the full tx structure.
    // But we need the EXACT serialization.

    // We can try to verify if the signature matches the message hash constructed from these params.
    // However, without the exact header (version, branchId, etc) used during signing, we can't reproduce the hash.
    // The seller signed it in the browser. We need to know what Version/BranchId they used.
    // Assuming standard Zcash params:
    // Version: 4 (0x80000004)
    // VersionGroupId: 0x892f2085
    // ConsensusBranchId: 0x2bb40e60 (Nu5) or similar.

    // If we can't reproduce the hash, we can't verify.
    // But we can decode the scriptSig and check the pubkey.

    return null;
}

async function main() {
    console.log("Analyzing listing...");

    // 1. Decode ScriptSig
    const scriptSig = hexToBytes(listing.sellerScriptSigHex);
    let i = 0;
    const sigLen = scriptSig[i++];
    const sig = scriptSig.slice(i, i + sigLen - 1);
    const sighashType = scriptSig[i + sigLen - 1];
    i += sigLen;
    const pubkeyLen = scriptSig[i++];
    const pubkey = scriptSig.slice(i, i + pubkeyLen);

    console.log("Signature:", bytesToHex(sig));
    console.log("Sighash Type:", sighashType.toString(16)); // Should be 83
    console.log("Pubkey:", bytesToHex(pubkey));

    // 2. Verify Pubkey matches Seller Address
    // Address t1... is P2PKH.
    // P2PKH = RIPEMD160(SHA256(Pubkey))
    // We need to check if hash160(pubkey) matches the address hash.

    // Decode address
    const decoded = bs58check.decode(listing.sellerAddress);
    const addressHash = decoded.slice(2, 22); // Skip t1 prefix
    console.log("Address Hash:", bytesToHex(addressHash));

    // Hash pubkey
    // Node.js crypto for hash160
    const crypto = require('crypto');
    const sha = crypto.createHash('sha256').update(pubkey).digest();
    const ripemd = crypto.createHash('ripemd160').update(sha).digest();
    console.log("Pubkey Hash:", bytesToHex(ripemd));

    if (bytesToHex(ripemd) === bytesToHex(addressHash)) {
        console.log("✅ Pubkey matches seller address");
    } else {
        console.error("❌ Pubkey does NOT match seller address");
    }

    // 3. Check Payout Script
    // Payout script should be P2PKH of the address
    // 76 a9 14 <hash> 88 ac
    const expectedScript = `76a914${bytesToHex(addressHash)}88ac`;
    console.log("Expected Payout Script:", expectedScript);
    console.log("Stored Payout Script:  ", listing.sellerPayoutScriptHex);

    if (expectedScript === listing.sellerPayoutScriptHex) {
        console.log("✅ Payout script matches seller address");
    } else {
        console.error("❌ Payout script mismatch");
    }

    // 4. Check Payout Amount (Fee Calculation)
    const price = 100000; // 0.001 ZEC
    const payout = listing.sellerPayoutZats;
    const fee = price - payout;
    const bps = (fee / price) * 10000;
    console.log(`Price: ${price}, Payout: ${payout}, Fee: ${fee}`);
    console.log(`Implied Fee BPS: ${bps}`);

    if (bps === 250) {
        console.log("✅ Fee is exactly 2.5% (250 bps)");
    } else if (bps === 200) {
        console.log("✅ Fee is exactly 2.0% (200 bps)");
    } else {
        console.warn(`⚠️ Fee BPS is ${bps} (Non-standard?)`);
    }
}

main().catch(console.error);
