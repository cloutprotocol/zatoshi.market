'use client';

import { useEffect, useMemo, useState } from 'react';
import { useWallet } from '@/contexts/WalletContext';
import { BadgePill } from '@/components/BadgePill';
import type { CollectionConfig } from '@/config/collections';
import { getConvexClient } from '@/lib/convexClient';
import { api } from '../../../../convex/_generated/api';
import bs58check from 'bs58check';
import * as secp from '@noble/secp256k1';
import { safeMintInscription } from '@/utils/inscribe';
import { ConfirmTransaction } from '@/components/ConfirmTransaction';
import { PLATFORM_FEES, calculateTotalCost } from '@/config/fees';

type Props = {
  collection: CollectionConfig;
};

type Allocation = {
  address: string;
  max: number;
  isVip: boolean;
};

export function ClaimClient({ collection }: Props) {
  const { wallet, badges, mounted } = useWallet();
  const [loadingAlloc, setLoadingAlloc] = useState(false);
  const [allocation, setAllocation] = useState<Allocation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimCount, setClaimCount] = useState(1);
  const [lastMinted, setLastMinted] = useState<{ tokenId: number; inscriptionId: string; txid: string }[]>([]);
  const [claimStats, setClaimStats] = useState<{ mintedCount: number; mintedForAddress: { count: number } } | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingTokens, setPendingTokens] = useState<number[]>([]);
  const [pendingPayloads, setPendingPayloads] = useState<string[]>([]);
  const feeTiers = [
    { key: 'low', label: 'Low', perTx: 20000 },
    { key: 'normal', label: 'Normal', perTx: 50000 },
    { key: 'high', label: 'High', perTx: 100000 },
  ] as const;
  const [selectedFeeTier, setSelectedFeeTier] = useState<typeof feeTiers[number]>(feeTiers[1]);
  const [minting, setMinting] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [batchResults, setBatchResults] = useState<{ tokenId: number; status: 'minted' | 'failed'; inscriptionId?: string; txid?: string; error?: string }[]>([]);

  const vipBadgePresent = useMemo(
    () => badges.some((b) => b.badgeSlug === 'vip'),
    [badges]
  );

  useEffect(() => {
    const load = async () => {
      if (!wallet?.address || !collection.claimWhitelistPath) {
        setAllocation(null);
        return;
      }
      setLoadingAlloc(true);
      setError(null);
      try {
        const res = await fetch(collection.claimWhitelistPath);
        if (!res.ok) throw new Error(`Failed to load whitelist (${res.status})`);
        const text = await res.text();
        const lines = text.trim().split('\n');
        let found: Allocation | null = null;
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i]?.split(',');
          if (cols.length < 2) continue;
          const [address, count, , vipFlag] = cols.map((c) => c.trim());
          if (address.toLowerCase() === wallet.address.toLowerCase()) {
            found = {
              address,
              max: Number(count) || 0,
              isVip: vipFlag?.toLowerCase() === 'true',
            };
            break;
          }
        }
        setAllocation(found);
      } catch (e) {
        console.error('Whitelist load failed:', e);
        setError(e instanceof Error ? e.message : 'Failed to load whitelist');
      } finally {
        setLoadingAlloc(false);
      }
    };
    load();
  }, [wallet?.address, collection.claimWhitelistPath]);

  useEffect(() => {
    const loadStats = async () => {
      const convex = getConvexClient();
      if (!convex) return;
      const res = await convex.query(api.collectionClaims.getClaimStats, {
        collectionSlug: collection.slug,
        address: wallet?.address || undefined,
      });
      setClaimStats(res as any);
    };
    loadStats();
  }, [collection.slug, wallet?.address, lastMinted.length, claiming]);

  const remainingAllowlist = useMemo(() => {
    if (!allocation) return 0;
    const already = claimStats?.mintedForAddress?.count ?? 0;
    return Math.max(0, allocation.max - already);
  }, [allocation, claimStats]);

  const handleClaim = async () => {
    if (!wallet?.address || !wallet?.privateKey) {
      setError('Please connect your wallet');
      return;
    }
    if (!allocation) {
      setError('Wallet not whitelisted for this collection');
      return;
    }
    if (remainingAllowlist <= 0) {
      setError('Allocation exhausted');
      return;
    }
    const qty = Math.min(5, claimCount, remainingAllowlist);

    const convex = getConvexClient();
    if (!convex) {
      setError('Convex client not available');
      return;
    }

    setError(null);
    setClaiming(true);
    try {
      const reserve = await convex.mutation(api.collectionClaims.reserveTokens, {
        collectionSlug: collection.slug,
        address: wallet.address,
        count: qty,
        supply: collection.supply || 10000,
      } as any);
      const payloads = (reserve.tokenIds as number[]).map((tokenId: number) =>
        JSON.stringify({
          p: 'zrc-721',
          op: 'mint',
          collection: collection.name.toUpperCase(),
          id: String(tokenId),
        })
      );
      setPendingTokens(reserve.tokenIds as number[]);
      setPendingPayloads(payloads);
      setShowConfirm(true);
      setClaiming(false);
    } catch (e: any) {
      console.error('Claim failed:', e);
      setError(e?.message || String(e));
      setClaiming(false);
    }
  };

  const releasePending = async () => {
    const convex = getConvexClient();
    if (!convex || !pendingTokens.length || !wallet?.address) return;
    const currentBatch = batchId ?? `batch-${Date.now()}`;
    await Promise.all(
      pendingTokens.map((tokenId) =>
        convex.mutation(api.collectionClaims.finalizeToken, {
          collectionSlug: collection.slug,
          tokenId,
          address: wallet.address,
          inscriptionId: '',
          txid: '',
          success: false,
          batchId: currentBatch,
          error: 'cancelled',
        } as any)
      )
    );
    setPendingTokens([]);
    setPendingPayloads([]);
  };

  const confirmAndMint = async () => {
    if (!wallet?.address || !wallet?.privateKey) {
      setError('Please connect your wallet');
      return;
    }
    if (!pendingTokens.length || !pendingPayloads.length) {
      setShowConfirm(false);
      return;
    }

    const convex = getConvexClient();
    if (!convex) {
      setError('Convex client not available');
      return;
    }

    const newBatchId = `batch-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
    setBatchId(newBatchId);
    setBatchResults([]);
    setError(null);
    setShowConfirm(false);
    setClaiming(true);
    setMinting(true);
    try {
      const wifPayload = bs58check.decode(wallet.privateKey);
      const priv = wifPayload.slice(1, wifPayload.length === 34 ? 33 : undefined);
      const pubKeyHex = Array.from(secp.getPublicKey(priv, true)).map((b) => b.toString(16).padStart(2, '0')).join('');
      const walletSigner = async (sighashHex: string) => {
        const digest = Uint8Array.from(sighashHex.match(/.{1,2}/g)!.map((b) => parseInt(b, 16)));
        const sig = await secp.sign(digest, priv);
        const raw = (sig as any).toCompactRawBytes ? (sig as any).toCompactRawBytes() : (sig as Uint8Array);
        return Array.from(raw).map((b) => b.toString(16).padStart(2, '0')).join('');
      };

      const mintedResults: { tokenId: number; inscriptionId: string; txid: string }[] = [];
      for (let idx = 0; idx < pendingTokens.length; idx++) {
        const tokenId = pendingTokens[idx];
        const contentJson = pendingPayloads[idx];
        try {
          const { revealTxid, inscriptionId } = await safeMintInscription(
            {
              address: wallet.address,
              pubKeyHex,
              contentJson,
              contentType: 'application/json',
              type: 'zrc721',
            },
            walletSigner
          );
          mintedResults.push({ tokenId, inscriptionId, txid: revealTxid });
          setBatchResults((prev) => [...prev, { tokenId, status: 'minted', inscriptionId, txid: revealTxid }]);
          await convex.mutation(api.collectionClaims.finalizeToken, {
            collectionSlug: collection.slug,
            tokenId,
            address: wallet.address,
            inscriptionId,
            txid: revealTxid,
            success: true,
            batchId: newBatchId,
          } as any);
        } catch (err: any) {
          const msg = err?.message || String(err);
          setBatchResults((prev) => [...prev, { tokenId, status: 'failed', error: msg }]);
          await convex.mutation(api.collectionClaims.finalizeToken, {
            collectionSlug: collection.slug,
            tokenId,
            address: wallet.address,
            inscriptionId: undefined,
            txid: undefined,
            success: false,
            batchId: newBatchId,
            error: msg,
          } as any);
          continue;
        }
      }
      setLastMinted((prev) => [...mintedResults, ...prev]);
      setPendingTokens([]);
      setPendingPayloads([]);
    } catch (e: any) {
      console.error('Mint failed:', e);
      setError(e?.message || String(e));
      // Mark any unattempted as failed for visibility
      const convexInner = getConvexClient();
      if (convexInner) {
        for (const tokenId of pendingTokens) {
          if (batchResults.find((r) => r.tokenId === tokenId)) continue;
          const msg = e?.message || String(e);
          await convexInner.mutation(api.collectionClaims.finalizeToken, {
            collectionSlug: collection.slug,
            tokenId,
            address: wallet.address,
            inscriptionId: undefined,
            txid: undefined,
            success: false,
            batchId: batchId || `batch-${Date.now()}`,
            error: msg,
          } as any);
          setBatchResults((prev) => [...prev, { tokenId, status: 'failed', error: msg }]);
        }
      }
    } finally {
      setClaiming(false);
      setMinting(false);
    }
  };

  return (
    <main className="min-h-screen bg-black text-gold-100">
      <div className="container mt-14 mx-auto px-6 py-28 max-w-4xl">
        <div className="flex flex-col gap-4 mb-12">
          <div className="flex items-center gap-5">
            <img
              src="/collections/zgods/3vUZmMCg.gif"
              alt="ZGODS"
              className="w-28 h-28 rounded border border-gold-500/40"
            />
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold tracking-tight">{collection.name} Claim</h1>
              {collection.supply ? (
                <span className="text-sm text-gold-300/80 border border-gold-500/30 rounded-full px-3 py-1">
                  Supply {collection.supply.toLocaleString()}
                </span>
              ) : null}
            </div>
          </div>
          {collection.description && (
            <p className="text-gold-200/70">
              The first ZRC-721 Inscription Collection on the Zcash blockchain. Claim your allocation and mint inscription IDs tied to the collection metadata.
            </p>
          )}
        </div>

        <div className="glass-card p-6 border border-gold-500/20 rounded-lg mb-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="space-y-2">
              <div className="text-sm text-gold-200/70">Connected wallet</div>
              <div className="font-mono text-lg">
                {mounted
                  ? wallet?.address ?? 'Not connected'
                  : '...'}
              </div>
            </div>
            <div className="flex gap-2 flex-wrap">
              {badges.slice(0, 1).map((b) => (
                <BadgePill key={`${b.badgeSlug}-${b.source || 'default'}`} badge={b} />
              ))}
            </div>
          </div>
          {allocation && (
            <div className="mt-4 flex flex-col gap-2 text-sm">
              <div className="flex items-center gap-2">
                <span className="text-gold-200/70">Whitelist allocation:</span>
                <span className="font-semibold text-gold-200">{allocation.max}</span>
              </div>
              <div className="text-gold-200/60">
                Claiming UI is being wired to batch mint ZRC-721. Your allocation is recognized.
              </div>
            </div>
          )}
          {!allocation && wallet?.address && !loadingAlloc && !error && (
            <div className="mt-4 text-sm text-red-300">
              This wallet is not in the whitelist for this collection.
            </div>
          )}
          {loadingAlloc && (
            <div className="mt-4 text-sm text-gold-200/70">Checking whitelist...</div>
          )}
          {error && (
            <div className="mt-4 text-sm text-red-300">Error: {error}</div>
          )}
        </div>

        <div className="glass-card p-6 border border-gold-500/20 rounded-lg">
          <div className="flex items-center justify-between gap-3 mb-4">
            <h2 className="text-xl font-semibold">Claim</h2>
          </div>

          <div className="flex flex-col gap-3 mb-4">
            <div className="text-sm text-gold-200/70">
              Remaining allocation: <span className="font-semibold text-gold-100">{remainingAllowlist}</span>
            </div>
            <label className="flex items-center gap-3 text-sm">
              <span>Quantity (max 5)</span>
              <input
                type="number"
                min={1}
                max={Math.min(5, remainingAllowlist || 1)}
                value={claimCount}
                onChange={(e) => setClaimCount(Math.max(1, Math.min(5, Number(e.target.value) || 1)))}
                className="bg-black/30 border border-gold-500/30 rounded px-3 py-2 w-24 text-gold-100"
                disabled={claiming || remainingAllowlist <= 0}
              />
            </label>
            <button
              className="px-6 py-3 rounded-lg bg-gold-500 text-black font-bold hover:bg-gold-400 disabled:opacity-50 disabled:cursor-not-allowed"
              disabled={claiming || remainingAllowlist <= 0}
              onClick={handleClaim}
            >
              {claiming ? 'Minting...' : `Claim ${claimCount} ZGODS`}
            </button>
            {error && <div className="text-sm text-red-300">{error}</div>}
          </div>

          {lastMinted.length > 0 && (
            <div className="mt-4">
              <div className="text-sm text-gold-200/70 mb-2">Recent mints</div>
              <div className="grid gap-3">
                {lastMinted.map((m) => (
                  <div key={m.inscriptionId} className="p-3 rounded border border-gold-500/20 bg-black/40">
                    <div className="text-gold-100 font-semibold">Token #{m.tokenId}</div>
                    <div className="text-xs text-gold-200/70 break-all">Inscription: {m.inscriptionId}</div>
                    <a
                      href={`/inscription/${m.inscriptionId}`}
                      className="text-xs text-gold-300 underline"
                    >
                      View inscription
                    </a>
                  </div>
                ))}
              </div>
            </div>
          )}

          {batchResults.length > 0 && (
            <div className="mt-6">
              <div className="text-sm text-gold-200/70 mb-2">Batch results</div>
              <div className="grid gap-2">
                {batchResults.map((r) => (
                  <div key={`${batchId || 'batch'}-${r.tokenId}`} className="p-3 rounded border border-gold-500/20 bg-black/40 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                    <div className="text-gold-100 font-semibold">Mint ID #{r.tokenId}</div>
                    <div className="text-xs text-gold-200/70">
                      {r.status === 'minted' ? (
                        <>
                          Minted{' '}
                          {r.inscriptionId ? (
                            <a href={`/inscription/${r.inscriptionId}`} className="underline text-gold-300">
                              {r.inscriptionId}
                            </a>
                          ) : null}
                        </>
                      ) : (
                        <span className="text-red-300">Failed{r.error ? `: ${r.error}` : ''}</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <ConfirmTransaction
          isOpen={showConfirm}
          title="Confirm ZGODS Claim"
          onCancel={async () => {
            setShowConfirm(false);
            await releasePending();
            setClaiming(false);
            setMinting(false);
          }}
          onConfirm={confirmAndMint}
          confirmText={
            minting
              ? 'Minting...'
              : pendingTokens.length > 1
                ? 'Batch Mint'
                : 'Confirm & Mint'
          }
          feeOptions={feeTiers}
          selectedFeeOption={selectedFeeTier}
          onFeeOptionChange={setSelectedFeeTier as any}
          items={[
            {
              label: 'Quantity',
              valueText: pendingTokens.length ? `${pendingTokens.length}` : '-',
            },
            {
              label: 'Mint IDs',
              valueText: pendingTokens.length ? pendingTokens.join(', ') : '-',
            },
            (() => {
              if (!pendingPayloads.length) return { label: 'Est. total', valueZats: 0 };
              const bytes = pendingPayloads.map((p) => new TextEncoder().encode(p).length);
              const avgBytes = bytes.reduce((a, b) => a + b, 0) / bytes.length;
              const cost = calculateTotalCost(PLATFORM_FEES.INSCRIPTION, avgBytes, { feePerTx: selectedFeeTier.perTx });
              const total = Math.round(cost.total * pendingPayloads.length);
              return {
                label: 'Est. total (zats)',
                valueZats: total,
              };
            })(),
            pendingTokens.length > 1
              ? {
                  label: 'Note',
                  valueText: 'Batch mint: keep the window open and ensure enough ZEC for all mints.',
                  hidden: true,
                }
              : { label: '', hidden: true },
          ]}
          disclaimer="Your wallet will sign this transaction locally. Private keys never leave your device."
          disclaimerExtra={
            pendingTokens.length > 1 ? (
              <div className="mt-3 text-xs text-gold-100 bg-gold-500/15 border border-gold-400/60 rounded p-3 backdrop-blur flex items-start gap-2">
                <span className="text-yellow-300">⚠️</span>
                <span className="text-gold-100">
                  Batch mint: keep this window open and ensure you have enough ZEC to cover all mints.
                </span>
              </div>
            ) : null
          }
          extraContent={
            pendingPayloads.length ? (
              <div className="space-y-2 max-h-[40vh] overflow-y-auto pr-1">
                <div className="text-xs text-gold-200/80">Mint IDs</div>
                <div className="flex flex-wrap gap-2">
                  {pendingTokens.map((id) => (
                    <span
                      key={id}
                      className="px-3 py-1 rounded-full text-xs font-semibold bg-gold-500/15 border border-gold-400/40 text-gold-100"
                    >
                      #{id}
                    </span>
                  ))}
                </div>
              </div>
            ) : null
          }
        />
      </div>
    </main>
  );
}
