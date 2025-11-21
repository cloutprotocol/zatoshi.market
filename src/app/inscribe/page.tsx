'use client';

import React, { Suspense } from 'react';

import { useState, useEffect, useRef } from 'react';
import { useWallet } from '@/contexts/WalletContext';
import { useSearchParams } from 'next/navigation';
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
  calculateImageInscriptionFees,
  MAX_IMAGE_SIZE_BYTES,
  MAX_IMAGE_SIZE_KB,
  LARGE_FILE_WARNING_KB,
  formatZEC,
  formatUSD,
  isValidZcashName,
  zatoshisToZEC,
  FEE_FLOOR_ZATS,
} from '@/config/fees';
import { FeeBreakdown } from '@/components/FeeBreakdown';
import { ConfirmTransaction } from '@/components/ConfirmTransaction';
import { InscriptionHistory } from '@/components/InscriptionHistory';
import { zcashRPC } from '@/services/zcash';

// Constants for fee and dust limit, mirroring backend
const DUST_LIMIT = 546;

function InscribePageContent() {

  // Ensure noble-secp has HMAC in browser (for deterministic signing)
  if (!(secp as any).etc.hmacSha256Sync) {
    (secp as any).etc.hmacSha256Sync = (key: Uint8Array, ...msgs: Uint8Array[]) =>
      hmac(sha256, key, (secp as any).etc.concatBytes(...msgs));
  }
  const { wallet, isConnected } = useWallet();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<'names' | 'text' | 'images' | 'zrc20' | 'utxo' | 'history'>('names');

  // Name registration form
  const [nameInput, setNameInput] = useState('');
  const [nameExtension, setNameExtension] = useState<'zec' | 'zcash'>('zec');
  const [nameError, setNameError] = useState<string | null>(null);

  // Text inscription form
  const [textContent, setTextContent] = useState('');
  const [contentType, setContentType] = useState('text/plain');
  const [jsonValid, setJsonValid] = useState<boolean | null>(null);

  // Image inscription form
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  // ZRC-20 form
  const [zrcOp, setZrcOp] = useState<'deploy' | 'mint' | 'transfer'>('mint');
  const [tick, setTick] = useState('');
  const [amount, setAmount] = useState('');
  const [maxSupply, setMaxSupply] = useState('');
  const [mintLimit, setMintLimit] = useState('');

  // Status
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ commitTxid: string, revealTxid: string; inscriptionId: string } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingArgs, setPendingArgs] = useState<{
    content?: string;
    contentJson?: string;
    contentType: string;
    type?: string;
    inscriptionAmount: number;
    fee: number;
    batchCount?: number;
  } | null>(null);
  const [confirmTitle, setConfirmTitle] = useState<string>('Confirm Transaction');
  const [error, setError] = useState<string | null>(null);

  const fullName = `${nameInput}.${nameExtension}`;

  // Handle URL params to prefill ZRC20 form
  useEffect(() => {
    const tab = searchParams.get('tab');
    const op = searchParams.get('op');
    const tickParam = searchParams.get('tick');
    const amountParam = searchParams.get('amount');

    if (tab === 'zrc20') {
      setActiveTab('zrc20');
      if (op === 'mint' || op === 'deploy' || op === 'transfer') {
        setZrcOp(op);
      }
      if (tickParam) {
        setTick(tickParam.toUpperCase());
      }
      if (amountParam) {
        setAmount(amountParam);
      }
    }
  }, [searchParams]);

  // Clear success message and errors when switching tabs
  useEffect(() => {
    setResult(null);
    setError(null);
  }, [activeTab]);

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
      const nameFees = calculateTotalCost(PLATFORM_FEES.NAME_REGISTRATION, new TextEncoder().encode(fullName).length, { feePerTx: selectedFeeTier.perTx });
      setConfirmTitle('Confirm Name Registration');
      setPendingArgs({
        content: fullName,
        contentType: 'text/plain',
        type: 'name',
        inscriptionAmount: nameFees.inscriptionOutput,
        fee: nameFees.networkFee
      }); setConfirmOpen(true);
    } catch (err) {
      console.error('Name registration error:', err);
      setError(err instanceof Error ? err.message : 'Failed to register name');
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
      // Determine inscription type based on content type
      const isJson = contentType === 'application/json';
      const isHtml = contentType === 'text/html';
      const isSvg = contentType === 'image/svg+xml';

      // Validate JSON if content type is JSON
      if (isJson) {
        try {
          JSON.parse(textContent);
        } catch (e) {
          setLoading(false);
          setError('Invalid JSON format. Please check your syntax and try again.');
          return;
        }
      }

      let inscriptionType = 'text';
      let title = 'Confirm Text Inscription';

      if (isJson) {
        inscriptionType = 'json';
        title = 'Confirm JSON Inscription';
      } else if (isHtml) {
        inscriptionType = 'html';
        title = 'Confirm HTML Inscription';
      } else if (isSvg) {
        inscriptionType = 'svg';
        title = 'Confirm SVG Inscription';
      }

      // Calculate fees based on content size
      const contentBytes = new TextEncoder().encode(textContent).length;
      const fees = calculateImageInscriptionFees(contentBytes, { feePerTx: selectedFeeTier.perTx });

      setConfirmTitle(title);
      setPendingArgs({
        content: isJson ? undefined : textContent,
        contentJson: isJson ? textContent : undefined,
        contentType,
        type: inscriptionType,
        inscriptionAmount: fees.inscriptionOutput,
        fee: fees.networkFee
      });
      setConfirmOpen(true);
    } catch (err) {
      console.error('Inscription error:', err);
      setError(err instanceof Error ? err.message : 'Failed to create inscription');
    } finally {
      setLoading(false);
    }
  };

  const handleFileSelect = async (file: File) => {
    // Validate file type
    const validTypes = ['image/png', 'image/gif', 'image/svg+xml'];
    if (!validTypes.includes(file.type)) {
      setError('Please upload a PNG, GIF, or SVG file');
      return;
    }

    // Validate file size
    const fileSizeKB = file.size / 1024;
    if (file.size > MAX_IMAGE_SIZE_BYTES) {
      setError(`File size must be less than ${MAX_IMAGE_SIZE_KB}KB. Your file is ${fileSizeKB.toFixed(2)}KB. Please compress or resize your image.`);
      return;
    }

    setImageFile(file);
    setError(null);

    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      setImagePreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleImageInscription = async () => {
    if (!wallet?.privateKey || !wallet?.address) {
      setError('Please connect your wallet first');
      return;
    }

    if (!imageFile) {
      setError('Please select an image to inscribe');
      return;
    }

    setLoading(true);
    setError(null);
    setResult(null);

    try {
      // Calculate fees based on file size
      const fees = calculateImageInscriptionFees(imageFile.size, { feePerTx: selectedFeeTier.perTx });

      // Read file as base64
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const base64 = e.target?.result as string;
          // Remove data URL prefix to get just the base64 content
          const base64Data = base64.split(',')[1];

          let fileTypeDisplay: string;
          let inscriptionContentType: string;

          if (imageFile.type === 'image/svg+xml') {
            fileTypeDisplay = 'SVG';
            inscriptionContentType = 'image/svg+xml';
          } else if (imageFile.type === 'image/png') {
            fileTypeDisplay = 'PNG';
            inscriptionContentType = 'image/png';
          } else if (imageFile.type === 'image/gif') {
            fileTypeDisplay = 'GIF';
            inscriptionContentType = 'image/gif';
          } else {
            // Fallback (should not reach here due to validation)
            fileTypeDisplay = 'Image';
            inscriptionContentType = imageFile.type;
          }


          setConfirmTitle(`Confirm ${fileTypeDisplay} Inscription`);
          setPendingArgs({
            content: base64Data,
            contentType: inscriptionContentType,
            type: 'image',
            inscriptionAmount: fees.inscriptionOutput,
            fee: fees.networkFee
          });
          setConfirmOpen(true);
        } catch (err) {
          console.error('Image processing error:', err);
          setError(err instanceof Error ? err.message : 'Failed to process image');
        } finally {
          setLoading(false);
        }
      };
      reader.readAsDataURL(imageFile);
    } catch (err) {
      console.error('Image inscription error:', err);
      setError(err instanceof Error ? err.message : 'Failed to create inscription');
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
      const zrc20Fees = calculateTotalCost(PLATFORM_FEES.INSCRIPTION, new TextEncoder().encode(payload).length, { feePerTx: selectedFeeTier.perTx });

      setConfirmTitle('Confirm ZRC‑20 Action');
      setPendingArgs({
        contentJson: payload,
        contentType: 'application/json',
        type: zrcOp === 'deploy' ? 'zrc20-deploy' : zrcOp === 'transfer' ? 'zrc20-transfer' : 'zrc20-mint',
        inscriptionAmount: zrc20Fees.inscriptionOutput,
        fee: zrc20Fees.networkFee
      }); setConfirmOpen(true);
    } catch (err) {
      console.error('Mint error:', err);
      setError(err instanceof Error ? err.message : 'Failed to mint ZRC-20 token');
    } finally {
      setLoading(false);
    }
  };

  // Split UTXOs UI state
  const [splitCount, setSplitCount] = useState(2);
  const [targetAmount, setTargetAmount] = useState(70000);
  // Fixed frontend floor to align with backend policy (no env var required)
  const MIN_SPLIT_FEE = 50000;
  const [splitFee, setSplitFee] = useState(MIN_SPLIT_FEE);
  const [splitTxid, setSplitTxid] = useState<string | null>(null);
  const [splitResult, setSplitResult] = useState<{ txid: string; splitCount: number; targetAmount: number; fee: number; change: number } | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [splitBalance, setSplitBalance] = useState<{ confirmed: number; unconfirmed: number } | null>(null);
  const [utxoList, setUtxoList] = useState<any[]>([]);
  const [loadingUtxos, setLoadingUtxos] = useState(false);
  // Integrated UTXO view; no toggle needed
  const [batchCount, setBatchCount] = useState(5);
  // ZIP 317 Fee Tiers
  // ZIP 317 requires: fee = max(10,000 zats, logical_actions × 5,000 zats)
  // Typical inscription tx has 3 outputs (Inscription + Platform Fee + Change)
  // Therefore: 3 actions × 5,000 = 15,000 zats minimum
  // We use 20,000 for "Low" to provide a safe buffer above the calculated minimum
  const feeTiers = [
    { key: 'low', label: 'Low', perTx: 20000 },      // Safe minimum for most inscriptions
    { key: 'normal', label: 'Normal', perTx: 50000 }, // Faster confirmation
    { key: 'high', label: 'High', perTx: 100000 },   // Priority confirmation
  ] as const;
  const [selectedFeeTier, setSelectedFeeTier] = useState<typeof feeTiers[number]>(feeTiers[1]);
  const [batchJobId, setBatchJobId] = useState<string | null>(null);
  const [batchStatus, setBatchStatus] = useState<{ status: string; completed: number; total: number; ids: string[]; estimatedProgress?: number; error?: string | null; totalCostZats?: number | null } | null>(null);
  const [batchStartTime, setBatchStartTime] = useState<number | null>(null);
  const [batchLog, setBatchLog] = useState<string[]>([]);
  const lastBatchIdsRef = useRef<string[]>([]);
  const batchLogRef = useRef<HTMLDivElement | null>(null);
  const lastCompletedRef = useRef<number>(0);
  const [batchCost, setBatchCost] = useState<{ per: number; total: number } | null>(null);
  const [safety, setSafety] = useState<'unknown' | 'on' | 'off'>('unknown');
  const [demoOpen, setDemoOpen] = useState(false);
  const [demoContent, setDemoContent] = useState('hello from client-signing demo');
  const [demoRunning, setDemoRunning] = useState(false);
  const [demoLog, setDemoLog] = useState<string[]>([]);
  const [blockHeight, setBlockHeight] = useState<number | null>(null);
  const [zecPrice, setZecPrice] = useState<number | null>(null);

  // Manual reload for Advanced UTXO view
  const reloadUtxos = async () => {
    if (!wallet?.address) return;
    setLoadingUtxos(true);
    try {
      const [utxos, inscriptions] = await Promise.all([
        zcashRPC.getUTXOs(wallet.address, true),
        zcashRPC.getInscriptions(wallet.address, true)
      ]);
      const inscribedLocations = new Set(inscriptions.inscribedLocations || []);
      const utxosWithInscriptionFlag = utxos.map(utxo => {
        let zats = (utxo as any).satoshis ?? (utxo as any).value ?? (typeof (utxo as any).amount === 'number' ? Math.round((utxo as any).amount * 1e8) : 0);
        if (!Number.isFinite(zats) || zats < 0) zats = 0;
        return {
          ...utxo,
          value: zats,
          inscribed: inscribedLocations.has(`${utxo.txid}:${utxo.vout}`),
          confirmations: utxo.confirmations ?? 1,
        };
      });
      setUtxoList(utxosWithInscriptionFlag);
    } catch {
      setUtxoList([]);
    } finally {
      setLoadingUtxos(false);
    }
  };

  // Ping indexer to display safety status (mark ON on any reachable response)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetch('https://indexer.zerdinals.com/location/0:0', { signal: AbortSignal.timeout(5000) });
        if (!cancelled) setSafety(r.ok || r.status === 404 ? 'on' : 'off');
      } catch (e) {
        if (!cancelled) setSafety('off');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Clear split TXID when leaving UTXO tab
  useEffect(() => {
    if (activeTab !== 'utxo') { if (splitTxid) setSplitTxid(null); if (splitResult) setSplitResult(null); }
  }, [activeTab]);

  // Fetch wallet balance on UTXO tab
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (activeTab === 'utxo' && wallet?.address) {
        try {
          const bal = await zcashRPC.getBalance(wallet.address, true);
          if (!cancelled) setSplitBalance(bal);
        } catch {
          if (!cancelled) setSplitBalance(null);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab, wallet?.address]);

  // Fetch UTXOs only when Advanced is opened the first time
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (activeTab === 'utxo' && wallet?.address && advancedOpen && utxoList.length === 0) {
        try {
          setLoadingUtxos(true);
          const [utxos, inscriptions] = await Promise.all([
            zcashRPC.getUTXOs(wallet.address, true),
            zcashRPC.getInscriptions(wallet.address, true)
          ]);
          const inscribedLocations = new Set(inscriptions.inscribedLocations || []);
          const utxosWithInscriptionFlag = utxos.map(utxo => {
            let zats =
              (utxo as any).satoshis ??
              (utxo as any).value ??
              (typeof (utxo as any).amount === 'number' ? Math.round((utxo as any).amount * 1e8) : 0);
            if (!Number.isFinite(zats) || zats < 0) zats = 0;
            return {
              ...utxo,
              value: zats,
              inscribed: inscribedLocations.has(`${utxo.txid}:${utxo.vout}`),
              confirmations: utxo.confirmations ?? 1,
            };
          });
          if (!cancelled) setUtxoList(utxosWithInscriptionFlag);
        } catch {
          if (!cancelled) setUtxoList([]);
        } finally {
          if (!cancelled) setLoadingUtxos(false);
        }
      }
    })();
    return () => { cancelled = true; };
  }, [activeTab, wallet?.address, advancedOpen]);

  // Fetch block height and ZEC price
  useEffect(() => {
    let cancelled = false;

    async function fetchData() {
      // Fetch block height
      try {
        const blockResponse = await fetch('https://api.blockchair.com/zcash/stats');
        const blockData = await blockResponse.json();
        if (!cancelled) setBlockHeight(blockData.data.best_block_height);
      } catch (error) {
        console.error('Failed to fetch block height:', error);
      }

      // Fetch ZEC price
      try {
        const priceResponse = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=zcash&vs_currencies=usd');
        const priceData = await priceResponse.json();
        if (!cancelled && priceData.zcash?.usd) setZecPrice(priceData.zcash.usd);
      } catch (error) {
        console.error('Failed to fetch ZEC price:', error);
      }
    }

    fetchData();
    const interval = setInterval(fetchData, 30000); // Update every 30 seconds

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const handleSplit = async () => {
    if (!wallet?.privateKey || !wallet?.address) { setError('Please connect your wallet first'); return; }
    setConfirmTitle('Confirm UTXO Split');
    setPendingArgs({ contentType: 'split', inscriptionAmount: 0, fee: Math.max(splitFee, MIN_SPLIT_FEE) });
    setConfirmOpen(true);
  };

  const handleUnlockAddress = async () => {
    if (!wallet?.address) { setError('Please connect your wallet first'); return; }
    const confirmed = confirm(
      'Force unlock all UTXOs for your address?\n\n' +
      'This will clear any stuck locks from failed transactions.\n' +
      'Only use this if you have pending operations that won\'t complete.\n\n' +
      'Continue?'
    );
    if (!confirmed) return;

    setLoading(true);
    try {
      const convex = getConvexClient();
      if (!convex) throw new Error('Convex client not available');

      const result = await convex.action(api.inscriptionsActions.adminUnlockAddressAction, {
        address: wallet.address,
      } as any);

      alert(`✓ Unlocked ${result.unlockedCount} UTXO(s) for your address.\n\nYou can now retry your transaction.`);
    } catch (e: any) {
      setError(e?.message || String(e));
    } finally {
      setLoading(false);
    }
  };

  const runClientSigningDemo = async () => {
    if (!wallet?.privateKey || !wallet?.address) { setError('Please connect your wallet first'); return; }
    setDemoRunning(true); setDemoLog([]);
    try {
      // Build signer using local WIF
      const wifPayload = (await import('bs58check')).default.decode(wallet.privateKey) as Uint8Array;
      const priv = wifPayload.slice(1, wifPayload.length === 34 ? 33 : undefined);
      const pubKeyHex = Array.from((await import('@noble/secp256k1')).getPublicKey(priv, true)).map(b => b.toString(16).padStart(2, '0')).join('');
      const signer = async (sighashHex: string) => {
        const secp = await import('@noble/secp256k1');
        const digest = Uint8Array.from(sighashHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
        const sig = await secp.sign(digest, priv);
        const raw = (sig as any).toCompactRawBytes ? (sig as any).toCompactRawBytes() : (sig as Uint8Array);
        return Array.from(raw).map(b => b.toString(16).padStart(2, '0')).join('');
      };
      const convex = getConvexClient(); if (!convex) throw new Error('Convex client not available');
      // Step 1
      const demoFees = calculateTotalCost(PLATFORM_FEES.INSCRIPTION, new TextEncoder().encode(demoContent).length);
      const step1 = await convex.action(api.inscriptionsActions.buildUnsignedCommitAction, {
        address: wallet.address,
        pubKeyHex,
        content: demoContent,
        contentType: 'text/plain',
        type: 'demo',
        inscriptionAmount: demoFees.inscriptionOutput,
        fee: demoFees.networkFee,
      } as any); setDemoLog(l => [...l, `commitSigHashHexes: ${step1.commitSigHashHexes.length} to sign...`]);
      // Step 2
      const commitSignaturesRawHex = await Promise.all(
        step1.commitSigHashHexes.map((hex: string) => signer(hex))
      );
      const step2 = await convex.action(api.inscriptionsActions.finalizeCommitAndGetRevealPreimageAction, {
        contextId: step1.contextId,
        commitSignaturesRawHex,
      });
      setDemoLog(l => [...l, `commitTxid: ${step2.commitTxid}`, `revealSigHashHex: ${step2.revealSigHashHex.slice(0, 16)}...`]);
      // Step 3
      const revealSignatureRawHex = await signer(step2.revealSigHashHex);
      const step3 = await convex.action(api.inscriptionsActions.broadcastSignedRevealAction, {
        contextId: step1.contextId,
        revealSignatureRawHex,
      });
      setDemoLog(l => [...l, `revealTxid: ${step3.revealTxid}`, `inscriptionId: ${step3.inscriptionId}`]);
    } catch (e: any) {
      setDemoLog(l => [...l, `Error: ${e?.message || String(e)}`]);
    } finally { setDemoRunning(false); }
  };

  // Utility to clean Convex error messages
  const cleanErrorMessage = (errorMsg: string): string => {
    let cleaned = errorMsg
      .replace(/\[CONVEX.*?\]/g, '')
      .replace(/\[Request ID:.*?\]/g, '')
      .replace(/Server Error/gi, '')
      .replace(/Uncaught Error:/gi, '')
      .replace(/at handler \(.*?\)/g, '')
      .replace(/at async.*$/gm, '')
      .replace(/Called by client/gi, '')
      .replace(/\.\.\/convex\/.*?\.ts:\d+:\d+/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // Make specific errors more user-friendly
    if (cleaned.includes('Not enough spendable funds')) {
      const match = cleaned.match(/Need at least (\d+) zats/);
      if (match) {
        const needed = parseInt(match[1]);
        const neededZEC = (needed / 100000000).toFixed(8);
        return `Insufficient funds: You need at least ${needed.toLocaleString()} zats (${neededZEC} ZEC) to complete this batch. Please add more ZEC to your wallet or reduce the batch count.`;
      }
    }

    return cleaned || 'An error occurred';
  };

  const executeBatchMint = async () => {
    if (!wallet?.privateKey || !wallet?.address) return;
    // tick and amount are already validated by handleBatchMint before opening modal

    setLoading(true);
    setError(null);
    setBatchStatus(null);
    setBatchJobId(null);
    setBatchLog([`Starting batch of ${batchCount} inscriptions...`]);
    lastBatchIdsRef.current = [];
    setBatchCost(null);

    const convex = getConvexClient();
    if (!convex) {
      setLoading(false);
      setError('Convex client not available');
      return;
    }
    let currentJobId: string | null = null;

    try {
      const payload = JSON.stringify({ p: 'zrc-20', op: 'mint', tick: tick.toUpperCase(), amt: amount });
      const perTxFee = selectedFeeTier.perTx;
      const batchFees = calculateTotalCost(PLATFORM_FEES.INSCRIPTION, new TextEncoder().encode(payload).length, { feePerTx: perTxFee });
      setBatchCost({ per: batchFees.total, total: batchFees.total * batchCount });

      // Pre-check: Verify user has enough funds for the batch
      const perInscriptionCost = batchFees.total;
      const totalRequired = perInscriptionCost * batchCount;
      const totalRequiredZEC = (totalRequired / 100000000).toFixed(8);

      console.log(`Batch requires ${totalRequired.toLocaleString()} zats (${totalRequiredZEC} ZEC) for ${batchCount} inscriptions`);

      // Check wallet balance before starting
      try {
        const balance = await zcashRPC.getBalance(wallet.address, true);
        // API returns ZEC; convert to zats for calculations
        const availableFunds = Math.round((balance.confirmed || 0) * 100_000_000);
        const availableZEC = (availableFunds / 100000000).toFixed(8);

        if (availableFunds < totalRequired) {
          const shortfall = totalRequired - availableFunds;
          const shortfallZEC = (shortfall / 100000000).toFixed(8);
          throw new Error(
            `Insufficient funds: You need ${totalRequired.toLocaleString()} zats (${totalRequiredZEC} ZEC) for this batch, ` +
            `but only have ${availableFunds.toLocaleString()} zats (${availableZEC} ZEC) available. ` +
            `You're short by ${shortfall.toLocaleString()} zats (${shortfallZEC} ZEC). ` +
            `Please add more ZEC to your wallet or reduce the batch count to ${Math.floor(availableFunds / perInscriptionCost)} or fewer.`
          );
        }
        console.log(`✓ Balance check passed: ${availableFunds.toLocaleString()} zats available`);
      } catch (balanceError: any) {
        // If balance check fails (network issue), still allow the operation but log warning
        if (balanceError.message.includes('Insufficient funds')) {
          throw balanceError; // Re-throw our custom insufficient funds error
        }
        console.warn('Could not verify balance, proceeding anyway:', balanceError);
      }

      const res = await convex.action(api.inscriptionsActions.batchMintAction, {
        wif: wallet.privateKey,
        address: wallet.address,
        count: batchCount,
        contentJson: payload,
        contentType: 'application/json',
        inscriptionAmount: batchFees.inscriptionOutput,
        fee: batchFees.networkFee,
        waitMs: 10000,
        feeTier: selectedFeeTier.key,
      });
      currentJobId = res.jobId;
      setBatchJobId(res.jobId);
      const startTime = Date.now();
      setBatchStartTime(startTime);
      setBatchStatus({ status: 'running', completed: 0, total: batchCount, ids: [], estimatedProgress: 0 });

      // Estimate: ~12 seconds per inscription
      const estimatedSecondsPerInscription = 12;

      // Update estimated progress every 500ms
      const estimateInterval = setInterval(() => {
        const elapsed = (Date.now() - startTime) / 1000;
        const estimatedCompleted = Math.min(batchCount, elapsed / estimatedSecondsPerInscription);
        const estimatedProgress = (estimatedCompleted / batchCount) * 100;

        setBatchStatus(prev => {
          if (!prev || prev.status !== 'running') return prev;
          // Only use estimated progress if we haven't completed any yet
          if (prev.completed === 0) {
            return { ...prev, estimatedProgress: Math.min(estimatedProgress, 95) }; // Cap at 95% until real data
          }
          return prev;
        });
      }, 500);

      // Poll immediately once, then start interval
      const pollJob = async () => {
        try {
          const job = await convex.query(api.jobs.getJob, { jobId: res.jobId });
          if (job) {
            const friendlyError = job.error ? cleanErrorMessage(job.error) : null;
            const ids = job.inscriptionIds || [];
            setBatchStatus({ status: job.status, completed: job.completedCount, total: job.totalCount, ids, error: friendlyError, totalCostZats: job.totalCostZats });

            // Append log lines for any new inscriptions detected
            setBatchLog(prev => {
              const prevIds = lastBatchIdsRef.current;
              const newOnes = ids.filter(id => !prevIds.includes(id));
              lastBatchIdsRef.current = ids;
              if (newOnes.length === 0) return prev;
              const lines = newOnes.map((id, idx) => `Minted inscription #${job.completedCount - newOnes.length + idx + 1}: ${id}`);
              return [...prev, ...lines];
            });

            if (job.status === 'completed' || job.status === 'failed') {
              clearInterval(estimateInterval);
              if (job.status === 'completed') {
                triggerFireworks(job.totalCount);
                setBatchLog(prev => [...prev, `Batch finished: ${job.totalCount} inscriptions minted.`]);
              } else {
                setBatchLog(prev => [...prev, `Batch stopped after ${job.completedCount} of ${job.totalCount}. You can retry to continue.`]);
              }
              return true; // Done
            }
          }
        } catch (e) {
          console.error('Job poll error', e);
        }
        return false; // Continue polling
      };

      // Poll immediately
      const done = await pollJob();
      if (!done) {
        // Start polling every 1.5 seconds for more responsive updates
        const interval = setInterval(async () => {
          const isDone = await pollJob();
          if (isDone) {
            clearInterval(interval);
            clearInterval(estimateInterval);
          }
        }, 1500);
      }
    } catch (err) {
      console.error('Batch mint error:', err);
      const errorMsg = err instanceof Error ? err.message : String(err);
      setError(cleanErrorMessage(errorMsg));
      // On failure, try to surface partial progress so users see what already minted
      if (currentJobId) {
        try {
          const job = await convex.query(api.jobs.getJob, { jobId: currentJobId as any });
          if (job) {
            const ids = job.inscriptionIds || [];
            const friendlyError = job.error ? cleanErrorMessage(job.error) : null;
            setBatchStatus({
              status: job.status,
              completed: job.completedCount,
              total: job.totalCount,
              ids,
              error: friendlyError,
              totalCostZats: job.totalCostZats,
            });
            setBatchLog(prev => {
              const prevIds = lastBatchIdsRef.current;
              const newOnes = ids.filter(id => !prevIds.includes(id));
              lastBatchIdsRef.current = ids;
              let lines = prev;
              if (newOnes.length) {
                lines = [...lines, ...newOnes.map((id, idx) => `Minted inscription #${job.completedCount - newOnes.length + idx + 1}: ${id}`)];
              }
              return [...lines, `Batch stopped after ${job.completedCount} of ${job.totalCount}. You can retry to continue.`];
            });
          }
        } catch (pollErr) {
          console.warn('Job fetch after error failed:', pollErr);
        }
      }
    } finally { setLoading(false); }
  };

  const handleBatchMint = async () => {
    if (!wallet?.privateKey || !wallet?.address) { setError('Please connect your wallet first'); return; }
    if (!tick.trim() || !amount.trim()) { setError('Please enter ticker and amount'); return; }

    const payload = JSON.stringify({ p: 'zrc-20', op: 'mint', tick: tick.toUpperCase(), amt: amount });
    // Initial calculation with currently selected tier
    const perTxFee = selectedFeeTier.perTx;
    const batchFees = calculateTotalCost(PLATFORM_FEES.INSCRIPTION, new TextEncoder().encode(payload).length, { feePerTx: perTxFee });

    setConfirmTitle('Confirm Batch Mint');
    setPendingArgs({
      contentJson: payload,
      contentType: 'application/json',
      type: 'batch-mint',
      inscriptionAmount: batchFees.inscriptionOutput,
      fee: batchFees.networkFee,
      batchCount: batchCount
    });
    setConfirmOpen(true);
  };

  // Auto-scroll live updates to the latest entry
  useEffect(() => {
    if (batchLogRef.current) {
      batchLogRef.current.scrollTop = batchLogRef.current.scrollHeight;
    }
  }, [batchLog, batchStatus?.status]);

  // Background polling if a job is active (keeps UI alive across refreshes)
  useEffect(() => {
    if (!batchJobId) return;
    const convex = getConvexClient();
    if (!convex) return;
    let cancelled = false;
    let intervalId: NodeJS.Timeout | null = null;

    const poll = async () => {
      try {
        const job = await convex.query(api.jobs.getJob, { jobId: batchJobId as any });
        if (!job || cancelled) return;
        const friendlyError = job.error ? cleanErrorMessage(job.error) : null;
        const ids = job.inscriptionIds || [];
        setBatchStatus({
          status: job.status,
          completed: job.completedCount,
          total: job.totalCount,
          ids,
          error: friendlyError,
          totalCostZats: job.totalCostZats,
        });
        setBatchLog(prev => {
          const prevIds = lastBatchIdsRef.current;
          const newOnes = ids.filter(id => !prevIds.includes(id));
          lastBatchIdsRef.current = ids;
          if (newOnes.length === 0) return prev;
          const lines = newOnes.map((id, idx) => `Minted inscription #${job.completedCount - newOnes.length + idx + 1}: ${id}`);
          return [...prev, ...lines];
        });

        // Stop polling if job reached terminal state
        if (job.status === 'completed' || job.status === 'failed' || job.status === 'cancelled') {
          if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
          }
        }
      } catch (e) {
        if (!cancelled) console.warn('Job poll (effect) error', e);
      }
    };

    poll();
    intervalId = setInterval(poll, 1500);
    return () => { cancelled = true; if (intervalId) clearInterval(intervalId); };
  }, [batchJobId]);

  const triggerFireworks = (count: number) => {
    console.log('🎆 Triggering fireworks! Count:', count);

    const canvas = document.createElement('canvas');
    canvas.style.position = 'fixed';
    canvas.style.top = '0';
    canvas.style.left = '0';
    canvas.style.width = '100vw';
    canvas.style.height = '100vh';
    canvas.style.pointerEvents = 'none';
    canvas.style.zIndex = '50';
    canvas.style.background = 'transparent';
    document.body.appendChild(canvas);

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      console.error('Failed to get canvas context');
      return;
    }

    const particles: Array<{ x: number; y: number; vx: number; vy: number; life: number }> = [];
    const burstCount = Math.min(count * 2, 10); // 2 bursts per batch, max 10
    let burstsCreated = 0;

    for (let i = 0; i < burstCount; i++) {
      setTimeout(() => {
        const x = Math.random() * canvas.width;
        const y = Math.random() * canvas.height * 0.6 + canvas.height * 0.1;

        // Create 50 tiny particles per burst
        for (let j = 0; j < 50; j++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = Math.random() * 5 + 2;
          particles.push({
            x, y,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - 2,
            life: 1
          });
        }
        burstsCreated++;
      }, i * 250);
    }

    const animate = () => {
      // Clear with fade
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.2; // gravity
        p.life -= 0.012;

        if (p.life <= 0) {
          particles.splice(i, 1);
          continue;
        }

        // Draw 1px yellow pixel
        ctx.fillStyle = `rgba(255, 215, 0, ${p.life})`;
        ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
      }

      if (particles.length > 0 || burstsCreated < burstCount) {
        requestAnimationFrame(animate);
      } else {
        console.log('Fireworks complete!');
        document.body.removeChild(canvas);
      }
    };

    animate();
  };

  const nameCost = calculateTotalCost(PLATFORM_FEES.NAME_REGISTRATION, 0);
  const textCost = calculateTotalCost(PLATFORM_FEES.INSCRIPTION, 0); // Baseline for text
  const zrc20Cost = calculateTotalCost(PLATFORM_FEES.INSCRIPTION, 0); // Baseline for zrc20

  return (
    <main className="min-h-screen h-screen bg-black text-gold-300 lg:pt-20 pb-4 overflow-hidden">
      <style dangerouslySetInnerHTML={{
        __html: `
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(-10px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}} />
      {/* Mobile Tab Bar - Integrated with header */}
      <div className="fixed top-16 left-0 right-0 z-40 lg:hidden bg-black/95 backdrop-blur-xl border-b border-gold-500/20">
        <div className="flex gap-1 px-2 py-2 overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
          <button
            onClick={() => setActiveTab('names')}
            className={`flex-1 min-w-0 px-3 py-2 font-bold transition-colors ${activeTab === 'names'
              ? 'bg-gold-500 text-black'
              : 'bg-black/40 border border-gold-500/30 text-gold-400'
              }`}
          >
            <div className="text-xs whitespace-nowrap">Names</div>
          </button>

          <button
            onClick={() => setActiveTab('text')}
            className={`flex-1 min-w-0 px-3 py-2 font-bold transition-colors ${activeTab === 'text'
              ? 'bg-gold-500 text-black'
              : 'bg-black/40 border border-gold-500/30 text-gold-400'
              }`}
          >
            <div className="text-xs whitespace-nowrap">Text</div>
          </button>

          <button
            onClick={() => setActiveTab('images')}
            className={`flex-1 min-w-0 px-3 py-2 font-bold transition-colors ${activeTab === 'images'
              ? 'bg-gold-500 text-black'
              : 'bg-black/40 border border-gold-500/30 text-gold-400'
              }`}
          >
            <div className="text-xs whitespace-nowrap">Images</div>
          </button>

          <button
            onClick={() => setActiveTab('zrc20')}
            className={`flex-1 min-w-0 px-3 py-2 font-bold transition-colors ${activeTab === 'zrc20'
              ? 'bg-gold-500 text-black'
              : 'bg-black/40 border border-gold-500/30 text-gold-400'
              }`}
          >
            <div className="text-xs whitespace-nowrap">ZRC-20</div>
          </button>

          <button
            onClick={() => setActiveTab('utxo')}
            className={`flex-1 min-w-0 px-3 py-2 font-bold transition-colors ${activeTab === 'utxo'
              ? 'bg-gold-500 text-black'
              : 'bg-black/40 border border-gold-500/30 text-gold-400'
              }`}
          >
            <div className="text-xs whitespace-nowrap">UTXO</div>
          </button>

          <button
            onClick={() => setActiveTab('history')}
            className={`flex-1 min-w-0 px-3 py-2 font-bold transition-colors ${activeTab === 'history'
              ? 'bg-gold-500 text-black'
              : 'bg-black/40 border border-gold-500/30 text-gold-400'
              }`}
          >
            <div className="text-xs whitespace-nowrap">History</div>
          </button>
        </div>
      </div>

      <div className="mx-auto h-full flex flex-col lg:pr-[400px] pl-6 pt-32 lg:pt-0">
        <div className="flex flex-col lg:flex-row gap-4 lg:gap-6 h-full min-h-0">
          {/* Left Sidebar - Tabs (Desktop only) */}
          <div className="hidden lg:flex lg:w-56 flex-shrink-0 flex-col lg:overflow-y-auto lg:pl-0">
            <div className="flex flex-col gap-2">
              <button
                onClick={() => setActiveTab('names')}
                className={`w-full text-left px-5 py-2.5 rounded font-bold transition-all ${activeTab === 'names'
                  ? 'bg-gold-500 text-black'
                  : 'bg-black/40 border border-gold-500/30 text-gold-400 hover:border-gold-500/50'
                  }`}
              >
                <div className="text-base">Names</div>
                <div className="text-xs opacity-75">.zec • .zcash</div>
              </button>

              <button
                onClick={() => setActiveTab('text')}
                className={`w-full text-left px-5 py-2.5 rounded font-bold transition-all ${activeTab === 'text'
                  ? 'bg-gold-500 text-black'
                  : 'bg-black/40 border border-gold-500/30 text-gold-400 hover:border-gold-500/50'
                  }`}
              >
                <div className="text-base">Text</div>
                <div className="text-xs opacity-75">Inscriptions</div>
              </button>

              <button
                onClick={() => setActiveTab('images')}
                className={`w-full text-left px-5 py-2.5 rounded font-bold transition-all ${activeTab === 'images'
                  ? 'bg-gold-500 text-black'
                  : 'bg-black/40 border border-gold-500/30 text-gold-400 hover:border-gold-500/50'
                  }`}
              >
                <div className="text-base">Images</div>
                <div className="text-xs opacity-75">PNG • SVG</div>
              </button>

              <button
                onClick={() => setActiveTab('zrc20')}
                className={`w-full text-left px-5 py-2.5 rounded font-bold transition-all ${activeTab === 'zrc20'
                  ? 'bg-gold-500 text-black'
                  : 'bg-black/40 border border-gold-500/30 text-gold-400 hover:border-gold-500/50'
                  }`}
              >
                <div className="text-base">ZRC-20</div>
                <div className="text-xs opacity-75">Token Mint</div>
              </button>

              <button
                onClick={() => setActiveTab('utxo')}
                className={`w-full text-left px-5 py-2.5 rounded font-bold transition-all ${activeTab === 'utxo'
                  ? 'bg-gold-500 text-black'
                  : 'bg-black/40 border border-gold-500/30 text-gold-400 hover:border-gold-500/50'
                  }`}
              >
                <div className="text-base">UTXO</div>
                <div className="text-xs opacity-75">UTXO Management</div>
              </button>

              <button
                onClick={() => setActiveTab('history')}
                className={`w-full text-left px-5 py-2.5 rounded font-bold transition-all ${activeTab === 'history'
                  ? 'bg-gold-500 text-black'
                  : 'bg-black/40 border border-gold-500/30 text-gold-400 hover:border-gold-500/50'
                  }`}
              >
                <div className="text-base">History</div>
                <div className="text-xs opacity-75">Inscription History</div>
              </button>
            </div>

            {/* Info Panel - Hidden on mobile */}
            <div className="hidden lg:block mt-8 bg-black/60 border border-gold-500/10 rounded shadow-inner">
              <div className="text-xs text-gold-400/50 px-3 py-2 border-b border-gold-500/10">
                Platform Info
              </div>

              {/* Platform Fee */}
              <div className="px-3 py-2 border-b border-gold-500/5">
                <div className="text-xs text-gold-400/60 mb-0.5">Platform Fee</div>
                <div className="text-xs font-mono text-gold-300">{formatZEC(PLATFORM_FEES.INSCRIPTION)}</div>
              </div>

              {/* ZCash Block */}
              <div className="px-3 py-2 border-b border-gold-500/5">
                <div className="text-xs text-gold-400/60 mb-0.5">ZCash Block</div>
                <div className="text-xs font-mono text-gold-300">
                  {blockHeight !== null ? blockHeight.toLocaleString() : '...'}
                </div>
              </div>

              {/* Current Price */}
              <div className="px-3 py-2 border-b border-gold-500/5">
                <div className="text-xs text-gold-400/60 mb-0.5">ZEC Price</div>
                <div className="text-xs font-mono text-gold-300">
                  {zecPrice !== null ? `$${zecPrice.toFixed(2)}` : '...'}
                </div>
              </div>

              {/* Safety Status */}
              <div className="px-3 py-2 relative group">
                <div className="text-xs text-gold-400/60 mb-0.5">Safety</div>
                <div className="text-xs font-mono">
                  {safety === 'on' ? (
                    <span className="text-green-400">ON</span>
                  ) : safety === 'off' ? (
                    <span className="text-red-400">OFF</span>
                  ) : (
                    <span className="text-gold-400/60">...</span>
                  )}
                </div>
                {/* Hover tooltip */}
                <div className="absolute left-full ml-2 top-0 w-48 px-3 py-2 bg-black/90 border border-gold-500/30 rounded text-xs text-gold-300 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-none z-50">
                  UTXO protection prevents accidental inscription burning by tracking on-chain states
                </div>
              </div>
            </div>
          </div>

          {/* Main Content Area */}
          <div className="flex-1 bg-black/40 border border-none rounded backdrop-blur-xl overflow-y-auto min-h-0 lg:min-w-[750px]">
            <div className="p-4 sm:p-6 lg:p-8 pt-6 lg:pt-8">

              {/* NAME REGISTRATION TAB */}
              {activeTab === 'names' && (
                <div className="max-w-2xl mx-auto">
                  <div className="text-center mb-6 sm:mb-7">
                    <h2 className="text-lg sm:text-xl lg:text-2xl font-bold mb-2 bg-gradient-to-br from-white via-gold-100 to-gold-200 bg-clip-text text-transparent">Register Your Zcash Name</h2>
                    <p className="text-gold-400/60 text-xs sm:text-sm">
                      Secure your .zec or .zcash identity on the blockchain
                    </p>
                  </div>

                  {/* Name Search Box */}
                  <div className="mb-4 sm:mb-6">
                    <div className="relative">
                      <div className="flex flex-col sm:flex-row gap-0 bg-black/60 border-2 border-gold-500/50 rounded overflow-hidden focus-within:border-gold-500 transition-all">
                        <input
                          type="text"
                          value={nameInput}
                          onChange={(e) => {
                            const value = e.target.value; // No character filtering or lowercasing
                            setNameInput(value);
                            validateName(value);
                          }}
                          className="flex-1 bg-transparent px-4 py-2.5 sm:px-6 sm:py-3 text-lg sm:text-xl font-mono text-gold-300 placeholder-gold-500/40 outline-none"
                          placeholder="yourname"
                          disabled={loading}
                        />
                        <div className="relative">
                          <select
                            value={nameExtension}
                            onChange={(e) => {
                              setNameExtension(e.target.value as 'zec' | 'zcash');
                              validateName(nameInput);
                            }}
                            className="appearance-none bg-black/60 border-t sm:border-t-0 sm:border-l border-gold-500/30 pl-4 pr-10 py-2.5 sm:pl-6 sm:pr-12 sm:py-3 text-lg sm:text-xl font-mono text-gold-300 outline-none cursor-pointer w-full"
                            disabled={loading}
                          >
                            <option value="zec">.zec</option>
                            <option value="zcash">.zcash</option>
                          </select>
                          <div className="absolute right-3 sm:right-4 top-1/2 -translate-y-1/2 pointer-events-none text-gold-400 text-xs">
                            \/
                          </div>
                        </div>
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
                    <div className="mb-4 sm:mb-6 p-3 sm:p-4 bg-gold-500/10 border border-gold-500/30 rounded">
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
                    className="w-full px-4 py-2.5 sm:px-5 sm:py-3 bg-gold-500 text-black font-bold text-sm sm:text-base rounded hover:bg-gold-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-sm shadow-gold-500/20"
                  >
                    {loading ? (
                      <svg className="animate-spin h-5 w-5 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    ) : `Register ${fullName}`}
                  </button>

                  {/* Success Display */}
                  {result && (
                    <div className="mt-6 p-4 sm:p-6 bg-gold-500/10 border border-gold-500/30 rounded relative">
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
                          <div className="text-gold-400/60 text-sm mb-1">Commit TXID</div>
                          <a
                            href={`https://mainnet.zcashexplorer.app/transactions/${result.commitTxid}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gold-300 hover:text-gold-400 font-mono text-xs sm:text-sm break-all bg-black/40 p-3 rounded block transition-colors underline"
                          >
                            {result.commitTxid}
                          </a>
                        </div>
                        <div>
                          <div className="text-gold-400/60 text-sm mb-1">Reveal TXID</div>
                          <a
                            href={`https://mainnet.zcashexplorer.app/transactions/${result.revealTxid}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gold-300 hover:text-gold-400 font-mono text-xs sm:text-sm break-all bg-black/40 p-3 rounded block transition-colors underline"
                          >
                            {result.revealTxid}
                          </a>
                        </div>
                        <div>
                          <div className="text-gold-400/60 text-sm mb-1">Inscription ID</div>
                          <div className="text-gold-300 font-mono text-xs sm:text-sm break-all bg-black/40 p-3 rounded">
                            {result.inscriptionId}
                          </div>
                        </div>
                        <div className="pt-3">
                          <p className="text-xs text-gold-400/70">Note: New inscriptions may take up to ~5 minutes to appear in the public explorer.</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* TEXT INSCRIPTION TAB */}
              {activeTab === 'text' && (
                <div className="max-w-2xl mx-auto space-y-3 sm:space-y-4">
                  <div className="text-center mb-4 sm:mb-6">
                    <h2 className="text-lg sm:text-xl lg:text-2xl font-bold mb-2 bg-gradient-to-br from-white via-gold-100 to-gold-200 bg-clip-text text-transparent">Text Inscription</h2>
                    <p className="text-gold-400/60 text-xs sm:text-sm">
                      Inscribe any text or data permanently on Zcash
                    </p>
                  </div>

                  <div>
                    <label className="block text-gold-200/80 text-sm mb-2">Content Type</label>
                    <div className="relative">
                      <select
                        value={contentType}
                        onChange={(e) => {
                          setContentType(e.target.value);
                          // Reset JSON validation when changing content type
                          setJsonValid(null);
                        }}
                        className="appearance-none w-full bg-black/40 border border-gold-500/30 rounded px-3 py-2 sm:px-4 sm:py-3 text-gold-300 outline-none focus:border-gold-500/50"
                        disabled={loading}
                      >
                        <option value="text/plain">Text (text/plain)</option>
                        <option value="application/json">JSON (application/json)</option>
                        <option value="text/html">HTML (text/html)</option>
                        <option value="image/svg+xml">SVG (image/svg+xml)</option>
                      </select>
                      <div className="absolute right-3 sm:right-4 top-1/2 -translate-y-1/2 pointer-events-none text-gold-400 text-xs">
                        \/
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-gold-200/80 text-xs sm:text-sm mb-2">
                      Content {textContent.length > 0 && `(${textContent.length} characters, ${new TextEncoder().encode(textContent).length} bytes)`}
                    </label>
                    <textarea
                      value={textContent}
                      onChange={(e) => {
                        const value = e.target.value;
                        setTextContent(value);
                        // Clear error when user starts typing
                        if (error) setError(null);

                        // Validate JSON in real-time
                        if (contentType === 'application/json' && value.trim()) {
                          try {
                            JSON.parse(value);
                            setJsonValid(true);
                          } catch {
                            setJsonValid(false);
                          }
                        } else {
                          setJsonValid(null);
                        }
                      }}
                      className="w-full bg-black/40 border border-gold-500/30 rounded px-3 py-2 sm:px-4 sm:py-3 text-gold-300 font-mono text-xs sm:text-sm min-h-[180px] sm:min-h-[240px] outline-none focus:border-gold-500/50 resize-none"
                      placeholder={
                        contentType === 'application/json'
                          ? '{\n  "example": "JSON content",\n  "key": "value"\n}'
                          : contentType === 'text/html'
                            ? '<!DOCTYPE html>\n<html>\n<body>\n  <h1>Your HTML here</h1>\n</body>\n</html>'
                            : contentType === 'image/svg+xml'
                              ? '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">\n  <circle cx="50" cy="50" r="40" fill="gold" />\n</svg>'
                              : 'Enter your inscription content...'
                      }
                      disabled={loading}
                    />
                    <div className="flex items-center justify-between mt-1.5">
                      <p className="text-gold-400/60 text-xs">
                        {contentType === 'application/json'
                          ? 'Enter valid JSON. Content will be validated before inscription.'
                          : contentType === 'text/html'
                            ? 'HTML content will be inscribed as-is. Ensure all tags are properly closed.'
                            : contentType === 'image/svg+xml'
                              ? 'SVG content (text mode). For file upload, use the Images tab.'
                              : 'Keep content under 80KB for optimal indexing'}
                      </p>
                      {contentType === 'application/json' && jsonValid !== null && (
                        <div className="flex items-center gap-1.5">
                          {jsonValid ? (
                            <>
                              <svg className="w-4 h-4 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                              <span className="text-xs text-green-400">Valid JSON</span>
                            </>
                          ) : (
                            <>
                              <svg className="w-4 h-4 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                              </svg>
                              <span className="text-xs text-red-400">Invalid JSON</span>
                            </>
                          )}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Fee Breakdown with dynamic calculation based on content size */}
                  {(() => {
                    const contentBytes = new TextEncoder().encode(textContent).length;
                    const fees = contentBytes > 0
                      ? calculateImageInscriptionFees(contentBytes)
                      : textCost;
                    const isLargeContent = fees.fileSizeKB && fees.fileSizeKB > LARGE_FILE_WARNING_KB;

                    return (
                      <div className="space-y-3">
                        {contentBytes > 0 && (
                          <div className="p-3 bg-black/20 border border-gold-500/20 rounded">
                            <div className="text-xs text-gold-400/80 space-y-1">
                              <div className="flex justify-between">
                                <span>Content Size:</span>
                                <span className="font-medium text-gold-300">{(contentBytes / 1024).toFixed(2)} KB</span>
                              </div>
                              <div className="flex justify-between">
                                <span>Estimated TX Size:</span>
                                <span className="font-medium text-gold-300">{((500 + contentBytes + 200) / 1024).toFixed(2)} KB</span>
                              </div>
                            </div>
                          </div>
                        )}

                        {isLargeContent && (
                          <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3">
                            <div className="flex gap-2">
                              <svg className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                              </svg>
                              <div className="text-xs text-yellow-400/90">
                                <p className="font-medium mb-1">Large Content Notice</p>
                                <p className="text-yellow-400/70">This content is {fees.fileSizeKB?.toFixed(0)}KB. Network fees increase with content size. Consider optimizing to reduce costs.</p>
                              </div>
                            </div>
                          </div>
                        )}

                        <FeeBreakdown
                          platformFee={fees.platformFee}
                          networkFee={fees.networkFee}
                          inscriptionOutput={fees.inscriptionOutput}
                          total={fees.total}
                        />
                      </div>
                    );
                  })()}

                  <button
                    onClick={handleTextInscription}
                    disabled={loading || !isConnected || !textContent.trim() || (contentType === 'application/json' && jsonValid === false)}
                    className="w-full px-4 py-2.5 sm:px-5 sm:py-3 bg-gold-500 text-black font-bold text-sm sm:text-base rounded hover:bg-gold-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {loading ? (
                      <svg className="animate-spin h-5 w-5 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    ) : 'Inscribe'}
                  </button>

                  {/* Success Display */}
                  {result && (
                    <div className="mt-6 p-4 sm:p-6 bg-gold-500/10 border border-gold-500/30 rounded relative">
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
                          <div className="text-gold-400/60 text-sm mb-1">Commit TXID</div>
                          <a
                            href={`https://mainnet.zcashexplorer.app/transactions/${result.commitTxid}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gold-300 hover:text-gold-400 font-mono text-xs sm:text-sm break-all bg-black/40 p-3 rounded block transition-colors underline"
                          >
                            {result.commitTxid}
                          </a>
                        </div>
                        <div>
                          <div className="text-gold-400/60 text-sm mb-1">Reveal TXID</div>
                          <a
                            href={`https://mainnet.zcashexplorer.app/transactions/${result.revealTxid}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gold-300 hover:text-gold-400 font-mono text-xs sm:text-sm break-all bg-black/40 p-3 rounded block transition-colors underline"
                          >
                            {result.revealTxid}
                          </a>
                        </div>
                        <div>
                          <div className="text-gold-400/60 text-sm mb-1">Inscription ID</div>
                          <div className="text-gold-300 font-mono text-xs sm:text-sm break-all bg-black/40 p-3 rounded">
                            {result.inscriptionId}
                          </div>
                        </div>
                        <div className="pt-3">
                          <p className="text-xs text-gold-400/70">Note: New inscriptions may take up to ~5 minutes to appear in the public explorer.</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* IMAGES INSCRIPTION TAB */}
              {activeTab === 'images' && (
                <div className="max-w-2xl mx-auto space-y-3 sm:space-y-4">
                  <div className="text-center mb-4 sm:mb-6">
                    <div className="flex items-center justify-center gap-3">
                      <h2 className="text-lg sm:text-xl lg:text-2xl font-bold mb-2 bg-gradient-to-br from-white via-gold-100 to-gold-200 bg-clip-text text-transparent">Image Inscription</h2>
                      <div className="relative group">
                        <span className="bg-red-500/20 border border-red-500/50 text-red-300 text-xs font-bold px-2 py-0.5 rounded-full">
                          EXPERIMENTAL
                        </span>
                        <div className="absolute left-1/2 -translate-x-1/2 bottom-full mb-2 w-48 px-3 py-2 bg-black/90 border border-gold-500/30 rounded text-xs text-gold-300 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 pointer-events-none z-50">
                          Image inscriptions are experimental. Please limit file sizes to 1KB.
                        </div>
                      </div>
                    </div>
                    <p className="text-gold-400/60 text-xs sm:text-sm">
                      Inscribe PNG, GIF, or SVG images (max 1KB)
                    </p>
                  </div>

                  <div className="bg-black/40 border border-gold-500/30 rounded-lg p-4 sm:p-6">
                    {/* Drag and Drop Area */}
                    <div
                      onDrop={handleDrop}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      className={`relative border-2 border-dashed rounded-lg p-8 text-center transition-all ${isDragging
                        ? 'border-gold-500 bg-gold-500/10'
                        : 'border-gold-500/30 hover:border-gold-500/50'
                        }`}
                    >
                      <input
                        type="file"
                        accept="image/png,image/gif,image/svg+xml"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) handleFileSelect(file);
                        }}
                        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                      />

                      {!imagePreview ? (
                        <div className="space-y-4">
                          <div className="mx-auto w-16 h-16 flex items-center justify-center bg-gold-500/10 rounded-full">
                            <svg
                              className="w-8 h-8 text-gold-400"
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                              />
                            </svg>
                          </div>
                          <div>
                            <p className="text-gold-300 font-medium mb-1">
                              Drop your image here or click to browse
                            </p>
                            <p className="text-gold-400/60 text-sm">
                              PNG, GIF, or SVG files • Max {MAX_IMAGE_SIZE_KB}KB
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <div className="relative mx-auto max-w-sm">
                            <img
                              src={imagePreview}
                              alt="Preview"
                              className="max-h-64 mx-auto rounded border border-gold-500/30"
                            />
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setImageFile(null);
                                setImagePreview(null);
                              }}
                              className="absolute top-2 right-2 bg-black/80 hover:bg-black text-gold-400 hover:text-gold-300 p-2 rounded-full transition-colors"
                            >
                              <svg
                                className="w-5 h-5"
                                fill="none"
                                stroke="currentColor"
                                viewBox="0 0 24 24"
                              >
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  strokeWidth={2}
                                  d="M6 18L18 6M6 6l12 12"
                                />
                              </svg>
                            </button>
                          </div>
                          <div className="text-sm space-y-1">
                            <p className="text-gold-300 font-medium">{imageFile?.name}</p>
                            <p className="text-gold-400/60">
                              {imageFile?.type} • {((imageFile?.size || 0) / 1024).toFixed(2)} KB
                            </p>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Fee Breakdown */}
                    {imageFile && (() => {
                      const fees = calculateImageInscriptionFees(imageFile.size);
                      const isLargeFile = fees.fileSizeKB > LARGE_FILE_WARNING_KB;
                      return (
                        <div className="mt-4 space-y-3">
                          <div className="p-3 bg-black/20 border border-gold-500/20 rounded">
                            <div className="text-xs text-gold-400/80 space-y-1">
                              <div className="flex justify-between">
                                <span>File Size:</span>
                                <span className="font-medium text-gold-300">{fees.fileSizeKB.toFixed(2)} KB</span>
                              </div>
                              <div className="flex justify-between">
                                <span>Estimated TX Size:</span>
                                <span className="font-medium text-gold-300">{((500 + imageFile.size + 200) / 1024).toFixed(2)} KB</span>
                              </div>
                            </div>
                          </div>
                          {isLargeFile && (
                            <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded">
                              <div className="flex items-start gap-2">
                                <svg className="w-5 h-5 text-yellow-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                </svg>
                                <div className="text-xs text-yellow-400/90">
                                  <p className="font-medium mb-1">Large File Notice</p>
                                  <p className="text-yellow-400/70">This file is {fees.fileSizeKB.toFixed(0)}KB. Network fees increase with file size. Consider optimizing your image to reduce costs.</p>
                                </div>
                              </div>
                            </div>
                          )}
                          <FeeBreakdown
                            platformFee={fees.platformFee}
                            networkFee={fees.networkFee}
                            inscriptionOutput={fees.inscriptionOutput}
                            total={fees.total}
                          />
                        </div>
                      );
                    })()}

                    {/* Inscribe Button */}
                    <button
                      onClick={handleImageInscription}
                      disabled={loading || !isConnected || !imageFile}
                      className="w-full mt-4 px-4 py-2.5 sm:px-5 sm:py-3 bg-gold-500 text-black font-bold text-sm sm:text-base rounded hover:bg-gold-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loading ? (
                        <svg className="animate-spin h-5 w-5 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                      ) : 'Inscribe Image'}
                    </button>
                  </div>

                  {/* Success Display */}
                  {result && (
                    <div className="mt-6 p-4 sm:p-6 bg-gold-500/10 border border-gold-500/30 rounded relative">
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
                          <div className="text-gold-400/60 text-sm mb-1">Commit TXID</div>
                          <a
                            href={`https://mainnet.zcashexplorer.app/transactions/${result.commitTxid}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gold-300 hover:text-gold-400 font-mono text-xs sm:text-sm break-all bg-black/40 p-3 rounded block transition-colors underline"
                          >
                            {result.commitTxid}
                          </a>
                        </div>
                        <div>
                          <div className="text-gold-400/60 text-sm mb-1">Reveal TXID</div>
                          <a
                            href={`https://mainnet.zcashexplorer.app/transactions/${result.revealTxid}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gold-300 hover:text-gold-400 font-mono text-xs sm:text-sm break-all bg-black/40 p-3 rounded block transition-colors underline"
                          >
                            {result.revealTxid}
                          </a>
                        </div>
                        <div>
                          <div className="text-gold-400/60 text-sm mb-1">Inscription ID</div>
                          <div className="text-gold-300 font-mono text-xs sm:text-sm break-all bg-black/40 p-3 rounded">
                            {result.inscriptionId}
                          </div>
                        </div>
                        <div className="pt-3">
                          <p className="text-xs text-gold-400/70">Note: New inscriptions may take up to ~5 minutes to appear in the public explorer.</p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ZRC-20 TAB */}
              {activeTab === 'zrc20' && (
                <div className="max-w-2xl mx-auto space-y-3 sm:space-y-4">
                  <div className="text-center mb-4 sm:mb-6">
                    <h2 className="text-lg sm:text-xl lg:text-2xl font-bold mb-2 bg-gradient-to-br from-white via-gold-100 to-gold-200 bg-clip-text text-transparent">Mint ZRC-20 Token</h2>
                    <p className="text-gold-400/60 text-xs sm:text-sm">
                      Mint tokens from deployed ZRC-20 contracts
                    </p>
                  </div>

                  <div className="bg-gold-500/10 p-3 sm:p-4 rounded border border-gold-500/30 mb-4 sm:mb-6">
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
                    <div className="relative">
                      <select
                        value={zrcOp}
                        onChange={(e) => setZrcOp(e.target.value as any)}
                        className="appearance-none w-full bg-black/40 border border-gold-500/30 rounded pl-3 pr-10 py-2 sm:pl-4 sm:pr-10 sm:py-3 text-sm sm:text-base text-gold-300 outline-none focus:border-gold-500/50"
                        disabled={loading}
                      >
                        <option value="mint">Mint</option>
                        <option value="deploy">Deploy</option>
                        <option value="transfer">Transfer</option>
                      </select>
                      <div className="absolute right-3 sm:right-4 top-1/2 -translate-y-1/2 pointer-events-none text-gold-400 text-xs">
                        \/
                      </div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-gold-200/80 text-xs sm:text-sm mb-1.5 sm:mb-2">Token Ticker</label>
                    <input
                      type="text"
                      value={tick}
                      onChange={(e) => setTick(e.target.value.toUpperCase())}
                      className="w-full bg-black/40 border border-gold-500/30 rounded px-3 py-2 sm:px-4 sm:py-3 text-sm sm:text-base text-gold-300 font-mono uppercase outline-none focus:border-gold-500/50"
                      placeholder="ZERO"
                      maxLength={4}
                      disabled={loading}
                    />
                  </div>

                  {zrcOp !== 'deploy' && (
                    <div>
                      <label className="block text-gold-200/80 text-xs sm:text-sm mb-1.5 sm:mb-2">Amount</label>
                      <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} onWheel={(e) => e.currentTarget.blur()} className="w-full bg-black/40 border border-gold-500/30 rounded px-3 py-2 sm:px-4 sm:py-3 text-sm sm:text-base text-gold-300 outline-none focus:border-gold-500/50" placeholder="1000" disabled={loading} />
                    </div>
                  )}
                  {zrcOp === 'deploy' && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-gold-200/80 text-xs sm:text-sm mb-1.5 sm:mb-2">Max Supply</label>
                        <input type="number" value={maxSupply} onChange={(e) => setMaxSupply(e.target.value)} onWheel={(e) => e.currentTarget.blur()} className="w-full bg-black/40 border border-gold-500/30 rounded px-3 py-2 sm:px-4 sm:py-3 text-sm sm:text-base text-gold-300 outline-none focus:border-gold-500/50" placeholder="21000000" disabled={loading} />
                      </div>
                      <div>
                        <label className="block text-gold-200/80 text-xs sm:text-sm mb-1.5 sm:mb-2">Mint Limit</label>
                        <input type="number" value={mintLimit} onChange={(e) => setMintLimit(e.target.value)} onWheel={(e) => e.currentTarget.blur()} className="w-full bg-black/40 border border-gold-500/30 rounded px-3 py-2 sm:px-4 sm:py-3 text-sm sm:text-base text-gold-300 outline-none focus:border-gold-500/50" placeholder="1000" disabled={loading} />
                      </div>
                    </div>
                  )}

                  <div className="bg-black/40 p-2.5 sm:p-3 rounded border border-gold-500/20">
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

                  <button onClick={handleZRC20Mint} disabled={loading || !isConnected || !tick.trim() || (zrcOp !== 'deploy' && !amount.trim()) || (zrcOp === 'deploy' && (!maxSupply.trim() || !mintLimit.trim()))} className="w-full px-4 py-2.5 sm:px-5 sm:py-3 bg-gold-500 text-black font-bold text-sm sm:text-base rounded hover:bg-gold-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed">{loading ? (
                    <svg className="animate-spin h-5 w-5 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                  ) : (zrcOp === 'deploy' ? 'Deploy Token' : zrcOp === 'transfer' ? 'Inscribe Transfer' : 'Mint ZRC-20')}</button>

                  {/* Success Display */}
                  {result && (
                    <div className="mt-6 p-4 sm:p-6 bg-gold-500/10 border border-gold-500/30 rounded relative">
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
                          <div className="text-gold-400/60 text-sm mb-1">Commit TXID</div>
                          <a
                            href={`https://mainnet.zcashexplorer.app/transactions/${result.commitTxid}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gold-300 hover:text-gold-400 font-mono text-xs sm:text-sm break-all bg-black/40 p-3 rounded block transition-colors underline"
                          >
                            {result.commitTxid}
                          </a>
                        </div>
                        <div>
                          <div className="text-gold-400/60 text-sm mb-1">Reveal TXID</div>
                          <a
                            href={`https://mainnet.zcashexplorer.app/transactions/${result.revealTxid}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-gold-300 hover:text-gold-400 font-mono text-xs sm:text-sm break-all bg-black/40 p-3 rounded block transition-colors underline"
                          >
                            {result.revealTxid}
                          </a>
                        </div>
                        <div>
                          <div className="text-gold-400/60 text-sm mb-1">Inscription ID</div>
                          <div className="text-gold-300 font-mono text-xs sm:text-sm break-all bg-black/40 p-3 rounded">
                            {result.inscriptionId}
                          </div>
                        </div>
                        <div className="pt-3">
                          <p className="text-xs text-gold-400/70">Note: New inscriptions may take up to ~5 minutes to appear in the public explorer.</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Batch Mint - Enhanced liquid glass design */}
                  <div className="mt-8 p-6 sm:p-8 rounded border-2 border-gold-500/40 bg-gradient-to-br from-gold-500/10 via-transparent to-gold-500/5 backdrop-blur-2xl shadow-xl shadow-gold-500/10 space-y-5 relative overflow-hidden isolate">
                    <div className="text-center">
                      <h3 className="text-xl sm:text-2xl font-bold text-gold-300 mb-1">Batch Mint</h3>
                    </div>

                    {/* Count Control - Centered */}
                    <div className="max-w-md mx-auto">
                      <label className="block text-gold-200/80 text-sm font-medium mb-3 text-center">Count</label>
                      <div className="flex items-center justify-center mb-4">
                        <div className="w-28 h-20 bg-black/60 rounded flex items-center justify-center">
                          <input
                            type="number"
                            min={1}
                            max={10}
                            value={batchCount}
                            onChange={e => setBatchCount(Math.max(1, Math.min(10, parseInt(e.target.value || '1'))))}
                            onWheel={(e) => e.currentTarget.blur()}
                            className="w-full h-full bg-transparent text-4xl font-bold text-gold-300 text-center outline-none tabular-nums [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                          />
                        </div>
                      </div>
                      <input
                        type="range"
                        min={1}
                        max={5}
                        value={batchCount}
                        onChange={e => setBatchCount(Math.min(5, Math.max(1, parseInt(e.target.value))))}
                        className="w-full h-3 bg-gradient-to-r from-gold-500/30 via-gold-500/50 to-gold-500/30 border border-gold-500/40 rounded-full appearance-none cursor-pointer shadow-inner [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-6 [&::-webkit-slider-thumb]:h-6 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-gradient-to-br [&::-webkit-slider-thumb]:from-gold-400 [&::-webkit-slider-thumb]:to-gold-600 [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-gold-300 [&::-webkit-slider-thumb]:shadow-lg [&::-webkit-slider-thumb]:shadow-gold-500/60 [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110 [&::-moz-range-thumb]:w-6 [&::-moz-range-thumb]:h-6 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-gradient-to-br [&::-moz-range-thumb]:from-gold-400 [&::-moz-range-thumb]:to-gold-600 [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-gold-300 [&::-moz-range-thumb]:shadow-lg [&::-moz-range-thumb]:cursor-pointer"
                      />
                    </div>

                    {/* Description */}
                    <p className="text-xs sm:text-sm text-gold-400/70 text-center max-w-lg mx-auto">
                      Batch uses the same ticker/amount as Mint. Use UTXO Tools to prepare funding.
                    </p>

                    {/* Batch Fee Summary */}
                    <div className="text-sm text-gold-400/90 bg-black/30 rounded p-4 border border-gold-500/20">
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
                      disabled={(loading && !batchJobId) || !isConnected || !tick.trim() || !amount.trim() || (batchJobId && batchStatus?.status === 'running')}
                      className="relative w-full px-6 py-4 bg-gradient-to-r from-gold-500 via-yellow-400 to-gold-500 text-black font-bold text-lg rounded transition-all duration-300 shadow-lg shadow-gold-500/30 hover:shadow-2xl hover:shadow-gold-500/60 hover:scale-[1.02] disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100 disabled:hover:shadow-lg border-2 border-gold-400/50 overflow-hidden before:absolute before:inset-0 before:bg-gradient-to-r before:from-transparent before:via-white/30 before:to-transparent before:-translate-x-full hover:before:translate-x-full before:transition-transform before:duration-700"
                    >
                      <span className="relative z-10">
                        {loading && !batchJobId ? (
                          <svg className="animate-spin h-5 w-5 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                        ) : batchJobId ? (
                          batchStatus?.status === 'completed'
                            ? 'Start Batch Mint'
                            : batchStatus?.status === 'failed'
                              ? 'Retry Batch'
                              : 'Batch Running...'
                        ) : 'Start Batch Mint'}
                      </span>
                    </button>

                    {batchJobId && (
                      <div className="mt-4 space-y-4">
                        {/* Job ID Display */}
                        <div className="bg-black/60 border border-gold-500/30 rounded-lg p-4">
                          <div className="text-xs text-gold-400/60 mb-1">Batch Job ID</div>
                          <div className="font-mono text-xs text-gold-300 break-all">{batchJobId}</div>
                        </div>

                        {/* Status Display */}
                        {batchStatus && (
                          <div className={`bg-gradient-to-br from-gold-500/20 via-black/40 to-gold-500/10 border-2 border-gold-500/40 rounded-lg p-5 space-y-4 ${batchStatus.status === 'running' ? 'animate-pulse' : ''}`}>
                            {/* Header with status */}
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-3">
                                {batchStatus.status === 'running' && (
                                  <svg className="animate-spin h-5 w-5 text-gold-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                  </svg>
                                )}
                                {batchStatus.status === 'completed' && (
                                  <svg className="h-5 w-5 text-green-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                )}
                                {batchStatus.status === 'failed' && (
                                  <svg className="h-5 w-5 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z" />
                                  </svg>
                                )}
                                <span className="text-gold-300 font-bold text-lg">
                                  {batchStatus.status === 'pending' && 'Initializing...'}
                                  {batchStatus.status === 'running' && `Minting ${tick.toUpperCase()}...`}
                                  {batchStatus.status === 'completed' && 'Batch Complete!'}
                                  {batchStatus.status === 'failed' && 'Batch Failed'}
                                </span>
                              </div>
                              <div className="text-gold-300 font-bold text-lg">
                                {batchStatus.completed}/{batchStatus.total}
                              </div>
                            </div>

                            {/* Progress bar */}
                            <div className="space-y-3">
                              <div className="relative">
                                <div className="w-full h-8 bg-black/80 border-2 border-gold-500/40 rounded-full overflow-hidden shadow-inner">
                                  <div
                                    className="h-full bg-gradient-to-r from-gold-500 via-yellow-400 to-gold-500 rounded-full transition-all duration-700 ease-out shadow-lg shadow-gold-500/50"
                                    style={{
                                      width: `${Math.min(100, batchStatus.completed > 0
                                        ? (batchStatus.completed / Math.max(1, batchStatus.total)) * 100
                                        : (batchStatus.estimatedProgress || 0)
                                      )}%`
                                    }}
                                  />
                                </div>
                                <div className="absolute inset-0 flex items-center justify-center text-sm font-bold text-white drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]">
                                  {Math.round(batchStatus.completed > 0
                                    ? (batchStatus.completed / Math.max(1, batchStatus.total)) * 100
                                    : (batchStatus.estimatedProgress || 0)
                                  )}%
                                </div>
                              </div>
                              <div className="text-center text-sm text-gold-400/90 font-medium">
                                {batchStatus.status === 'running' && batchStatus.completed < batchStatus.total && (
                                  <div className="space-y-3">
                                    <div className="flex items-center justify-center gap-2">
                                      <span className="inline-block w-2 h-2 bg-gold-400 rounded-full animate-ping"></span>
                                      <span>Processing inscription {batchStatus.completed + 1} of {batchStatus.total}</span>
                                    </div>
                                    {/* Warning to keep tab open */}
                                    <div className="bg-amber-500/10 border border-amber-500/30 rounded p-3 text-xs text-amber-200/90">
                                      <div className="flex items-start gap-2">
                                        <svg className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                        </svg>
                                        <div className="text-left">
                                          <div className="font-semibold">Keep this tab open</div>
                                          <div className="text-amber-300/70 mt-1">
                                            Batch of {batchStatus.total} can take up to {Math.ceil(batchStatus.total / 5)} minute{batchStatus.total > 5 ? 's' : ''}.
                                            Do not close or refresh this page until complete.
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                )}
                                {batchStatus.status === 'completed' && (
                                  `All ${batchStatus.total} inscriptions successfully minted!`
                                )}
                                {batchStatus.status === 'failed' && (
                                  <div className="space-y-2">
                                    <div className="text-red-300 font-semibold">Batch stopped after {batchStatus.completed} of {batchStatus.total} completed.</div>
                                    <div className="text-gold-300/90 text-xs">
                                      The inscriptions listed below are already on-chain. You can retry to continue where it left off.
                                    </div>
                                    {batchStatus.error && (
                                      <div className="text-red-200/85 text-xs break-words">
                                        {batchStatus.error}
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            </div>

                            {/* Live updates (only while running/failed) */}
                            {batchStatus.status !== 'completed' && batchLog.length > 0 && (
                              <div className="space-y-1">
                                <div className="text-xs text-gold-400/70 font-semibold">Live updates</div>
                                <div
                                  ref={batchLogRef}
                                  className="bg-black/40 border border-gold-500/20 rounded p-3 text-xs max-h-32 overflow-auto space-y-1"
                                >
                                  {batchLog.map((line, idx) => (
                                    <div key={`${line}-${idx}`} className="text-gold-200/90">{line}</div>
                                  ))}
                                </div>
                              </div>
                            )}

                            {/* Cost summary (estimates) - Hide on complete */}
                            {batchCost && batchStatus.status !== 'completed' && (
                              <div className="text-xs text-gold-300/90 bg-black/30 border border-gold-500/20 rounded p-3 space-y-1">
                                <div className="font-semibold text-gold-200">Estimated cost (pre-flight)</div>
                                <div className="flex justify-between">
                                  <span>Per inscription:</span>
                                  <span className="font-mono">{batchCost.per.toLocaleString()} zats ({formatZEC(batchCost.per)})</span>
                                </div>
                                <div className="flex justify-between">
                                  <span>Total this batch:</span>
                                  <span className="font-mono">{batchCost.total.toLocaleString()} zats ({formatZEC(batchCost.total)})</span>
                                </div>
                                <div className="text-gold-400/80">Final spend may differ based on UTXO selection and dust handling.</div>
                              </div>
                            )}

                            {/* Fee tier selection - Hide on complete */}
                            {batchStatus.status !== 'completed' && (
                              <div className="text-xs text-gold-300/90 bg-black/20 border border-gold-500/20 rounded p-3 space-y-2">
                                <div className="font-semibold text-gold-200">Network Fee</div>
                                <div className="grid grid-cols-3 gap-2">
                                  {feeTiers.map(tier => (
                                    <button
                                      key={tier.key}
                                      onClick={() => setSelectedFeeTier(tier)}
                                      disabled={batchStatus.status === 'running'}
                                      className={`rounded border px-2 py-2 text-center transition-all ${selectedFeeTier.key === tier.key
                                        ? 'border-gold-400 bg-gold-500/20 text-gold-50'
                                        : 'border-gold-500/20 bg-black/30 text-gold-300 hover:border-gold-400/60'
                                        } ${batchStatus.status === 'running' ? 'opacity-50 cursor-not-allowed' : ''}`}
                                    >
                                      <div className="text-xs font-bold">{tier.label}</div>
                                      <div className="font-mono text-sm">{formatZEC(tier.perTx)}</div>
                                    </button>
                                  ))}
                                </div>
                                <div className="text-gold-400/70">We retain the platform fee on every mint.</div>
                              </div>
                            )}

                            {/* Actual cost (on completion) */}
                            {batchStatus?.status === 'completed' && typeof batchStatus.totalCostZats === 'number' && (
                              <div className="text-xs text-gold-300/90 bg-black/30 border border-green-500/30 rounded p-3 space-y-1">
                                <div className="flex justify-between">
                                  <span>Total spent:</span>
                                  <span className="font-mono">{batchStatus.totalCostZats.toLocaleString()} zats ({formatZEC(batchStatus.totalCostZats)})</span>
                                </div>
                                {batchStatus.total > 0 && (
                                  <div className="flex justify-between">
                                    <span>Per inscription (avg):</span>
                                    <span className="font-mono">
                                      {Math.round(batchStatus.totalCostZats / Math.max(1, batchStatus.total)).toLocaleString()} zats
                                      ({formatZEC(Math.round(batchStatus.totalCostZats / Math.max(1, batchStatus.total)))})
                                    </span>
                                  </div>
                                )}
                              </div>
                            )}

                            {/* Inscription list */}
                            {batchStatus.ids.length > 0 && (
                              <div className="space-y-2">
                                <div className="text-xs text-gold-400/70 font-semibold">
                                  Inscriptions Created: {batchStatus.ids.length}/{batchStatus.total}
                                </div>
                                <div className="space-y-1.5 text-xs max-h-48 overflow-auto bg-black/40 rounded p-3 border border-gold-500/20">
                                  {batchStatus.ids.map((id, idx) => (
                                    <div key={id} className="flex items-center gap-2 hover:bg-gold-500/10 rounded px-2 py-1.5 transition-all duration-300 group animate-[fadeIn_0.5s_ease-out_forwards]" style={{ animationDelay: `${idx * 50}ms`, opacity: 0 }}>
                                      <span className="opacity-70 font-mono text-gold-400/60 min-w-[24px]">{idx + 1}.</span>
                                      <a
                                        className="flex-1 truncate text-gold-300 hover:text-gold-200 font-mono group-hover:underline"
                                        href={`https://zerdinals.com/zerdinals/${id}`}
                                        target="_blank"
                                        rel="noreferrer"
                                      >
                                        {id}
                                      </a>
                                      <svg className="w-3.5 h-3.5 text-gold-400/40 group-hover:text-gold-400 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                      </svg>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* UTXO TAB */}
              {activeTab === 'utxo' && (
                <div className="max-w-2xl mx-auto">
                  <div className="text-center mb-4 sm:mb-4">
                    <h2 className="text-lg sm:text-xl lg:text-2xl font-bold mb-2 bg-gradient-to-br from-white via-gold-100 to-gold-200 bg-clip-text text-transparent">UTXO Management</h2>
                    <p className="text-gold-400/60 text-xs sm:text-sm">
                      Split larger UTXOs into smaller ones to prepare funding for batch operations
                    </p>
                  </div>



                  <div className="bg-black/40 border border-gold-500/20 rounded p-4 sm:p-6">
                    <div className="mb-4 p-3 bg-gold-500/10 border border-gold-500/20 rounded">
                      <p className="text-gold-300 text-xs leading-relaxed">
                        <strong>How it works:</strong> Split one large UTXO into {splitCount} smaller UTXOs of {targetAmount.toLocaleString()} zatoshis each. This prepares your wallet for batch inscriptions by creating multiple spendable outputs.
                      </p>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-gold-200/80 text-xs mb-1">Split Count</label>
                        <input type="number" min="2" max="10" value={splitCount} onChange={e => setSplitCount(parseInt(e.target.value || '2'))} onWheel={(e) => e.currentTarget.blur()} className="w-full bg-black/40 border border-gold-500/30 rounded px-3 py-2 text-gold-300" />
                        <p className="text-gold-400/60 text-xs mt-1">2–10 outputs</p>
                      </div>
                      <div>
                        <label className="block text-gold-200/80 text-xs mb-1">Target Amount (zats)</label>
                        <input type="number" min="10000" value={targetAmount} onChange={e => setTargetAmount(parseInt(e.target.value || '70000'))} onWheel={(e) => e.currentTarget.blur()} className="w-full bg-black/40 border border-gold-500/30 rounded px-3 py-2 text-gold-300" />
                        <p className="text-gold-400/60 text-xs mt-1">{(targetAmount / 100000000).toFixed(8)} ZEC each</p>
                        {targetAmount < 60000 && (
                          <p className="text-red-400/70 text-xs mt-1">Recommended ≥ 60,000 zats to fund future inscriptions.</p>
                        )}
                      </div>
                      <div>
                        <label className="block text-gold-200/80 text-xs mb-1">Network Fee (zats)</label>
                        <input type="number" min={MIN_SPLIT_FEE} value={splitFee} onChange={e => {
                          const v = parseInt(e.target.value || String(MIN_SPLIT_FEE));
                          setSplitFee(Number.isFinite(v) ? Math.max(v, MIN_SPLIT_FEE) : MIN_SPLIT_FEE);
                        }} onWheel={(e) => e.currentTarget.blur()} className="w-full bg-black/40 border border-gold-500/30 rounded px-3 py-2 text-gold-300" />
                        <p className="text-gold-400/60 text-xs mt-1">{(Math.max(splitFee, MIN_SPLIT_FEE) / 100000000).toFixed(8)} ZEC</p>
                      </div>
                    </div>

                    {/* Estimation */}
                    <div className="mt-4 p-3 bg-black/40 border border-gold-500/20 rounded">
                      <div className="text-xs space-y-1">
                        <div className="flex justify-between text-gold-300">
                          <span>Total output amount:</span>
                          <span className="font-mono font-bold">{(splitCount * targetAmount).toLocaleString()} zats</span>
                        </div>
                        <div className="flex justify-between text-gold-300">
                          <span>Network fee:</span>
                          <span className="font-mono font-bold">{Math.max(splitFee, MIN_SPLIT_FEE).toLocaleString()} zats</span>
                        </div>
                        <div className="flex justify-between text-gold-400 pt-1 border-t border-gold-500/20">
                          <span className="font-bold">Required balance:</span>
                          <span className="font-mono font-bold">{(splitCount * targetAmount + Math.max(splitFee, MIN_SPLIT_FEE)).toLocaleString()} zats ({((splitCount * targetAmount + Math.max(splitFee, MIN_SPLIT_FEE)) / 100000000).toFixed(8)} ZEC)</span>
                        </div>
                        {/* Show spendable total only after Advanced is opened; otherwise show wallet balance */}
                        {advancedOpen && utxoList.length > 0 ? (
                          <div className="flex justify-between text-gold-300">
                            <span>Spendable UTXOs total:</span>
                            <span className="font-mono font-bold">
                              {utxoList.filter(u => !u.inscribed).reduce((s, u) => s + (u.value || 0), 0).toLocaleString()} zats
                              <span className="opacity-60"> ({(utxoList.filter(u => !u.inscribed).reduce((s, u) => s + (u.value || 0), 0) / 100000000).toFixed(8)} ZEC)</span>
                            </span>
                          </div>
                        ) : (
                          splitBalance && (
                            <div className="flex justify-between text-gold-300">
                              <span>Available balance:</span>
                              <span className="font-mono font-bold">
                                {(splitBalance.confirmed + splitBalance.unconfirmed).toFixed(8)} ZEC
                                <span className="opacity-60"> (conf: {splitBalance.confirmed.toFixed(8)}, unconf: {splitBalance.unconfirmed.toFixed(8)})</span>
                              </span>
                            </div>
                          )
                        )}
                      </div>
                    </div>

                    <button onClick={handleSplit} disabled={loading || !isConnected || targetAmount < 60000} className="w-full mt-4 px-6 py-4 bg-black/30 backdrop-blur-xl border border-gold-500/30 rounded text-gold-400 font-bold text-lg hover:bg-gold-500/10 hover:border-gold-500/50 transition-all disabled:opacity-50 disabled:cursor-not-allowed">{loading ? (
                      <svg className="animate-spin h-5 w-5 mx-auto" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    ) : 'Split UTXOs'}</button>
                    {splitResult && (
                      <div className="mt-6 p-4 sm:p-6 bg-gold-500/10 border border-gold-500/30 rounded relative">
                        <button
                          onClick={() => { setSplitResult(null); setSplitTxid(null); }}
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
                            <a
                              href={`https://mainnet.zcashexplorer.app/transactions/${splitResult.txid}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-gold-300 hover:text-gold-400 font-mono text-xs sm:text-sm break-all bg-black/40 p-3 rounded block transition-colors underline"
                            >
                              {splitResult.txid}
                            </a>
                          </div>
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <div className="text-gold-400/60 text-xs mb-1">Outputs Created</div>
                              <div className="text-gold-300 font-mono text-xs sm:text-sm bg-black/40 p-2 rounded">
                                {splitResult.splitCount} × {splitResult.targetAmount.toLocaleString()} zats
                              </div>
                            </div>
                            <div>
                              <div className="text-gold-400/60 text-xs mb-1">Total Outputs</div>
                              <div className="text-gold-300 font-mono text-xs sm:text-sm bg-black/40 p-2 rounded">
                                {(splitResult.splitCount * splitResult.targetAmount).toLocaleString()} zats ({((splitResult.splitCount * splitResult.targetAmount) / 100000000).toFixed(8)} ZEC)
                              </div>
                            </div>
                            <div>
                              <div className="text-gold-400/60 text-xs mb-1">Network Fee</div>
                              <div className="text-gold-300 font-mono text-xs sm:text-sm bg-black/40 p-2 rounded">
                                {splitResult.fee.toLocaleString()} zats ({(splitResult.fee / 100000000).toFixed(8)} ZEC)
                              </div>
                            </div>
                            {splitResult.change > 0 && (
                              <div>
                                <div className="text-gold-400/60 text-xs mb-1">Change Returned</div>
                                <div className="text-gold-300 font-mono text-xs sm:text-sm bg-black/40 p-2 rounded">
                                  {splitResult.change.toLocaleString()} zats ({(splitResult.change / 100000000).toFixed(8)} ZEC)
                                </div>
                              </div>
                            )}
                          </div>
                          <div className="pt-3">
                            <p className="text-xs text-gold-400/70">Note: It may take a few minutes for outputs to appear in explorers and wallets.</p>
                          </div>
                        </div>
                      </div>
                    )}
                    {/* Advanced section */}
                    <div className="mt-6">
                      <button
                        onClick={() => setAdvancedOpen(!advancedOpen)}
                        className="w-full p-3 bg-black/20 border border-gold-500/10 rounded flex items-center justify-between hover:bg-black/30 transition-all"
                      >
                        <span className="text-sm font-bold text-gold-400">Advanced</span>
                        <svg className={`w-5 h-5 text-gold-400 transition-transform ${advancedOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" /></svg>
                      </button>
                      {advancedOpen && (
                        <div className="mt-3">
                          {(() => {
                            const spendable = utxoList.filter(u => !u.inscribed);
                            const spendableTotal = spendable.reduce((s, u) => s + (u.value || 0), 0);
                            const largest = spendable.reduce((m, u) => Math.max(m, u.value || 0), 0);
                            return (
                              <div className="grid grid-cols-3 gap-3 mb-3">
                                <div className="bg-black/30 border border-gold-500/20 rounded p-3 text-center">
                                  <div className="text-[11px] text-gold-400/60">Spendable total</div>
                                  <div className="font-mono text-gold-200 text-sm mt-1">{spendableTotal.toLocaleString()} zats</div>
                                  <div className="text-[10px] text-gold-400/50">{(spendableTotal / 100000000).toFixed(8)} ZEC</div>
                                </div>
                                <div className="bg-black/30 border border-gold-500/20 rounded p-3 text-center">
                                  <div className="text-[11px] text-gold-400/60">Largest UTXO</div>
                                  <div className="font-mono text-gold-200 text-sm mt-1">{largest.toLocaleString()} zats</div>
                                  <div className="text-[10px] text-gold-400/50">{(largest / 100000000).toFixed(8)} ZEC</div>
                                </div>
                                <div className="bg-black/30 border border-gold-500/20 rounded p-3 text-center">
                                  <div className="text-[11px] text-gold-400/60">Spendable count</div>
                                  <div className="font-mono text-gold-200 text-sm mt-1">{spendable.length}</div>
                                  <div className="text-[10px] text-gold-400/50">of {utxoList.length} total</div>
                                </div>
                              </div>
                            );
                          })()}

                          <div className="bg-black/20 border border-gold-500/10 rounded p-3">
                            <div className="flex items-center justify-between mb-2 gap-2">
                              <h4 className="text-sm font-bold text-gold-400">Your UTXOs</h4>
                              <div className="flex items-center gap-3">
                                <div className="text-xs text-gold-400/60">{utxoList.length} total • {utxoList.filter(u => !u.inscribed).length} spendable</div>
                                <button onClick={reloadUtxos} disabled={loadingUtxos} className="text-xs px-2 py-1 border border-gold-500/30 rounded text-gold-300 hover:bg-gold-500/10 disabled:opacity-50">{loadingUtxos ? 'Refreshing…' : 'Refresh'}</button>
                              </div>
                            </div>
                            {loadingUtxos ? (
                              <div className="text-center py-6 text-gold-400/60 text-sm">Loading UTXOs...</div>
                            ) : utxoList.length === 0 ? (
                              <div className="text-center py-6 text-gold-400/60 text-sm">No UTXOs found. Send some ZEC to your wallet.</div>
                            ) : (
                              <div className="overflow-x-auto">
                                <div className="flex gap-2 pb-1">
                                  {utxoList.map((u, idx) => (
                                    <div key={idx} className={`min-w-[120px] p-2 rounded border ${u.inscribed ? 'border-gold-500/10 bg-black/40' : 'border-gold-500/30 bg-black/60'} `}>
                                      <div className="flex items-center justify-between">
                                        <span className={`w-1.5 h-1.5 rounded-full ${u.inscribed ? 'bg-gold-400/40' : 'bg-gold-400'}`}></span>
                                        <span className="text-[10px] uppercase tracking-wide text-gold-400/60">{u.inscribed ? 'INS' : 'OK'}</span>
                                      </div>
                                      <div className="mt-2 font-mono text-xs text-gold-200 break-all">{(u.value || 0).toLocaleString()} zats</div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Troubleshooting panel intentionally hidden */}
                </div>
              )}

              {/* HISTORY TAB */}
              {activeTab === 'history' && (
                <div className="max-w-5xl mx-auto">
                  <div className="text-center mb-4 sm:mb-6">
                    <h2 className="text-lg sm:text-xl lg:text-2xl font-bold mb-2 bg-gradient-to-br from-white via-gold-100 to-gold-200 bg-clip-text text-transparent">Inscription History</h2>
                    <p className="text-gold-400/60 text-xs sm:text-sm">
                      Audit trail of your inscriptions on Zcash
                    </p>
                  </div>

                  {isConnected && wallet?.address && (
                    <InscriptionHistory address={wallet.address} />
                  )}
                </div>
              )}

              {/* Connection Warning */}
              {!isConnected && (
                <div className="w-full m-auto max-w-2xl mt-6 flex justify-center">
                  <div className="w-full p-4 bg-yellow-500/10 border border-yellow-500/30 rounded">
                    <p className="text-yellow-400 text-sm text-center">
                      ⚠️ Please connect your wallet to continue
                    </p>
                  </div>
                </div>
              )}

              {/* Error Display */}
              {error && (
                <div className="mt-6 my-4 p-4 sm:p-6 bg-red-500/10 border border-red-500/30 rounded relative max-w-2xl mx-auto">
                  <button
                    onClick={() => setError(null)}
                    className="absolute top-3 right-3 text-red-400/60 hover:text-red-300 transition-colors"
                    aria-label="Close"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                  <h3 className="text-red-300 font-bold mb-3 text-base">⚠ Transaction Error</h3>
                  {cleanErrorMessage(error).includes('mempool-conflict') ? (
                    <p className="text-red-400 text-sm">
                      A previous transaction is still pending. Wait a few minutes and try again, or use the{' '}
                      <button
                        onClick={() => {
                          setActiveTab('utxo');
                          setError(null);
                        }}
                        className="underline hover:text-red-300 font-bold transition-colors"
                      >
                        UTXO Management
                      </button>{' '}
                      tab to prepare fresh UTXOs.
                    </p>
                  ) : error.includes('unpaid action limit exceeded') || error.includes('action limit exceeded') ? (
                    <p className="text-red-400 text-sm">
                      Provider rate limit hit or transaction too complex. Please wait a moment and try again, or reduce outputs to 10 or fewer and ensure sufficient transparent ZEC balance.
                    </p>
                  ) : error.includes('UTXO lock failed') ? (
                    <p className="text-red-400 text-sm">
                      Your UTXOs are currently locked by another operation. Please wait a moment and try again.
                    </p>
                  ) : (error.includes('non-inscribed UTXO') || error.includes('All available UTXOs are inscribed')) ? (
                    <p className="text-red-400 text-sm">
                      Split failed: A single, non-inscribed UTXO large enough for the split was not found. Please send a fresh, clean UTXO to your wallet and try again.
                    </p>
                  ) : error.includes('finalizeCommitAndGetRevealPreimageAction') || error.includes('buildUnsignedCommitAction') ? (
                    <p className="text-red-400 text-sm">
                      Failed to prepare inscription transaction. This may be due to insufficient balance or unavailable UTXOs. Please check your wallet balance and try again.
                    </p>
                  ) : (
                    <p className="text-red-400 text-sm">{cleanErrorMessage(error)}</p>
                  )}
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
            ...(pendingArgs.contentType === 'split'
              ? [
                { label: 'Split count', valueText: String(splitCount) } as any,
                { label: 'Target per output', valueText: `${targetAmount.toLocaleString()} zats (${(targetAmount / 100000000).toFixed(8)} ZEC)` } as any,
                { label: 'Total output amount', valueText: `${(splitCount * targetAmount).toLocaleString()} zats (${((splitCount * targetAmount) / 100000000).toFixed(8)} ZEC)` } as any,
              ]
              : pendingArgs.type === 'batch-mint'
                ? [
                  { label: 'Batch Count', valueText: String(pendingArgs.batchCount || 1) } as any,
                  {
                    label: 'Inscription output',
                    valueZats: calculateTotalCost(PLATFORM_FEES.INSCRIPTION, new TextEncoder().encode(pendingArgs.contentJson || '').length, { feePerTx: selectedFeeTier.perTx }).inscriptionOutput * (pendingArgs.batchCount || 1)
                  } as any
                ]
                : [{
                  label: 'Inscription output',
                  valueZats: pendingArgs.type === 'image'
                    ? calculateImageInscriptionFees(atob(pendingArgs.content || '').length, { feePerTx: selectedFeeTier.perTx }).inscriptionOutput
                    : pendingArgs.type === 'name'
                      ? calculateTotalCost(PLATFORM_FEES.NAME_REGISTRATION, new TextEncoder().encode(pendingArgs.content || '').length, { feePerTx: selectedFeeTier.perTx }).inscriptionOutput
                      : calculateTotalCost(PLATFORM_FEES.INSCRIPTION, new TextEncoder().encode(pendingArgs.content || pendingArgs.contentJson || '').length, { feePerTx: selectedFeeTier.perTx }).inscriptionOutput
                } as any]),
            // Numeric item(s) included in total:
            {
              label: 'Network fee',
              valueZats: pendingArgs.type === 'batch-mint'
                ? calculateTotalCost(PLATFORM_FEES.INSCRIPTION, new TextEncoder().encode(pendingArgs.contentJson || '').length, { feePerTx: selectedFeeTier.perTx }).networkFee * (pendingArgs.batchCount || 1)
                : pendingArgs.type === 'image'
                  ? calculateImageInscriptionFees(atob(pendingArgs.content || '').length, { feePerTx: selectedFeeTier.perTx }).networkFee
                  : pendingArgs.type === 'name'
                    ? calculateTotalCost(PLATFORM_FEES.NAME_REGISTRATION, new TextEncoder().encode(pendingArgs.content || '').length, { feePerTx: selectedFeeTier.perTx }).networkFee
                    : pendingArgs.contentType === 'split'
                      ? Math.max(pendingArgs.fee, MIN_SPLIT_FEE)
                      : calculateTotalCost(PLATFORM_FEES.INSCRIPTION, new TextEncoder().encode(pendingArgs.content || pendingArgs.contentJson || '').length, { feePerTx: selectedFeeTier.perTx }).networkFee
            } as any,
            ...(pendingArgs.contentType === 'split'
              ? [
                { label: 'Required input balance', valueText: `${(splitCount * targetAmount + Math.max(splitFee, MIN_SPLIT_FEE)).toLocaleString()} zats (${(((splitCount * targetAmount) + Math.max(splitFee, MIN_SPLIT_FEE)) / 100000000).toFixed(8)} ZEC)` } as any,
              ]
              : pendingArgs.type === 'batch-mint'
                ? [{ label: 'Platform fee', valueZats: PLATFORM_FEES.INSCRIPTION * (pendingArgs.batchCount || 1) } as any]
                : [{ label: 'Platform fee', valueZats: pendingArgs.type === 'name' ? PLATFORM_FEES.NAME_REGISTRATION : PLATFORM_FEES.INSCRIPTION } as any]),
          ]}
          onCancel={() => setConfirmOpen(false)}
          onConfirm={async () => {
            if (!wallet?.privateKey || !wallet?.address) { setConfirmOpen(false); setError('Please connect your wallet first'); return; }

            if (pendingArgs.type === 'batch-mint') {
              setConfirmOpen(false);
              await executeBatchMint();
              return;
            }

            setConfirmOpen(false); setLoading(true); setError(null); setResult(null);
            try {
              const wifPayload = bs58check.decode(wallet.privateKey);
              const priv = wifPayload.slice(1, wifPayload.length === 34 ? 33 : undefined);
              const pubKeyHex = Array.from(secp.getPublicKey(priv, true)).map(b => b.toString(16).padStart(2, '0')).join('');
              const walletSigner = async (sighashHex: string) => {
                const digest = Uint8Array.from(sighashHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
                const sig = await secp.sign(digest, priv);
                const raw = (sig as any).toCompactRawBytes ? (sig as any).toCompactRawBytes() : (sig as Uint8Array);
                return Array.from(raw).map(b => b.toString(16).padStart(2, '0')).join('');
              };
              if (pendingArgs.contentType === 'split') {
                const convex = getConvexClient(); if (!convex) throw new Error('Convex client not available');
                // Retry a few times in case of transient UTXO lock failures
                let step1: any | null = null;
                let lastErr: any = null;
                for (let attempt = 0; attempt < 3; attempt++) {
                  try {
                    step1 = await convex.action(api.inscriptionsActions.buildUnsignedSplitAction, {
                      address: wallet.address,
                      pubKeyHex,
                      splitCount,
                      targetAmount,
                      fee: Math.max(splitFee, MIN_SPLIT_FEE),
                    } as any);
                    break;
                  } catch (e: any) {
                    lastErr = e;
                    const msg = e?.message || String(e);
                    if (msg.includes('UTXO lock failed')) {
                      await new Promise(r => setTimeout(r, 300 * (attempt + 1)));
                      continue;
                    }
                    throw e;
                  }
                }
                if (!step1) throw lastErr || new Error('Failed to prepare split transaction');
                const sigHashes: string[] = step1.splitSigHashHexes || (step1.splitSigHashHex ? [step1.splitSigHashHex] : []);
                if (!Array.isArray(sigHashes) || sigHashes.length === 0) throw new Error('No split sighashes returned');
                const splitSignaturesRawHex: string[] = [];
                for (const h of sigHashes) {
                  splitSignaturesRawHex.push(await walletSigner(h));
                }
                const res = await convex.action(api.inscriptionsActions.broadcastSignedSplitAction, {
                  contextId: step1.contextId,
                  splitSignaturesRawHex,
                } as any);
                setSplitTxid(res.txid);
                setSplitResult({
                  txid: res.txid,
                  splitCount: (res as any).splitCount ?? splitCount,
                  targetAmount: (res as any).targetAmount ?? targetAmount,
                  fee: (res as any).fee ?? splitFee,
                  change: (res as any).change ?? 0,
                });
              } else {
                // Recalculate fees with selected tier for final transaction
                let finalFees = { networkFee: pendingArgs.fee, inscriptionOutput: pendingArgs.inscriptionAmount };
                if (pendingArgs.type === 'image') {
                  const binary = atob(pendingArgs.content || '');
                  finalFees = calculateImageInscriptionFees(binary.length, { feePerTx: selectedFeeTier.perTx });
                } else if (pendingArgs.type === 'name') {
                  finalFees = calculateTotalCost(PLATFORM_FEES.NAME_REGISTRATION, new TextEncoder().encode(pendingArgs.content || '').length, { feePerTx: selectedFeeTier.perTx });
                } else if (pendingArgs.type !== 'batch-mint') {
                  const content = pendingArgs.content || pendingArgs.contentJson || '';
                  finalFees = calculateTotalCost(PLATFORM_FEES.INSCRIPTION, new TextEncoder().encode(content).length, { feePerTx: selectedFeeTier.perTx });
                }

                const { commitTxid, revealTxid, inscriptionId } = await safeMintInscription(
                  {
                    address: wallet.address,
                    pubKeyHex,
                    ...pendingArgs,
                    fee: finalFees.networkFee,
                    inscriptionAmount: finalFees.inscriptionOutput
                  },
                  walletSigner
                );
                setResult({ commitTxid, revealTxid, inscriptionId });
                if (pendingArgs.type === 'name') setNameInput('');
                if (pendingArgs.type === 'text' || pendingArgs.type === 'json') setTextContent('');
                if (pendingArgs.type?.startsWith('zrc20')) { setTick(''); setAmount(''); setMaxSupply(''); setMintLimit(''); }
              }
            } catch (e: any) {
              setError(e?.message || String(e));
            } finally { setLoading(false); }
          }}
          feeOptions={feeTiers}
          selectedFeeOption={selectedFeeTier}
          onFeeOptionChange={(option) => setSelectedFeeTier(option as any)}
        />
      )}
    </main>
  );
}

export default function InscribePage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><div className="text-gold-400 animate-pulse">Loading...</div></div>}>
      <InscribePageContent />
    </Suspense>
  );
}
