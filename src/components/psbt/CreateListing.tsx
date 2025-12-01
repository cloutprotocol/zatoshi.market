"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useWallet } from "../../contexts/WalletContext";
// import { Psbt } from "bitcoinjs-lib";
import { zcashRPC } from "../../services/zcash";
import { ordinalIndexAPI } from "@/services/ordinalIndex";
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
// import { calcFees } from "@/config/marketplace";

interface CreateListingProps {
    onCancel?: () => void;
    onSuccess?: () => void;
    ticker?: string; // optional filter: only show transfers for this ticker
}

export default function CreateListing({ onCancel, onSuccess, ticker }: CreateListingProps) {
    const { wallet } = useWallet();
    const createListing = useMutation(api.psbt.createListing);
    const getBranchId = useAction(api.zcash.getBranchId);
    const mintInscription = useAction(api.inscriptionsActions.mintInscriptionAction);
    const createMintJobAndRun = useAction(api.jobsActions.createMintJobAndRun);

    const [inscriptions, setInscriptions] = useState<any[]>([]);
    const [loadingInscriptions, setLoadingInscriptions] = useState(false);
    const [selectedInscription, setSelectedInscription] = useState<any | null>(null);

    const [price, setPrice] = useState("");
    const [availableBalance, setAvailableBalance] = useState<string | null>(null);
    const [transferAmt, setTransferAmt] = useState<string>("");
    const [creatingTransfer, setCreatingTransfer] = useState(false);
    const [tokenDecimals, setTokenDecimals] = useState<number>(18);
    const [mintJobId, setMintJobId] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [success, setSuccess] = useState(false);
    const [verifying, setVerifying] = useState(false);
    const [verified, setVerified] = useState(false);
    const [verifyPending, setVerifyPending] = useState(false);
    const [verifyAttempts, setVerifyAttempts] = useState(0);
    const [verifyNote, setVerifyNote] = useState<string>("");

    const fetchInscriptions = useCallback(async () => {
        if (!wallet) return;
        setLoadingInscriptions(true);
        setError("");

        try {
            // Prefer indexer when ticker provided
            if (ticker) {
                const portfolio = await ordinalIndexAPI.getAddressPortfolio(wallet.address);
                // Fetch token summary to learn decimals (fallback 18)
                try {
                    const summary = await ordinalIndexAPI.getTokenSummary(ticker);
                    const decRaw: any = (summary as any)?.dec;
                    const decNum = typeof decRaw === 'number' ? decRaw : (typeof decRaw === 'string' ? Number(decRaw) : 18);
                    if (Number.isFinite(decNum) && decNum >= 0 && decNum <= 30) setTokenDecimals(decNum);
                } catch {}
                // Expect portfolio has a list of transfers with IDs or a holdings map
                const transfers: any[] = Array.isArray(portfolio?.transfers) ? portfolio.transfers : [];
                // Try to compute available balance for this ticker from portfolio (best-effort)
                try {
                    const T = ticker.toUpperCase();
                    let bal: string | null = null;
                    // Shape A: balances as array of { tick, available, overall }
                    if (Array.isArray((portfolio as any)?.balances)) {
                        const entry = (portfolio as any).balances.find((b: any) => String(b?.tick || b?.ticker || '').toUpperCase() === T);
                        if (entry) bal = String(entry.available || entry.overall || '0');
                    }
                    // Shape B: nested maps
                    if (!bal) {
                        const p: any = portfolio;
                        const direct = (p?.balances && (p.balances[T]?.available || p.balances[T]?.balance || p.balances[T]))
                          || (p?.tokens && (p.tokens[T]?.available || p.tokens[T]?.balance))
                          || (p?.available && p.available[T])
                          || (Array.isArray(p?.holdings) && (p.holdings.find((h: any) => (String(h.tick || h.ticker || '').toUpperCase() === T && (!h.address || String(h.address).toLowerCase() === wallet.address.toLowerCase())))?.available));
                        if (direct) bal = String(direct);
                    }
                    setAvailableBalance(bal ?? "0");
                } catch { setAvailableBalance("0"); }
                const matching = transfers.filter(t => String(t.tick || t.ticker).toUpperCase() === ticker.toUpperCase());
                const hydrated: any[] = [];
                for (const t of matching) {
                    try {
                        const tf = await ordinalIndexAPI.getTransfer(t.id || t.transfer_id || t.transferId);
                        if (tf?.used) continue;
                        const outpoint = tf?.outpoint || tf?.location || tf?.output;
                        if (!outpoint || !outpoint.includes(':')) continue;
                        hydrated.push({
                            id: t.id || tf?.id,
                            location: outpoint,
                            zrc20: { tick: (t.tick || t.ticker || ticker).toUpperCase(), amt: t.amt || t.amount || tf?.amt },
                        });
                    } catch {}
                }
                if (hydrated.length > 0) {
                  setInscriptions(hydrated);
                } else {
                  // Fallback to wallet scan if indexer returns nothing
                  console.log('[CreateListing] Indexer returned 0 transfers, falling back to wallet scan');
                  const data = await zcashRPC.getInscriptions(wallet.address, true);
                  const validTransfers: any[] = [];
                  for (let idx = 0; idx < data.inscriptions.length; idx++) {
                    const ins = data.inscriptions[idx];
                    // Derive id + location
                    const id = ins.id || ins.inscription_id || '';
                    let location = ins.location || ins.output || ins.outpoint || '';
                    if (!location && id && typeof id === 'string' && id.endsWith('i0')) {
                      location = `${id.slice(0, -2)}:0`;
                    }
                    // Fetch content if missing
                    let contentText: string | null = null;
                    if (typeof ins.content === 'string' && ins.content.length > 0) {
                      contentText = ins.content;
                    } else if (id) {
                      try {
                        const res = await fetch(`/api/zcash/inscription-content/${id}`);
                        if (res.ok) contentText = await res.text();
                      } catch {}
                    }
                    if (!contentText) continue;
                    try {
                      const json = JSON.parse(contentText.trim());
                      const isZrc20Transfer = json.p === 'zrc-20' && json.op === 'transfer' && json.tick && json.amt;
                      const matchesTicker = String(json.tick || '').toUpperCase() === ticker.toUpperCase();
                      if (isZrc20Transfer && matchesTicker && location && location.includes(':')) {
                        validTransfers.push({ id, location, zrc20: { tick: json.tick, amt: json.amt } });
                      }
                    } catch {}
                  }
                  setInscriptions(validTransfers);
                  if (validTransfers.length === 0) setError(`No transferable ${ticker} inscriptions found for this address.`);
                }
            } else {
                // Fallback: scan wallet inscriptions client-side
                const data = await zcashRPC.getInscriptions(wallet.address, true);
                console.log(`[CreateListing] Found ${data.inscriptions.length} total inscriptions`);
                const validTransfers: any[] = [];
                for (let idx = 0; idx < data.inscriptions.length; idx++) {
                    const ins = data.inscriptions[idx];
                    // Be tolerant: fetch content if missing
                    let txt: string | null = null;
                    if (typeof ins.content === 'string' && ins.content.length > 0) {
                      txt = ins.content;
                    } else if (ins.id || ins.inscription_id) {
                      try {
                        const res = await fetch(`/api/zcash/inscription-content/${ins.id || ins.inscription_id}`);
                        if (res.ok) txt = await res.text();
                      } catch {}
                    }
                    if (!txt) continue;
                    try {
                        const json = JSON.parse(txt.trim());
                        const isZrc20Transfer = json.p === 'zrc-20' && json.op === 'transfer' && json.tick && json.amt;
                        if (!isZrc20Transfer) continue;
                        // Derive location if missing
                        const id = ins.id || ins.inscription_id || '';
                        let location = ins.location || ins.output || ins.outpoint || '';
                        if (!location && id && typeof id === 'string' && id.endsWith('i0')) {
                          location = `${id.slice(0, -2)}:0`;
                        }
                        if (!location || !location.includes(':')) continue;
                        validTransfers.push({ id, location, zrc20: { tick: json.tick, amt: json.amt } });
                    } catch {}
                }
                setInscriptions(validTransfers);
                if (validTransfers.length === 0) setError('No valid ZRC-20 transfer inscriptions found.');
            }
        } catch (e: any) {
            console.error("[CreateListing] Failed to fetch inscriptions:", e);
            setError(`Failed to load inscriptions: ${e.message}`);
        } finally {
            setLoadingInscriptions(false);
        }
    }, [wallet, ticker]);

    useEffect(() => {
        if (wallet?.address) {
            fetchInscriptions();
        }
    }, [wallet?.address, fetchInscriptions]);

    // Verify selected transfer via indexer and ownership before enabling listing
    useEffect(() => {
        let timer: any;
        const verify = async () => {
            setVerified(false);
            setVerifyPending(false);
            setVerifyNote("");
            if (!wallet || !selectedInscription) return;
            setVerifying(true);
            try {
                const loc: string = String((selectedInscription as any).location || '');
                if (!loc.includes(':')) throw new Error('Invalid UTXO location');
                const [txid, voutStr] = loc.split(':');
                const vout = parseInt(voutStr, 10);
                const id: string = ((selectedInscription as any).id && typeof (selectedInscription as any).id === 'string')
                  ? (selectedInscription as any).id
                  : `${txid}i0`;

                const tf = await ordinalIndexAPI.getTransfer(id);
                const used = Boolean(tf?.used || tf?.revealed || tf?.consumed);
                if (used) throw new Error('Transfer already used');

                // Flexible field extraction for tick/amount/outpoint
                const tick = String(tf?.tick || tf?.ticker || tf?.symbol || '').toUpperCase();
                let amtRaw: any = (tf as any)?.amt;
                const amtKeys = ['amount_base_units','amount','value_base_units','value','base_units'];
                for (const k of amtKeys) {
                    if (amtRaw == null && (tf as any)?.[k] != null) amtRaw = (tf as any)[k];
                }
                // Fallback: read from inscription content
                if (amtRaw == null || !tick) {
                    try {
                        const resp = await fetch(`/api/zcash/inscription-content/${id}`);
                        if (resp.ok) {
                            const txt = await resp.text();
                            const j = JSON.parse(txt);
                            if (!tick && j?.tick) {
                                (tick as any) = String(j.tick).toUpperCase();
                            }
                            if (amtRaw == null && (j?.amt || j?.amount)) amtRaw = j.amt || j.amount;
                        }
                    } catch {}
                }
                const wantTick = String((selectedInscription as any).zrc20?.tick || '').toUpperCase();
                const wantAmtBase = (() => { try { return humanToBaseUnits(String((selectedInscription as any).zrc20?.amt || '0'), tokenDecimals); } catch { return null; }})();
                if (!tick || amtRaw == null) {
                    setVerifyPending(true);
                    setVerifyNote('Pending indexer');
                    return;
                }
                if (tick !== wantTick) throw new Error('Ticker mismatch');
                let tfAmtBase: bigint | null = null;
                try {
                    const s = String(amtRaw);
                    tfAmtBase = s.includes('.') ? humanToBaseUnits(s, tokenDecimals) : BigInt(s);
                } catch { tfAmtBase = null; }
                if (wantAmtBase == null || tfAmtBase == null) {
                    setVerifyPending(true);
                    setVerifyNote('Pending indexer');
                    return;
                }
                if (tfAmtBase !== wantAmtBase) throw new Error('Amount mismatch');
                const sender = (tf?.sender || tf?.from || tf?.address || tf?.owner || '').toString();
                if (sender && sender.toLowerCase() !== wallet.address.toLowerCase()) throw new Error('Sender does not match your address');
                const outpoint = (tf?.outpoint || tf?.location || tf?.output || '').toString();
                if (outpoint && outpoint !== loc) throw new Error('Transfer outpoint mismatch');

                // Ownership proof: token outpoint must pay to seller address
                const r = await fetch(`/api/zcash/tx/${txid}`);
                if (!r.ok) {
                    setVerifyPending(true);
                    setVerifyNote('Pending indexer');
                    return;
                }
                const { raw } = await r.json();
                const outs = decodeOutputs(raw);
                const out = outs[vout];
                const sellerScript = buildP2PKHScript(addressToPkh(wallet.address));
                const same = out && out.script && out.script.length === sellerScript.length && out.script.every((b, i) => b === sellerScript[i]);
                if (!same) throw new Error('You do not control the token UTXO');

                setVerified(true);
                setVerifyNote('Verified by indexer');
            } catch (e: any) {
                setVerified(false);
                setVerifyPending(true);
                setVerifyNote('Pending indexer');
            } finally {
                setVerifying(false);
                if (!verified && verifyPending && verifyAttempts < 12) {
                    timer = setTimeout(() => setVerifyAttempts((n) => n + 1), 1500);
                }
            }
        };
        verify();
        return () => { if (timer) clearTimeout(timer); };
    }, [selectedInscription, wallet?.address, tokenDecimals, verifyAttempts]);

    const handleCreateTransfer = async () => {
        if (!wallet || !ticker) return;
        // Normalize human input and validate
        const humanAmt = normalizeHumanInput(transferAmt || '');
        if (!humanAmt || !/^\d+(?:\.\d+)?$/.test(humanAmt)) {
            setError(`Enter a valid amount (up to ${tokenDecimals} decimals)`);
            return;
        }
        // Convert to base units for balance checks and indexer comparisons
        let amtBase: bigint;
        try { amtBase = humanToBaseUnits(humanAmt, tokenDecimals); }
        catch { setError(`Invalid amount. Use up to ${tokenDecimals} decimals.`); return; }
        if (availableBalance && /^[0-9]+$/.test(availableBalance)) {
            try {
                const a = amtBase;
                const b = BigInt(availableBalance);
                if (a <= 0n || a > b) {
                    setError('Amount exceeds available balance');
                    return;
                }
            } catch {}
        }
        setCreatingTransfer(true);
        setError("");
        try {
            // IMPORTANT: Inscribe human units for amt, matching indexer example
            const content = JSON.stringify({ p: 'zrc-20', op: 'transfer', tick: ticker.toUpperCase(), amt: humanAmt });
            // Use jobs pipeline so tooling updates uniformly
            const jobRes: any = await createMintJobAndRun({
                wif: wallet.privateKey,
                address: wallet.address,
                contentJson: content,
                contentType: 'application/json',
                inscriptionAmount: 60000,
                fee: 50000,
                waitMs: 5000,
            } as any);
            const jobId: string | undefined = jobRes?.jobId;
            setMintJobId(jobId || null);
            // Fallback: if action returned inscription directly (unlikely), adopt it
            const revealTxid: string | undefined = (jobRes?.revealTxid || jobRes?.txid);
            const inscriptionId: string | undefined = jobRes?.inscriptionId || (revealTxid ? `${revealTxid}i0` : undefined);
            if (!revealTxid || !inscriptionId) throw new Error('Failed to create transfer inscription');

            // Poll indexer briefly until transfer shows up as unused and matches
            let ok = false;
            for (let i = 0; i < 10; i++) {
                try {
                    const tf = await ordinalIndexAPI.getTransfer(inscriptionId);
                    const used = Boolean(tf?.used || tf?.revealed || tf?.consumed);
                    const outpoint = String(tf?.outpoint || tf?.location || `${revealTxid}:0`);
                    const tickU = String(tf?.tick || tf?.ticker || ticker).toUpperCase();
                    const tfAmtStr = String(tf?.amt ?? tf?.amount ?? '');
                    const tfBase = tfAmtStr ? (tfAmtStr.includes('.') ? humanToBaseUnits(tfAmtStr, tokenDecimals) : BigInt(tfAmtStr)) : 0n;
                    const wantBase = amtBase;
                    const amtOk = tfBase === wantBase;
                    if (!used && tickU === ticker.toUpperCase() && amtOk) {
                        const item = { id: inscriptionId, location: outpoint, zrc20: { tick: tickU, amt: humanAmt } };
                        setInscriptions(prev => [item, ...prev]);
                        setSelectedInscription(item);
                        ok = true;
                        break;
                    }
                } catch {}
                await new Promise(r => setTimeout(r, 1500));
            }
            if (!ok) {
                const item = { id: inscriptionId, location: `${revealTxid}:0`, zrc20: { tick: ticker.toUpperCase(), amt: humanAmt } };
                setInscriptions(prev => [item, ...prev]);
                setSelectedInscription(item);
            }
        } catch (e: any) {
            setError(e?.message || 'Failed to create transfer inscription');
        } finally {
            setCreatingTransfer(false);
        }
    };

    // Unit helpers
    function humanToBaseUnits(human: string, decimals: number): bigint {
        const s = human.trim();
        if (!/^[0-9]+(\.[0-9]+)?$/.test(s)) throw new Error('invalid');
        const [intPart, fracPart = ''] = s.split('.');
        const frac = (fracPart + '0'.repeat(decimals)).slice(0, decimals);
        return BigInt(intPart || '0') * BigInt(10) ** BigInt(decimals) + BigInt(frac || '0');
    }
    function formatIntWithSep(x: string): string {
        return x.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }
    function baseToHuman(base: string, decimals: number): string {
        try {
            const bi = BigInt(base);
            const d = BigInt(decimals);
            const scale = 10n ** d;
            const integer = bi / scale;
            const frac = bi % scale;
            if (frac === 0n) return formatIntWithSep(integer.toString());
            const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/,'');
            return `${formatIntWithSep(integer.toString())}.${fracStr}`;
        } catch { return base; }
    }
    // Input helpers: normalize (remove commas), format with thousand separators
    function normalizeHumanInput(s: string): string {
        return s.replace(/,/g, '').trim();
    }
    function formatHumanInput(value: string, decimals: number): string {
        let raw = value.replace(/,/g, '').replace(/[^0-9.]/g, '');
        const parts = raw.split('.');
        if (parts.length > 2) raw = parts[0] + '.' + parts.slice(1).join('');
        let [intPart = '', fracPart = ''] = raw.split('.');
        if (intPart.length > 1) intPart = intPart.replace(/^0+(?=\d)/, '');
        if (fracPart) fracPart = fracPart.slice(0, decimals);
        const withCommas = formatIntWithSep(intPart || '0');
        return fracPart || value.endsWith('.') ? `${withCommas}${value.includes('.') ? '.' : ''}${fracPart}` : (intPart ? withCommas : '');
    }
    function formatBigIntWithCommas(bi: bigint): string {
        return bi.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    }

    const availableHuman = useMemo(() => availableBalance ? baseToHuman(availableBalance, tokenDecimals) : null, [availableBalance, tokenDecimals]);
    const transferAmtBasePreview = useMemo(() => {
        try {
            const normalized = normalizeHumanInput(transferAmt || '');
            if (!normalized) return '';
            const amt = humanToBaseUnits(normalized, tokenDecimals);
            return formatBigIntWithCommas(amt);
        } catch { return ''; }
    }, [transferAmt, tokenDecimals]);

    // Minimal tx decoder to read output value for seller token UTXO
    const readVarInt = (buf: Uint8Array, o: { i: number }): number => {
        const first = buf[o.i++];
        if (first < 0xfd) return first;
        if (first === 0xfd) { const v = new DataView(buf.buffer).getUint16(o.i, true); o.i += 2; return v; }
        if (first === 0xfe) { const v = new DataView(buf.buffer).getUint32(o.i, true); o.i += 4; return v; }
        const dv = new DataView(buf.buffer);
        const low = dv.getUint32(o.i, true); const high = dv.getUint32(o.i + 4, true); o.i += 8; return low + high * 2 ** 32;
    };
    const decodeOutputs = (hex: string): { value: number; script: Uint8Array }[] => {
        const bytes = hexToBytes(hex);
        const dv = new DataView(bytes.buffer);
        const o = { i: 0 };
        o.i += 4; // version
        o.i += 4; // versionGroupId
        const vin = readVarInt(bytes, o);
        for (let n = 0; n < vin; n++) {
            o.i += 32; // txid
            o.i += 4; // vout
            const sl = readVarInt(bytes, o);
            o.i += sl; // scriptSig
            o.i += 4; // sequence
        }
        const vout = readVarInt(bytes, o);
        const outs: { value: number; script: Uint8Array }[] = [];
        for (let n = 0; n < vout; n++) {
            const val = Number(dv.getBigUint64(o.i, true)); o.i += 8;
            const pkLen = readVarInt(bytes, o);
            const script = bytes.slice(o.i, o.i + pkLen); o.i += pkLen;
            outs.push({ value: val, script });
        }
        return outs;
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

            // Maker-ask signature (ZIP-243 SINGLE|ANYONECANPAY)
            const consensusBranchId = await getBranchId({});
            // Fetch prevout value to include in sighash
            let prevValue = 0;
            try {
                const r = await fetch(`/api/zcash/tx/${txid}`);
                if (r.ok) {
                    const { raw } = await r.json();
                    const outs = decodeOutputs(raw);
                    if (outs[vout]) prevValue = outs[vout].value;
                }
            } catch {}
            if (!Number.isFinite(prevValue) || prevValue <= 0) {
                throw new Error('Failed to fetch token UTXO value');
            }

            const priceZats = Math.round(parseFloat(price) * 1e8);
            const sellerFeeZats = Math.floor(priceZats * 0.025);
            const sellerPayoutZats = priceZats - sellerFeeZats;

            // Build outputs such that index 1 is seller payout (binding target)
            const sellerScript = buildP2PKHScript(addressToPkh(wallet.address));
            const outputs = [
                { value: 0, scriptPubKey: new Uint8Array() }, // placeholder for token->buyer (index 0)
                { value: sellerPayoutZats, scriptPubKey: sellerScript }, // index 1 payout
            ];
            // Build SINGLE|ANYONECANPAY sighash for input index 1 (binds to outputs[1])
            const txData = {
                version: 0x80000004,
                versionGroupId: 0x892f2085,
                consensusBranchId,
                lockTime: 0,
                expiryHeight: 0,
                inputs: [
                    // one placeholder buyer input before seller to keep seller at index 1
                    { txid: txid, vout: 0xffffffff, sequence: 0xfffffffd, value: 0, scriptPubKey: new Uint8Array() },
                    { txid, vout, sequence: 0xfffffffd, value: prevValue, scriptPubKey: sellerScript },
                ],
                outputs,
            } as any;
            const HASH_SINGLE_ANYONECANPAY = 0x83;
            const sighash = zip243Sighash(txData, 1, HASH_SINGLE_ANYONECANPAY);
            const priv = wifToPriv(wallet.privateKey);
            const pub = secp.getPublicKey(priv, true);
            const sig: any = await secp.sign(sighash, priv);
            const sig64 = sig.toCompactRawBytes ? sig.toCompactRawBytes() : sig;
            const der = signatureToDER(sig64);
            const sigWithType = new Uint8Array([...der, HASH_SINGLE_ANYONECANPAY]);
            const scriptSig = concatBytes([pushData(sigWithType), pushData(pub)]);
            const sellerScriptSigHex = bytesToHex(scriptSig);

            // Save listing with maker fields
            const tokenAmountDisplay = parseFloat(String(zrc20.amt));
            await createListing({
                tokenLocation: location,
                sellerAddress: wallet.address,
                price: parseFloat(price),
                tokenTicker: zrc20.tick,
                tokenAmount: Number.isFinite(tokenAmountDisplay) ? tokenAmountDisplay : undefined,
                sellerInputTxid: txid,
                sellerInputVout: vout,
                sellerInputSequence: 0xfffffffd,
                sellerScriptSigHex,
                sellerPayoutZats,
                sellerPayoutScriptHex: bytesToHex(sellerScript),
            } as any);

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

    const hasAvailable = useMemo(() => {
        try { return !!availableBalance && BigInt(availableBalance) > 0n; } catch { return false; }
    }, [availableBalance]);

    // Live job status for newly created transfer inscription (tooling-compatible)
    const job = useQuery(api.jobs.getJob as any, mintJobId ? { jobId: mintJobId as any } : "skip");
    useEffect(() => {
        if (!job) return;
        if (job.status === 'failed') {
            setError(job.error || 'Transfer creation failed');
            setCreatingTransfer(false);
            setMintJobId(null);
        } else if (job.status === 'completed' && Array.isArray(job.inscriptionIds) && job.inscriptionIds.length > 0) {
            const inscriptionId = job.inscriptionIds[job.inscriptionIds.length - 1];
            // Optimistically add with :0 outpoint; indexer polling below will refine
            const optimistic = { id: inscriptionId, location: `${String(inscriptionId).replace(/i0$/, '')}:0`, zrc20: { tick: (ticker || '').toUpperCase(), amt: transferAmt || '0' } };
            setInscriptions((prev) => [optimistic, ...prev]);
            setSelectedInscription(optimistic);
            setCreatingTransfer(false);
            setMintJobId(null);
        }
    }, [job]);

    return (
        <div className="w-full max-w-2xl mx-auto">
            <div className="flex justify-between items-center mb-6">
                <h2 className="text-2xl font-bold text-gold-400 tracking-tight">Create Listing</h2>
                {onCancel && (
                    <button onClick={onCancel} className="text-gold-300/70 hover:text-gold-100">
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
                        <label className="block text-sm font-medium text-gold-300/80 mb-2">
                            Select ZRC-20 Transfer to Sell
                        </label>
                        {loadingInscriptions ? (
                            <div className="text-gold-500 animate-pulse">Scanning for valid transfers...</div>
                        ) : inscriptions.length === 0 ? (
                            <div className="space-y-3">
                              <div className="text-gold-300/80">No transferable {ticker || ''} inscriptions found.</div>
                              {ticker && (
                                <div className="p-5 bg-black/40 backdrop-blur-md border border-gold-500/20 rounded-none">
                                  <div className="flex items-baseline justify-between">
                                    <div className="text-xs uppercase tracking-wider text-gold-300/70">Your Balance</div>
                                    <div className="text-2xl font-black text-gold-100">{availableHuman ?? '—'} <span className="text-gold-300/70 text-sm ml-1">{ticker.toUpperCase()}</span></div>
                                  </div>
                                  <div className="mt-1 text-[11px] text-gold-300/70 font-mono">Raw amount: {availableBalance ?? '—'}</div>
                                  <div className="text-[10px] text-gold-300/60">Precision: {tokenDecimals} decimals</div>
                                  <div className="mt-2 text-xs text-gold-300/70">Create a transfer from the amount you wish to sell.</div>
                                </div>
                              )}
                              {ticker && (
                                <div className="space-y-2">
                                  <label className="block text-xs text-gold-300/70">Create Transfer Amount ({tokenDecimals} decimals)</label>
                                  <div className="flex items-center gap-3">
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      pattern="[0-9.]*"
                                      value={transferAmt}
                                      onChange={(e) => setTransferAmt(formatHumanInput(e.target.value, tokenDecimals))}
                                      className="flex-1 bg-black/40 backdrop-blur-md border border-gold-500/20 rounded-none p-3 text-gold-100 focus:outline-none focus:border-gold-400"
                                      placeholder="e.g. 1000"
                                    />
                                    <button
                                      onClick={handleCreateTransfer}
                                      disabled={creatingTransfer || !wallet || !hasAvailable}
                                      className="px-5 py-3 bg-gold-500 hover:bg-gold-400 text-black font-bold rounded-none disabled:opacity-50"
                                    >
                                      {creatingTransfer ? 'Creating…' : 'Create Transfer'}
                                    </button>
                                    {hasAvailable && (
                                      <button
                                        type="button"
                                      onClick={() => setTransferAmt(availableHuman || '')}
                                      className="px-2 py-2 text-xs text-gold-300/80 hover:text-gold-100"
                                      >Use Max</button>
                                    )}
                                  </div>
                                  {/* Removed raw units preview for simplicity */}
                                </div>
                              )}
                            </div>
                        ) : (
                            <div className="grid grid-cols-2 gap-2 max-h-60 overflow-y-auto p-2 border border-gold-500/20 rounded-none bg-black/40 backdrop-blur-md">
                                {inscriptions.map((ins: any, idx: number) => (
                                    <div
                                        key={ins.id || ins.inscription_id || idx}
                                        onClick={() => setSelectedInscription(ins)}
                                        className={`p-3 rounded-none cursor-pointer border transition-all ${
                                            selectedInscription?.id === ins.id || selectedInscription?.inscription_id === ins.inscription_id
                                            ? "border-gold-500 bg-gold-500/10"
                                            : "border-gold-500/10 hover:border-gold-500/30"
                                            }`}
                                    >
                                        <div className="text-xs text-gold-300/60 mb-1">
                                            #{ins.number || ins.inscription_number || idx + 1}
                                        </div>
                                        <div className="text-lg font-bold text-gold-100">
                                            {baseToHuman(String(ins.zrc20?.amt || '0'), tokenDecimals)} {ins.zrc20?.tick}
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
                        <label className="block text-sm font-medium text-gold-300/80 mb-2">
                            Price (ZEC)
                        </label>
                        <input
                            type="number"
                            value={price}
                            onChange={(e) => setPrice(e.target.value)}
                            className="w-full bg-black/40 backdrop-blur-md border border-gold-500/20 rounded-none p-3 text-gold-100 focus:outline-none focus:border-gold-400 transition-colors placeholder-gold-300/20"
                            placeholder="0.1"
                            step="0.0001"
                        />
                    </div>

                    {/* Token Details (Read-only) */}
                    {selectedInscription && (
                        <div className="mt-2 p-4 rounded-none border border-gold-500/20 bg-gradient-to-br from-black/50 via-black/30 to-black/20 backdrop-blur-md text-sm text-gold-300/70 ring-1 ring-black/30">
                            <div className="flex justify-between">
                                <span>Token:</span>
                                <span className="text-gold-200">{(selectedInscription as any).zrc20?.tick}</span>
                            </div>
                            <div className="flex justify-between">
                                <span>Amount:</span>
                                <span className="text-gold-200">{baseToHuman(String((selectedInscription as any).zrc20?.amt || '0'), tokenDecimals)}</span>
                            </div>
                            <div className="mt-2 flex items-center gap-2">
                              {verifying && (
                                <span className="text-gold-300/70">Verifying…</span>
                              )}
                              {!verifying && verifyPending && (
                                <span className="px-2 py-1 rounded-none bg-gold-500/10 border border-gold-500/30 text-gold-200 text-xs font-bold">Pending indexer</span>
                              )}
                              {!verifying && !verifyPending && verified && (
                                <span className="px-2 py-1 rounded-none bg-green-900/20 border border-green-700/40 text-green-300 text-xs font-bold">Verified by indexer</span>
                              )}
                              {!verifying && !verifyPending && !verified && (
                                <span className="px-2 py-1 rounded-none bg-red-900/20 border border-red-800/40 text-red-300 text-xs font-bold">Not verifiable</span>
                              )}
                              {!verified && verifyNote && (
                                <span className="text-xs text-gold-300/80 truncate" title={verifyNote}>{verifyNote}</span>
                              )}
                            </div>
                        </div>
                    )}
                    {/* Error/Success Messages */}
                    {error && (
                        <div
                          role="alert"
                          className="bg-gold-500/10 border border-gold-500/30 text-gold-200 p-3 rounded-none text-sm flex items-start gap-2"
                        >
                          <svg
                            width="18"
                            height="18"
                            viewBox="0 0 24 24"
                            fill="currentColor"
                            className="text-gold-400 mt-0.5 shrink-0"
                            aria-hidden="true"
                          >
                            <path d="M12 2c.5 0 .95.26 1.2.69l9.14 15.01c.47.78-.1 1.77-.99 1.77H2.65c-.89 0-1.46-.99-.99-1.77L10.8 2.69A1.38 1.38 0 0 1 12 2zm-.75 5.5h1.5v7h-1.5v-7zm0 8.5h1.5v2h-1.5v-2z" />
                          </svg>
                          <span>{error}</span>
                        </div>
                    )}
                    {success && (
                        <div className="bg-green-900/20 border border-green-800/50 text-green-200 p-3 rounded-none text-sm">
                            Listing created successfully!
                        </div>
                    )}

                    {/* Submit Button */}
                    <button
                        onClick={handleCreate}
                        disabled={loading || !selectedInscription || !price || verifying || !verified}
                        className="w-full py-3 bg-gold-500 hover:bg-gold-400 text-black font-bold rounded-none transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        {loading ? "Creating Listing..." : (verifying ? 'Verifying…' : (verified ? "List Item" : (verifyPending ? 'Pending…' : 'Verify to List')))}
                    </button>
                </div>
            )}
        </div>
    );
}
