'use client';

import React from 'react';

import { useState, useEffect } from 'react';
import { useWallet } from '@/contexts/WalletContext';
import Link from 'next/link';
// Switch to Convex actions for inscription flows
import { getConvexClient } from '@/lib/convexClient';
import { api } from '../../../convex/_generated/api';
import bs58check from 'bs58check';
import * as secp from '@noble/secp256k1';
import { hmac } from '@noble/hashes/hmac';
import { sha256 } from '@noble/hashes/sha256';
import { safeMintInscription } from '@/utils/inscribe';
import {
  PLATFORM_FEES,
  TREASURY_WALLET,
  calculateTotalCost,
  formatZEC,
  formatUSD,
  isValidZcashName,
  zatoshisToZEC
} from '@/config/fees';
import { FeeBreakdown } from '@/components/FeeBreakdown';
import { ConfirmTransaction } from '@/components/ConfirmTransaction';
import { InscriptionHistory } from '@/components/InscriptionHistory';
import { formatErrorAlert, sanitizeError, logError } from '@/utils/errorMessages';

export default function InscribePage() {
  // Ensure noble-secp has HMAC in browser (for deterministic signing)
  if (!(secp as any).etc.hmacSha256Sync) {
    (secp as any).etc.hmacSha256Sync = (key: Uint8Array, ...msgs: Uint8Array[]) =>
      hmac(sha256, key, (secp as any).etc.concatBytes(...msgs));
  }
  const { wallet, isConnected } = useWallet();
  const [activeTab, setActiveTab] = useState<'names' | 'text' | 'zrc20' | 'utxo' | 'history'>('names');

  // Name registration form
  const [nameInput, setNameInput] = useState('');
  const [nameExtension, setNameExtension] = useState<'zec' | 'zcash'>('zec');
  const [nameError, setNameError] = useState<string | null>(null);

  // Text inscription form
  const [textContent, setTextContent] = useState('');
  const [contentType, setContentType] = useState('text/plain');

  // ZRC-20 form
  const [zrcOp, setZrcOp] = useState<'deploy'|'mint'|'transfer'>('mint');
  const [tick, setTick] = useState('');
  const [amount, setAmount] = useState('');
  const [maxSupply, setMaxSupply] = useState('');
  const [mintLimit, setMintLimit] = useState('');

  // Status
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ txid: string; inscriptionId: string } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingArgs, setPendingArgs] = useState<{
    content?: string;
    contentJson?: string;
    contentType: string;
    type?: string;
    inscriptionAmount: number;
    fee: number;
  } | null>(null);
  const [confirmTitle, setConfirmTitle] = useState<string>('Confirm Transaction');
  const [error, setError] = useState<string | null>(null);

  const fullName = `${nameInput}.${nameExtension}`;

  // Validate name in real-time
  const validateName = (name: string) => {
    if (!name) {
      setNameError(null);
      return;
    }
    const validation = isValidZcashName(`${name}.${nameExtension}`);
    setNameError(validation.valid ? null : validation.error || null);
  };

  const handleNameRegistration = async () => {
    if (!wallet?.privateKey || !wallet?.address) {
      setError('Please connect your wallet first');
      return;
    }

    if (!nameInput.trim()) {
      setError('Please enter a name');
      return;
    }

    const validation = isValidZcashName(fullName);
    if (!validation.valid) {
      setError(validation.error || 'Invalid name');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      setConfirmTitle('Confirm Name Registration');
      setPendingArgs({ content: fullName, contentType: 'text/plain', type: 'name', inscriptionAmount: 60000, fee: 10000 });
      setConfirmOpen(true);
    } catch (err) {
      logError(err, 'Name Registration');
      setError(sanitizeError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleTextInscription = async () => {
    if (!wallet?.privateKey || !wallet?.address) {
      setError('Please connect your wallet first');
      return;
    }

    if (!textContent.trim()) {
      setError('Please enter content to inscribe');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const isJson = contentType === 'application/json';
      setConfirmTitle('Confirm Text Inscription');
      setPendingArgs({ content: isJson ? undefined : textContent, contentJson: isJson ? textContent : undefined, contentType, type: isJson ? 'json' : 'text', inscriptionAmount: 60000, fee: 10000 });
      setConfirmOpen(true);
    } catch (err) {
      logError(err, 'Text Inscription');
      setError(sanitizeError(err));
    } finally {
      setLoading(false);
    }
  };

  const handleZRC20Mint = async () => {
    if (!wallet?.privateKey || !wallet?.address) {
      setError('Please connect your wallet first');
      return;
    }

    if (!tick.trim()) { setError('Please enter ticker'); return; }
    if (zrcOp === 'mint' || zrcOp === 'transfer') {
      if (!amount.trim()) { setError('Please enter amount'); return; }
    }
    if (zrcOp === 'deploy') {
      if (!maxSupply.trim() || !mintLimit.trim()) { setError('Please enter max and limit'); return; }
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      const payload = JSON.stringify(
        zrcOp === 'deploy'
          ? { p: 'zrc-20', op: 'deploy', tick: tick.toUpperCase(), max: maxSupply, lim: mintLimit }
          : zrcOp === 'transfer'
          ? { p: 'zrc-20', op: 'transfer', tick: tick.toUpperCase(), amt: amount }
          : { p: 'zrc-20', op: 'mint', tick: tick.toUpperCase(), amt: amount }
      );
      setConfirmTitle('Confirm ZRC‑20 Action');
      setPendingArgs({ contentJson: payload, contentType: 'application/json', type: zrcOp === 'deploy' ? 'zrc20-deploy' : zrcOp === 'transfer' ? 'zrc20-transfer' : 'zrc20-mint', inscriptionAmount: 60000, fee: 10000 });
      setConfirmOpen(true);
    } catch (err) {
      logError(err, 'ZRC-20 Mint');
      setError(sanitizeError(err));
    } finally {
      setLoading(false);
    }
  };

  // Split UTXOs UI state
  const [splitCount, setSplitCount] = useState(5);
  const [targetAmount, setTargetAmount] = useState(70000);
  const [splitFee, setSplitFee] = useState(10000);
  const [splitTxid, setSplitTxid] = useState<string | null>(null);
  const [batchCount, setBatchCount] = useState(5);
  const [batchJobId, setBatchJobId] = useState<string | null>(null);
  const [batchStatus, setBatchStatus] = useState<{ status: string; completed: number; total: number; ids: string[] } | null>(null);
  const [safety, setSafety] = useState<'unknown'|'on'|'off'>('unknown');
  const [demoOpen, setDemoOpen] = useState(false);
  const [demoContent, setDemoContent] = useState('hello from client-signing demo');
  const [demoRunning, setDemoRunning] = useState(false);
  const [demoLog, setDemoLog] = useState<string[]>([]);

  // Ping indexer to display safety status
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('https://indexer.zerdinals.com/location/0:0');
        if (!cancelled) setSafety(r.status === 404 ? 'on' : 'on');
      } catch {
        if (!cancelled) setSafety('off');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const handleSplit = async () => {
    if (!wallet?.privateKey || !wallet?.address) { setError('Please connect your wallet first'); return; }
    setConfirmTitle('Confirm UTXO Split');
    setPendingArgs({ contentType: 'split', inscriptionAmount: 0, fee: splitFee });
    setConfirmOpen(true);
  };

  const runClientSigningDemo = async () => {
    if (!wallet?.privateKey || !wallet?.address) { setError('Please connect your wallet first'); return; }
    setDemoRunning(true); setDemoLog([]);
    try {
      // Build signer using local WIF
      const wifPayload = (await import('bs58check')).default.decode(wallet.privateKey) as Uint8Array;
      const priv = wifPayload.slice(1, wifPayload.length === 34 ? 33 : undefined);
      const pubKeyHex = Array.from((await import('@noble/secp256k1')).getPublicKey(priv, true)).map(b=>b.toString(16).padStart(2,'0')).join('');
      const signer = async (sighashHex: string) => {
        const secp = await import('@noble/secp256k1');
        const digest = Uint8Array.from(sighashHex.match(/.{1,2}/g)!.map((b)=>parseInt(b,16)));
        const sig = await secp.sign(digest, priv);
        const raw = (sig as any).toCompactRawBytes ? (sig as any).toCompactRawBytes() : (sig as Uint8Array);
        return Array.from(raw).map(b=>b.toString(16).padStart(2,'0')).join('');
      };
      const convex = getConvexClient(); if (!convex) throw new Error('Service not available. Please try again in a moment.');
      // Step 1
      const step1 = await convex.action(api.inscriptionsActions.buildUnsignedCommitAction, {
        address: wallet.address,
        pubKeyHex,
        content: demoContent,
        contentType: 'text/plain',
        type: 'demo', inscriptionAmount: 60000, fee: 10000,
      } as any);
      setDemoLog(l => [...l, `commitSigHashHex: ${step1.commitSigHashHex.slice(0,16)}...`]);
      // Step 2
      const commitSignatureRawHex = await signer(step1.commitSigHashHex);
      const step2 = await convex.action(api.inscriptionsActions.finalizeCommitAndGetRevealPreimageAction, {
        contextId: step1.contextId,
        commitSignatureRawHex,
      });
      setDemoLog(l => [...l, `commitTxid: ${step2.commitTxid}`, `revealSigHashHex: ${step2.revealSigHashHex.slice(0,16)}...`]);
      // Step 3
      const revealSignatureRawHex = await signer(step2.revealSigHashHex);
      const step3 = await convex.action(api.inscriptionsActions.broadcastSignedRevealAction, {
        contextId: step1.contextId,
        revealSignatureRawHex,
      });
      setDemoLog(l => [...l, `revealTxid: ${step3.revealTxid}`, `inscriptionId: ${step3.inscriptionId}`]);
    } catch (e: any) {
      logError(e, 'Demo Inscription');
      setDemoLog(l => [...l, `Error: ${sanitizeError(e)}`]);
    } finally { setDemoRunning(false); }
  };

  const handleBatchMint = async () => {
    if (!wallet?.privateKey || !wallet?.address) { setError('Please connect your wallet first'); return; }
    if (!tick.trim() || !amount.trim()) { setError('Please enter ticker and amount'); return; }
    setLoading(true);
    setError(null);
    setBatchStatus(null);
    setBatchJobId(null);
    try {
      const convex = getConvexClient(); if (!convex) throw new Error('Service not available. Please try again in a moment.');
      const payload = JSON.stringify({ p: 'zrc-20', op: 'mint', tick: tick.toUpperCase(), amt: amount });
      const res = await convex.action(api.inscriptionsActions.batchMintAction, {
        wif: wallet.privateKey,
        address: wallet.address,
        count: batchCount,
        contentJson: payload,
        contentType: 'application/json',
        inscriptionAmount: 60000,
        fee: 10000,
        waitMs: 10000,
      });
      setBatchJobId(res.jobId);
      // Start polling job status
      const interval = setInterval(async () => {
        try {
          const job = await convex.query(api.jobs.getJob, { jobId: res.jobId });
          if (job) {
            setBatchStatus({ status: job.status, completed: job.completedCount, total: job.totalCount, ids: job.inscriptionIds });
            if (job.status === 'completed' || job.status === 'failed') clearInterval(interval);
          }
        } catch (e) {
          console.error('Job poll error', e);
        }
      }, 3000);
    } catch (err) {
      logError(err, 'Batch Mint');
      setError(sanitizeError(err));
    } finally { setLoading(false); }
  };

  const nameCost = calculateTotalCost(PLATFORM_FEES.NAME_REGISTRATION);
  const textCost = calculateTotalCost(PLATFORM_FEES.INSCRIPTION);
  const zrc20Cost = calculateTotalCost(PLATFORM_FEES.INSCRIPTION);

  return (
    <main className="min-h-screen h-screen bg-black text-gold-300 pt-20 pb-4 overflow-hidden">
      <div className="container mx-auto px-4 sm:px-6 h-full flex flex-col max-w-7xl">
        <div className="flex flex-col lg:flex-row gap-4 h-full min-h-0">
          {/* Left Sidebar - Tabs */}
          <div className="lg:w-56 flex-shrink-0 flex flex-col lg:overflow-y-auto">
            {/* Mobile: Horizontal Scrolling Tabs */}
            <div className="flex lg:flex-col gap-2 overflow-x-auto lg:overflow-x-visible pb-2 lg:pb-0 -mx-4 px-4 lg:mx-0 lg:px-0 scrollbar-hide">
              <button
                onClick={() => setActiveTab('names')}
                className={`flex-shrink-0 lg:w-full text-left px-6 py-3 sm:px-6 sm:py-4 rounded-lg font-bold transition-all ${
                  activeTab === 'names'
                    ? 'bg-gold-500 text-black shadow-sm shadow-gold-500/50'
                    : 'bg-black/40 border border-gold-500/30 text-gold-400 hover:border-gold-500/50'
                }`}
              >
                <div className="text-sm sm:text-base lg:text-lg whitespace-nowrap lg:whitespace-normal">Names</div>
                <div className="text-xs opacity-75 hidden sm:block">.zec • .zcash</div>
              </button>

              <button
                onClick={() => setActiveTab('text')}
                className={`flex-shrink-0 lg:w-full text-left px-6 py-3 sm:px-6 sm:py-4 rounded-lg font-bold transition-all ${
                  activeTab === 'text'
                    ? 'bg-gold-500 text-black shadow-sm shadow-gold-500/50'
                    : 'bg-black/40 border border-gold-500/30 text-gold-400 hover:border-gold-500/50'
                }`}
              >
                <div className="text-sm sm:text-base lg:text-lg whitespace-nowrap lg:whitespace-normal">Text</div>
                <div className="text-xs opacity-75 hidden sm:block">Inscriptions</div>
              </button>

              <button
                onClick={() => setActiveTab('zrc20')}
                className={`flex-shrink-0 lg:w-full text-left px-6 py-3 sm:px-6 sm:py-4 rounded-lg font-bold transition-all ${
                  activeTab === 'zrc20'
                    ? 'bg-gold-500 text-black shadow-sm shadow-gold-500/50'
                    : 'bg-black/40 border border-gold-500/30 text-gold-400 hover:border-gold-500/50'
                }`}
              >
                <div className="text-sm sm:text-base lg:text-lg whitespace-nowrap lg:whitespace-normal">ZRC-20</div>
                <div className="text-xs opacity-75 hidden sm:block">Token Mint</div>
              </button>

              <button
                onClick={() => setActiveTab('utxo')}
                className={`flex-shrink-0 lg:w-full text-left px-6 py-3 sm:px-6 sm:py-4 rounded-lg font-bold transition-all ${
                  activeTab === 'utxo'
                    ? 'bg-gold-500 text-black shadow-sm shadow-gold-500/50'
                    : 'bg-black/40 border border-gold-500/30 text-gold-400 hover:border-gold-500/50'
                }`}
              >
                <div className="text-sm sm:text-base lg:text-lg whitespace-nowrap lg:whitespace-normal">UTXO</div>
                <div className="text-xs opacity-75 hidden sm:block">UTXO MANAGEMENT</div>
              </button>

              <button
                onClick={() => setActiveTab('history')}
                className={`flex-shrink-0 lg:w-full text-left px-6 py-3 sm:px-6 sm:py-4 rounded-lg font-bold transition-all ${
                  activeTab === 'history'
                    ? 'bg-gold-500 text-black shadow-sm shadow-gold-500/50'
                    : 'bg-black/40 border border-gold-500/30 text-gold-400 hover:border-gold-500/50'
                }`}
              >
                <div className="text-sm sm:text-base lg:text-lg whitespace-nowrap lg:whitespace-normal">History</div>
                <div className="text-xs opacity-75 hidden sm:block">Inscription History</div>
              </button>
            </div>

            {/* Fee Info - Hidden on mobile */}
            <div className="hidden lg:block mt-8 p-4 bg-black/40 border border-gold-500/20 rounded-lg">
              <div className="text-xs text-gold-400/60 mb-2">Platform Fees</div>
              <div className="space-y-1 text-xs">
                <div className="flex justify-between">
                  <span className="text-gold-400/80">Inscriptions</span>
                  <span className="text-gold-300 font-mono">{formatZEC(PLATFORM_FEES.INSCRIPTION)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Main Content Area */}
          <div className="flex-1 bg-black/40 border border-none rounded-xl sm:rounded-2xl backdrop-blur-xl overflow-y-auto min-h-0">
            <div className="p-4 sm:p-6 lg:p-8">
            {/* NAME REGISTRATION TAB */}
            {activeTab === 'names' && (
              <div className="max-w-2xl mx-auto">
                <div className="text-center mb-6 sm:mb-8 lg:mb-10">
                  <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold mb-2">Register Your Zcash Name</h2>
                  <p className="text-gold-400/60 text-xs sm:text-sm lg:text-base">
                    Secure your .zec or .zcash identity on the blockchain
                  </p>
                </div>

                {/* Name Search Box */}
                <div className="mb-4 sm:mb-6">
                  <div className="relative">
                    <div className="flex flex-col sm:flex-row gap-0 bg-black/60 border-2 border-gold-500/50 rounded-xl overflow-hidden focus-within:border-gold-500 transition-all">
                      <input
                        type="text"
                        value={nameInput}
                        onChange={(e) => {
                          const value = e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '');
                          setNameInput(value);
                          validateName(value);
                        }}
                        className="flex-1 bg-transparent px-4 py-3 sm:px-6 sm:py-4 text-lg sm:text-xl font-mono text-gold-300 placeholder-gold-500/40 outline-none"
                        placeholder="yourname"
                        disabled={loading}
                      />
                      <select
                        value={nameExtension}
                        onChange={(e) => {
                          setNameExtension(e.target.value as 'zec' | 'zcash');
                          validateName(nameInput);
                        }}
                        className="bg-black/60 border-t sm:border-t-0 sm:border-l border-gold-500/30 pl-4 pr-10 py-3 sm:pl-6 sm:pr-12 sm:py-4 text-lg sm:text-xl font-mono text-gold-300 outline-none cursor-pointer"
                        disabled={loading}
                      >
                        <option value="zec">.zec</option>
                        <option value="zcash">.zcash</option>
                      </select>
                    </div>
                    {nameError && (
                      <div className="absolute top-full mt-2 text-red-400 text-sm">
                        {nameError}
                      </div>
                    )}
                  </div>
                </div>

                {/* Name Preview */}
                {nameInput && !nameError && (
                  <div className="mb-4 sm:mb-6 p-3 sm:p-4 bg-gold-500/10 border border-gold-500/30 rounded-xl">
                    <div className="flex items-center justify-between mb-2 sm:mb-3">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-gold-400/60 mb-1">Your Name</div>
                        <div className="text-lg sm:text-xl lg:text-2xl font-bold font-mono break-all">{fullName}</div>
                      </div>
                      <div className="size-10 sm:size-12 lg:size-14 bg-gold-500 rounded-full flex items-center justify-center text-black text-base sm:text-lg lg:text-xl font-bold flex-shrink-0 ml-3">
                        {nameInput[0]?.toUpperCase()}
                      </div>
                    </div>
                    <div className="text-xs text-gold-400/80">
                      Owner: {wallet?.address.substring(0, 12)}...
                    </div>
                  </div>
                )}

                {/* Cost Breakdown */}
                <div className="mb-4 sm:mb-6">
                  <FeeBreakdown
                    platformFee={nameCost.platformFee}
                    networkFee={nameCost.networkFee}
                    inscriptionOutput={nameCost.inscriptionOutput}
                    total={nameCost.total}
                  />
                </div>

                <button
                  onClick={handleNameRegistration}
                  disabled={loading || !isConnected || !nameInput.trim() || !!nameError}
                  className="w-full px-4 py-3 sm:px-6 sm:py-4 bg-gold-500 text-black font-bold text-base sm:text-lg rounded-lg hover:bg-gold-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm shadow-gold-500/20"
                >
                  {loading ? 'Registering...' : `Register ${fullName}`}
                </button>
              </div>
            )}

            {/* TEXT INSCRIPTION TAB */}
            {activeTab === 'text' && (
              <div className="max-w-2xl mx-auto space-y-3 sm:space-y-4">
                <div className="text-center mb-4 sm:mb-6">
                  <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold mb-2">Text Inscription</h2>
                  <p className="text-gold-400/60 text-xs sm:text-sm lg:text-base">
                    Inscribe any text or data permanently on Zcash
                  </p>
                </div>

                <div>
                  <label className="block text-gold-200/80 text-sm mb-2">Content Type</label>
                  <select
                    value={contentType}
                    onChange={(e) => setContentType(e.target.value)}
                    className="w-full bg-black/40 border border-gold-500/30 rounded-lg pl-4 pr-10 py-3 text-gold-300 outline-none focus:border-gold-500/50"
                    disabled={loading}
                  >
                    <option value="text/plain">Text (text/plain)</option>
                    <option value="application/json">JSON (application/json)</option>
                    <option value="text/html">HTML (text/html)</option>
                    <option value="image/svg+xml">SVG (image/svg+xml)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-gold-200/80 text-xs sm:text-sm mb-2">
                    Content {textContent.length > 0 && `(${textContent.length} characters)`}
                  </label>
                  <textarea
                    value={textContent}
                    onChange={(e) => setTextContent(e.target.value)}
                    className="w-full bg-black/40 border border-gold-500/30 rounded-lg px-3 py-2 sm:px-4 sm:py-3 text-gold-300 font-mono text-xs sm:text-sm min-h-[180px] sm:min-h-[240px] outline-none focus:border-gold-500/50 resize-none"
                    placeholder="Enter your inscription content..."
                    disabled={loading}
                  />
                  <p className="text-gold-400/60 text-xs mt-1.5">
                    Keep content under 80KB for optimal indexing
                  </p>
                </div>

                <FeeBreakdown
                  platformFee={textCost.platformFee}
                  networkFee={textCost.networkFee}
                  inscriptionOutput={textCost.inscriptionOutput}
                  total={textCost.total}
                />

                <button
                  onClick={handleTextInscription}
                  disabled={loading || !isConnected || !textContent.trim()}
                  className="w-full px-4 py-3 sm:px-6 sm:py-4 bg-gold-500 text-black font-bold text-base sm:text-lg rounded-lg hover:bg-gold-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {loading ? 'Creating Inscription...' : 'Inscribe'}
                </button>
              </div>
            )}

            {/* ZRC-20 TAB */}
            {activeTab === 'zrc20' && (
              <div className="max-w-2xl mx-auto space-y-3 sm:space-y-4">
                {/* Safety + Fee Status */}
                <div className="flex items-center justify-end mb-2 sm:mb-3 gap-2">
                  <div className="text-gold-400/70 text-xs flex items-center gap-3 flex-shrink-0">
                    <span>Safety: {safety === 'on' ? <span className="text-green-400">ON</span> : safety === 'off' ? <span className="text-red-400">OFF</span> : '…'}</span>
                    <span>Fee: {(process.env.NEXT_PUBLIC_PLATFORM_FEE_ENABLED || '').toLowerCase()==='true' ? <span className="text-green-400">ON</span> : <span className="text-gold-400/60">OFF</span>} { (process.env.NEXT_PUBLIC_PLATFORM_FEE_ENABLED || '').toLowerCase()==='true' ? `(${(Number(process.env.NEXT_PUBLIC_PLATFORM_FEE_ZATS||'100000')/1e8).toFixed(3)} ZEC)` : '' }</span>
                  </div>
                </div>


                <div className="text-center mb-4 sm:mb-6">
                  <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold mb-2">Mint ZRC-20 Token</h2>
                  <p className="text-gold-400/60 text-xs sm:text-sm lg:text-base">
                    Mint tokens from deployed ZRC-20 contracts
                  </p>
                </div>

                <div className="bg-gold-500/10 p-3 sm:p-4 rounded-lg border border-gold-500/30 mb-4 sm:mb-6">
                  <p className="text-gold-300 text-xs sm:text-sm">
                    <strong>Note:</strong> Make sure the token has been deployed first and check the minting limits on{' '}
                    <a
                      href="https://zerdinals.com"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-gold-400 hover:underline"
                    >
                      Zerdinals Explorer
                    </a>
                  </p>
                </div>

                {/* Operation */}
                <div>
                  <label className="block text-gold-200/80 text-xs sm:text-sm mb-1.5 sm:mb-2">Operation</label>
                  <select
                    value={zrcOp}
                    onChange={(e)=>setZrcOp(e.target.value as any)}
                    className="w-full bg-black/40 border border-gold-500/30 rounded-lg pl-3 pr-10 py-2 sm:pl-4 sm:pr-10 sm:py-3 text-sm sm:text-base text-gold-300 outline-none focus:border-gold-500/50"
                    disabled={loading}
                  >
                    <option value="mint">Mint</option>
                    <option value="deploy">Deploy</option>
                    <option value="transfer">Transfer</option>
                  </select>
                </div>

                <div>
                  <label className="block text-gold-200/80 text-xs sm:text-sm mb-1.5 sm:mb-2">Token Ticker</label>
                  <input
                    type="text"
                    value={tick}
                    onChange={(e) => setTick(e.target.value.toUpperCase())}
                    className="w-full bg-black/40 border border-gold-500/30 rounded-lg px-3 py-2 sm:px-4 sm:py-3 text-sm sm:text-base text-gold-300 font-mono uppercase outline-none focus:border-gold-500/50"
                    placeholder="ZERO"
                    maxLength={4}
                    disabled={loading}
                  />
                </div>

                {zrcOp !== 'deploy' && (
                  <div>
                    <label className="block text-gold-200/80 text-xs sm:text-sm mb-1.5 sm:mb-2">Amount</label>
                    <input type="number" value={amount} onChange={(e)=>setAmount(e.target.value)} className="w-full bg-black/40 border border-gold-500/30 rounded-lg px-3 py-2 sm:px-4 sm:py-3 text-sm sm:text-base text-gold-300 outline-none focus:border-gold-500/50" placeholder="1000" disabled={loading} />
                  </div>
                )}
                {zrcOp === 'deploy' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-gold-200/80 text-xs sm:text-sm mb-1.5 sm:mb-2">Max Supply</label>
                      <input type="number" value={maxSupply} onChange={(e)=>setMaxSupply(e.target.value)} className="w-full bg-black/40 border border-gold-500/30 rounded-lg px-3 py-2 sm:px-4 sm:py-3 text-sm sm:text-base text-gold-300 outline-none focus:border-gold-500/50" placeholder="21000000" disabled={loading} />
                    </div>
                    <div>
                      <label className="block text-gold-200/80 text-xs sm:text-sm mb-1.5 sm:mb-2">Mint Limit</label>
                      <input type="number" value={mintLimit} onChange={(e)=>setMintLimit(e.target.value)} className="w-full bg-black/40 border border-gold-500/30 rounded-lg px-3 py-2 sm:px-4 sm:py-3 text-sm sm:text-base text-gold-300 outline-none focus:border-gold-500/50" placeholder="1000" disabled={loading} />
                    </div>
                  </div>
                )}

                <div className="bg-black/40 p-2.5 sm:p-3 rounded-lg border border-gold-500/20">
                  <p className="text-gold-400/60 text-xs mb-1.5">Preview:</p>
                  <pre className="text-gold-300 text-xs font-mono overflow-x-auto">
                    {JSON.stringify(
                      zrcOp === 'deploy'
                        ? { p: 'zrc-20', op: 'deploy', tick: tick || 'TICK', max: maxSupply || '0', lim: mintLimit || '0' }
                        : zrcOp === 'transfer'
                        ? { p: 'zrc-20', op: 'transfer', tick: tick || 'TICK', amt: amount || '0' }
                        : { p: 'zrc-20', op: 'mint', tick: tick || 'TICK', amt: amount || '0' },
                      null,
                      2
                    )}
                  </pre>
                </div>

                <FeeBreakdown
                  platformFee={zrc20Cost.platformFee}
                  networkFee={zrc20Cost.networkFee}
                  inscriptionOutput={zrc20Cost.inscriptionOutput}
                  total={zrc20Cost.total}
                />

                <button onClick={handleZRC20Mint} disabled={loading || !isConnected || !tick.trim() || (zrcOp !== 'deploy' && !amount.trim()) || (zrcOp === 'deploy' && (!maxSupply.trim() || !mintLimit.trim()))} className="w-full px-4 py-3 sm:px-6 sm:py-4 bg-gold-500 text-black font-bold text-base sm:text-lg rounded-lg hover:bg-gold-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed">{loading ? 'Submitting...' : (zrcOp === 'deploy' ? 'Deploy Token' : zrcOp === 'transfer' ? 'Inscribe Transfer' : 'Mint ZRC-20')}</button>

                {/* Batch Mint - Enhanced liquid glass design */}
                <div className="mt-8 p-6 sm:p-8 rounded-2xl border-2 border-gold-500/40 bg-gradient-to-br from-gold-500/10 via-transparent to-gold-500/5 backdrop-blur-2xl shadow-xl shadow-gold-500/10 space-y-5">
                  <div className="text-center">
                    <h3 className="text-xl sm:text-2xl font-bold text-gold-300 mb-1">Batch Mint</h3>
                  </div>

                  {/* Count Control - Centered */}
                  <div className="max-w-md mx-auto">
                    <label className="block text-gold-200/80 text-sm font-medium mb-3 text-center">Count</label>
                    <div className="flex items-center justify-center mb-4">
                      <div className="w-28 h-20 bg-black/60 border-2 border-gold-500/40 rounded-lg flex items-center justify-center focus-within:border-gold-500/60 transition-colors">
                        <input
                          type="number"
                          min={1}
                          max={10}
                          value={batchCount}
                          onChange={e=>setBatchCount(Math.max(1, Math.min(10, parseInt(e.target.value||'1'))))}
                          className="w-full h-full bg-transparent text-4xl font-bold text-gold-300 text-center outline-none tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                      </div>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={10}
                      value={batchCount}
                      onChange={e=>setBatchCount(parseInt(e.target.value))}
                      className="w-full h-3 bg-gradient-to-r from-gold-500/30 via-gold-500/50 to-gold-500/30 border border-gold-500/40 rounded-full appearance-none cursor-pointer shadow-inner [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-gradient-to-br [&::-webkit-slider-thumb]:from-gold-400 [&::-webkit-slider-thumb]:to-gold-600 [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-gold-300 [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:shadow-gold-500/60 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110 [&::-moz-range-thumb]:w-6 [&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-gradient-to-br [&::-moz-range-thumb]:from-gold-400 [&::-moz-range-thumb]:to-gold-600 [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-gold-300 [&::-moz-range-thumb]:shadow-lg [&::-moz-range-thumb]:cursor-pointer"
                    />
                  </div>

                  {/* Description */}
                  <p className="text-xs sm:text-sm text-gold-400/70 text-center max-w-lg mx-auto">
                    Batch uses the same ticker/amount as Mint. Use UTXO Tools to prepare funding.
                  </p>

                  {/* Batch Fee Summary */}
                  <div className="text-sm text-gold-400/90 bg-black/30 rounded-lg p-4 border border-gold-500/20">
                    {(() => {
                      const singleTotal = zrc20Cost.total;
                      const batchTotal = singleTotal * Math.max(1, batchCount);
                      return (
                        <div className="space-y-1 text-center">
                          <div>Single mint est. total: <span className="font-mono text-gold-300 font-semibold">{formatZEC(singleTotal)}</span></div>
                          <div className="text-base">Batch est. total: <span className="font-mono text-gold-300 font-bold">{formatZEC(batchTotal)}</span> <span className="text-xs opacity-70">({batchCount} × single)</span></div>
                        </div>
                      );
                    })()}
                  </div>

                  {/* Holographic Button */}
                  <button
                    onClick={handleBatchMint}
                    disabled={loading || !isConnected || !tick.trim() || !amount.trim()}
                    className="relative w-full px-6 py-4 bg-gradient-to-r from-gold-500 via-yellow-400 to-gold-500 text-black font-bold text-lg rounded-xl transition-all duration-300 shadow-lg shadow-gold-500/30 hover:shadow-2xl hover:shadow-gold-500/60 hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:shadow-lg border-2 border-gold-400/50 overflow-hidden before:absolute before:inset-0 before:bg-gradient-to-r before:from-transparent before:via-white/30 before:to-transparent before:-translate-x-full hover:before:translate-x-full before:transition-transform before:duration-700"
                  >
                    <span className="relative z-10">{loading ? 'Batch Minting...' : 'Start Batch Mint'}</span>
                  </button>

                  {batchJobId && (
                    <div className="text-xs text-gold-400/80 text-center">Job ID: <span className="font-mono break-all">{batchJobId}</span></div>
                  )}
                  {batchStatus && (
                    <div className="space-y-3 bg-black/40 rounded-lg p-4 border border-gold-500/20">
                      <div className="flex items-center justify-between text-sm text-gold-300 font-semibold">
                        <span>Status: {batchStatus.status}</span>
                        <span>{batchStatus.completed}/{batchStatus.total}</span>
                      </div>
                      <div className="w-full h-3 bg-black/60 border border-gold-500/30 rounded-full overflow-hidden">
                        <div className="h-full bg-gradient-to-r from-gold-500 to-yellow-400 rounded-full transition-all duration-300" style={{ width: `${Math.min(100, (batchStatus.completed / Math.max(1, batchStatus.total)) * 100)}%` }} />
                      </div>
                      <div className="space-y-1.5 text-xs text-gold-300 max-h-40 overflow-auto">
                        {batchStatus.ids.map((id, idx)=>(
                          <div key={idx} className="flex items-center gap-2 hover:bg-gold-500/10 rounded px-2 py-1"><span className="opacity-70 font-mono">{idx+1}.</span> <a className="underline flex-1 truncate" href={`https://zerdinals.com/zerdinals/${id}`} target="_blank" rel="noreferrer">{id}</a></div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* UTXO TAB */}
            {activeTab === 'utxo' && (
              <div className="max-w-2xl mx-auto">
                <div className="text-center mb-4 sm:mb-6">
                  <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold mb-2">UTXO Management</h2>
                  <p className="text-gold-400/60 text-xs sm:text-sm lg:text-base">
                    Split larger UTXOs into smaller ones to prepare funding for batch operations
                  </p>
                </div>

                <div className="bg-black/40 border border-gold-500/20 rounded-2xl p-4 sm:p-6">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-gold-200/80 text-xs mb-1">Split Count</label>
                      <input type="number" value={splitCount} onChange={e=>setSplitCount(parseInt(e.target.value||'0'))} className="w-full bg-black/40 border border-gold-500/30 rounded px-3 py-2 text-gold-300" />
                    </div>
                    <div>
                      <label className="block text-gold-200/80 text-xs mb-1">Target Amount (zats)</label>
                      <input type="number" value={targetAmount} onChange={e=>setTargetAmount(parseInt(e.target.value||'0'))} className="w-full bg-black/40 border border-gold-500/30 rounded px-3 py-2 text-gold-300" />
                    </div>
                    <div>
                      <label className="block text-gold-200/80 text-xs mb-1">Fee (zats)</label>
                      <input type="number" value={splitFee} onChange={e=>setSplitFee(parseInt(e.target.value||'0'))} className="w-full bg-black/40 border border-gold-500/30 rounded px-3 py-2 text-gold-300" />
                    </div>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <button onClick={handleSplit} disabled={loading || !isConnected} className="px-4 py-3 bg-black/60 border border-gold-500/40 rounded-lg text-gold-300 hover:border-gold-500/60 disabled:opacity-50">{loading ? 'Splitting...' : 'Split UTXOs'}</button>
                    {splitTxid && (<div className="text-xs text-gold-400/80">Split TXID: <span className="font-mono break-all">{splitTxid}</span></div>)}
                  </div>
                </div>
              </div>
            )}

            {/* HISTORY TAB */}
            {activeTab === 'history' && (
              <div className="max-w-5xl mx-auto">
                <div className="text-center mb-4 sm:mb-6">
                  <h2 className="text-xl sm:text-2xl lg:text-3xl font-bold mb-2">Inscription History</h2>
                  <p className="text-gold-400/60 text-xs sm:text-sm lg:text-base">
                    Audit trail of your inscriptions on Zcash
                  </p>
                </div>

                {isConnected && wallet?.address ? (
                  <InscriptionHistory address={wallet.address} />
                ) : (
                  <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                    <p className="text-yellow-400 text-sm text-center">
                      ⚠️ Please connect your wallet to view history
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Connection Warning */}
            {!isConnected && (
              <div className="w-full m-auto max-w-2xl mt-6 flex justify-center">
                <div className="w-full p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                  <p className="text-yellow-400 text-sm text-center">
                    ⚠️ Please connect your wallet to continue
                  </p>
                </div>
              </div>
            )}

            {/* Error Display */}
            {error && (
              <div className="mt-6 p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}

            {/* Success Display */}
            {result && (
              <div className="max-w-2xl m-auto mt-6 p-4 sm:p-6 bg-gold-500/10 border border-gold-500/30 rounded-lg relative">
                <button
                  onClick={() => setResult(null)}
                  className="absolute top-3 right-3 text-gold-400/60 hover:text-gold-300 transition-colors"
                  aria-label="Close"
                >
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
                <h3 className="text-gold-300 font-bold mb-4 text-base sm:text-lg">✓ Success!</h3>
                <div className="space-y-3">
                  <div>
                    <div className="text-gold-400/60 text-sm mb-1">Transaction ID</div>
                    <div className="text-gold-300 font-mono text-xs sm:text-sm break-all bg-black/40 p-3 rounded">
                      {result.txid}
                    </div>
                  </div>
                  <div>
                    <div className="text-gold-400/60 text-sm mb-1">Inscription ID</div>
                    <div className="text-gold-300 font-mono text-xs sm:text-sm break-all bg-black/40 p-3 rounded">
                      {result.inscriptionId}
                    </div>
                  </div>
                  <div className="pt-3">
                    <p className="text-xs text-gold-400/70 mb-2">Note: New inscriptions may take up to ~5 minutes to appear in the public explorer.</p>
                    <a
                      href={`https://zerdinals.com/zerdinals/${result.inscriptionId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-block px-4 sm:px-6 py-2 sm:py-3 bg-gold-500 text-black font-bold text-sm sm:text-base rounded-lg hover:bg-gold-400 transition-all"
                    >
                      View on Explorer →
                    </a>
                  </div>
                </div>
              </div>
            )}

            </div>
          </div>
        </div>
      </div>
      {/* UTXO tools moved into its own tab above */}

      {/* Confirm Modal (reusable component) */}
      {confirmOpen && pendingArgs && (
        <ConfirmTransaction
          isOpen={confirmOpen}
          title={confirmTitle}
          items={[
            ...(pendingArgs.contentType === 'split' ? [] : [{ label: 'Inscription output', valueZats: pendingArgs.inscriptionAmount } as any]),
            { label: 'Network fee', valueZats: pendingArgs.fee },
            ...(pendingArgs.contentType === 'split' ? [] : [{ label: 'Platform fee', valueZats: Number(process.env.NEXT_PUBLIC_PLATFORM_FEE_ZATS || '100000'), hidden: (process.env.NEXT_PUBLIC_PLATFORM_FEE_ENABLED || '').toLowerCase() !== 'true' } as any]),
          ]}
          onCancel={()=>setConfirmOpen(false)}
          onConfirm={async ()=>{
            if (!wallet?.privateKey || !wallet?.address) { setConfirmOpen(false); setError('Please connect your wallet first'); return; }
            setConfirmOpen(false); setLoading(true); setError(null); setResult(null);
            try {
              const wifPayload = bs58check.decode(wallet.privateKey);
              const priv = wifPayload.slice(1, wifPayload.length === 34 ? 33 : undefined);
              const pubKeyHex = Array.from(secp.getPublicKey(priv, true)).map(b=>b.toString(16).padStart(2,'0')).join('');
              const walletSigner = async (sighashHex: string) => {
                const digest = Uint8Array.from(sighashHex.match(/.{1,2}/g)!.map((b)=>parseInt(b,16)));
                const sig = await secp.sign(digest, priv);
                const raw = (sig as any).toCompactRawBytes ? (sig as any).toCompactRawBytes() : (sig as Uint8Array);
                return Array.from(raw).map(b=>b.toString(16).padStart(2,'0')).join('');
              };
              if (pendingArgs.contentType === 'split') {
                const convex = getConvexClient(); if (!convex) throw new Error('Service not available. Please try again in a moment.');
                const step1 = await convex.action(api.inscriptionsActions.buildUnsignedSplitAction, {
                  address: wallet.address,
                  pubKeyHex,
                  splitCount,
                  targetAmount,
                  fee: splitFee,
                } as any);
                const splitSignatureRawHex = await walletSigner(step1.splitSigHashHex);
                const res = await convex.action(api.inscriptionsActions.broadcastSignedSplitAction, {
                  contextId: step1.contextId,
                  splitSignatureRawHex,
                });
                setSplitTxid(res.txid);
              } else {
                const { revealTxid, inscriptionId } = await safeMintInscription(
                  { address: wallet.address, pubKeyHex, ...pendingArgs },
                  walletSigner
                );
                setResult({ txid: revealTxid, inscriptionId });
                if (pendingArgs.type === 'name') setNameInput('');
                if (pendingArgs.type === 'text' || pendingArgs.type === 'json') setTextContent('');
                if (pendingArgs.type?.startsWith('zrc20')) { setTick(''); setAmount(''); setMaxSupply(''); setMintLimit(''); }
              }
            } catch (e:any) {
              logError(e, 'Confirm Transaction');
              setError(sanitizeError(e));
            } finally { setLoading(false); }
          }}
        />
      )}
    </main>
  );
}
