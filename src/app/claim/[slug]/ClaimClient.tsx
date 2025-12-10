'use client';
/* eslint-disable @next/next/no-img-element */

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useWallet } from '@/contexts/WalletContext';
import { BadgePill } from '@/components/BadgePill';
import type { CollectionConfig } from '@/config/collections';
import { getConvexClient } from '@/lib/convexClient';
import { api } from '../../../../convex/_generated/api';
import { ConfirmTransaction } from '@/components/ConfirmTransaction';
import { zrc721IndexAPI, type ZRC721Collection } from '@/services/zrc721Index';
import { PLATFORM_FEES, calculateTotalCost } from '@/config/fees';
import { buildImageUrls, buildTokenName, fetchCollectionMetadata } from '@/lib/collectionAssets';
import type { Id } from '../../../../convex/_generated/dataModel';

type Props = {
  collection: CollectionConfig;
};

type Allocation = {
  address: string;
  max: number;
  isVip: boolean;
};

type MintResult = {
  tokenId: number;
  status: 'minted' | 'failed';
  inscriptionId?: string;
  error?: string;
};

type ClaimedToken = {
  tokenId: number;
  inscriptionId?: string;
  imageUrls: string[];
  name: string;
};

type ClaimStats = {
  mintedCount: number;
  mintedForAddress: { count: number };
  reservedCount?: number;
  reservedForAddress?: { count: number };
};

type OnchainStats = {
  collection: ZRC721Collection | null;
  userTokenCount: number;
};

type ReservationRef = {
  tokenId: number;
  claimId: Id<'collectionClaims'>;
};

type ReservationIssue = {
  tokenId: number;
  reason: string;
  owner?: string | null;
  status?: string;
};

function describeReservationIssue(issue?: ReservationIssue) {
  if (!issue) {
    return 'Your reservation is no longer valid. Please reserve new tokens and try again.';
  }
  const prefix = `Token ${issue.tokenId}`;
  switch (issue.reason) {
    case 'expired':
      return `${prefix} reservation expired. Reserve new tokens.`;
    case 'already_minted':
      return `${prefix} was already minted on-chain. Please reserve a different token.`;
    case 'address_mismatch':
      return `${prefix} is now assigned to another address${issue.owner ? ` (${issue.owner})` : ''}. Reserve a new token.`;
    case 'not_reserved':
      return `${prefix} is no longer reserved. Reserve new tokens and mint within 15 minutes.`;
    case 'token_mismatch':
    case 'collection_mismatch':
      return `${prefix} reservation is invalid. Reserve again.`;
    case 'not_found':
      return `${prefix} reservation was not found. Reserve again.`;
    default:
      return `${prefix} reservation is invalid (${issue.reason}). Reserve again.`;
  }
}

export function ClaimClient({ collection }: Props) {
  const { wallet, badges, mounted } = useWallet();
  const [allocation, setAllocation] = useState<Allocation | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const [claimCount, setClaimCount] = useState(1);
  const [claimStats, setClaimStats] = useState<ClaimStats | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [pendingReservations, setPendingReservations] = useState<ReservationRef[]>([]);
  const [pendingPayloads, setPendingPayloads] = useState<string[]>([]);
  // Fee tiers (zatoshis per tx)
  const feeTiers = [
    { key: 'low', label: 'Low', perTx: 30000 },
    { key: 'normal', label: 'Normal', perTx: 50000 },
    { key: 'high', label: 'High', perTx: 100000 },
  ] as const;
  const [selectedFeeTier, setSelectedFeeTier] = useState<typeof feeTiers[number]>(feeTiers[1]);
  const [minting, setMinting] = useState(false);
  const [batchId, setBatchId] = useState<string | null>(null);
  const [mintResults, setMintResults] = useState<MintResult[]>([]);
  const [utxoWarning, setUtxoWarning] = useState<string | null>(null);
  const [claimedTokens, setClaimedTokens] = useState<ClaimedToken[]>([]);
  const [loadingClaims, setLoadingClaims] = useState(false);
  const [claimedImageLoaded, setClaimedImageLoaded] = useState<Record<string, boolean>>({});
  const [claimedImageError, setClaimedImageError] = useState<Record<string, boolean>>({});
  const [showCodeForToken, setShowCodeForToken] = useState<Record<number, boolean>>({});
  const [copiedInscription, setCopiedInscription] = useState<string | null>(null);
  const [selectedToken, setSelectedToken] = useState<ClaimedToken | null>(null);
  const [selectedTokenMetadata, setSelectedTokenMetadata] = useState<any>(null);
  const [onchainStats, setOnchainStats] = useState<OnchainStats>({ collection: null, userTokenCount: 0 });
  const [loadingOnchain, setLoadingOnchain] = useState(true);
  const mintedCount = claimStats?.mintedForAddress?.count ?? 0;
  const reservedPending = claimStats?.reservedForAddress?.count ?? 0;
  const pendingTokens = useMemo(() => pendingReservations.map((r) => r.tokenId), [pendingReservations]);

  const vipBadgePresent = useMemo(
    () => badges.some((b) => b.badgeSlug === 'vip'),
    [badges]
  );

  const loadStatus = useCallback(async () => {
    if (!wallet?.address || !collection.claimWhitelistPath) {
      setAllocation(null);
      setClaimStats(null);
      setStatusLoading(false);
      return;
    }
    setStatusLoading(true);
    setError(null);
    try {
      const whitelistPromise = (async () => {
        const res = await fetch(collection.claimWhitelistPath!);
        if (!res.ok) throw new Error(`Failed to load whitelist (${res.status})`);
        const text = await res.text();
        const lines = text.trim().split('\n');
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i]?.split(',');
          if (cols.length < 2) continue;
          const [address, count, , vipFlag] = cols.map((c) => c.trim());
          if (address.toLowerCase() === wallet.address!.toLowerCase()) {
            return {
              address,
              max: Number(count) || 0,
              isVip: vipFlag?.toLowerCase() === 'true',
            } as Allocation;
          }
        }
        return null;
      })();

      const convex = getConvexClient();
      const statsPromise = convex
        ? convex.query(api.collectionClaims.getClaimStats, {
          collectionSlug: collection.slug,
          address: wallet.address,
        })
        : Promise.resolve(null);

      const [allocRes, statsRes] = await Promise.all([whitelistPromise, statsPromise]);
      setAllocation(allocRes);
      if (statsRes) {
        setClaimStats(statsRes as any);
      } else {
        setClaimStats(null);
      }
    } catch (e) {
      console.error('Status load failed:', e);
      setError(e instanceof Error ? e.message : 'Failed to load claim status');
    } finally {
      setStatusLoading(false);
    }
  }, [wallet?.address, collection]);

  useEffect(() => {
    loadStatus();
  }, [loadStatus, mintResults.length, claiming]);

  const refreshClaimedTokens = useCallback(async () => {
    if (!wallet?.address) {
      setClaimedTokens([]);
      setLoadingClaims(false);
      return;
    }
    setLoadingClaims(true);
    try {
      // Fetch tokens from onchain API
      const tokens = await zrc721IndexAPI.getTokensByAddress(wallet.address);
      const collectionTokens = tokens.filter(t =>
        t.tick?.toLowerCase() === collection.name.toLowerCase()
      );

      const enriched = await Promise.all(
        collectionTokens.map(async (token) => {
          const tokenId = parseInt(token.token_id, 10);
          const metadata = await fetchCollectionMetadata(collection, tokenId);
          const imageUrls = buildImageUrls(collection, tokenId, metadata);
          return {
            tokenId,
            inscriptionId: token.inscription_id,
            imageUrls,
            name: buildTokenName(collection, tokenId, metadata),
          } as ClaimedToken;
        })
      );
      setClaimedTokens(enriched);
    } catch (e) {
      console.error('Failed to load claimed tokens from onchain API', e);
    } finally {
      setLoadingClaims(false);
    }
  }, [collection, wallet?.address]);

  useEffect(() => {
    refreshClaimedTokens();
  }, [refreshClaimedTokens]);

  // Fetch onchain stats
  const refreshOnchainStats = useCallback(async () => {
    setLoadingOnchain(true);
    try {
      const collectionData = await zrc721IndexAPI.getCollection(collection.name.toLowerCase());
      let userCount = 0;
      if (wallet?.address) {
        const tokens = await zrc721IndexAPI.getTokensByAddress(wallet.address);
        userCount = tokens.filter(t => t.tick?.toLowerCase() === collection.name.toLowerCase()).length;
      }
      setOnchainStats({ collection: collectionData, userTokenCount: userCount });
    } catch (e) {
      console.error('Failed to load onchain stats', e);
    } finally {
      setLoadingOnchain(false);
    }
  }, [collection.name, wallet?.address]);

  useEffect(() => {
    refreshOnchainStats();
    // Poll every 30 seconds
    const interval = setInterval(refreshOnchainStats, 30000);
    return () => clearInterval(interval);
  }, [refreshOnchainStats]);

  const remainingAllowlist = useMemo(() => {
    if (!allocation) return 0;
    return Math.max(0, allocation.max - mintedCount - reservedPending);
  }, [allocation, mintedCount, reservedPending]);

  const availableToRequest = useMemo(() => {
    if (!allocation) return 0;
    if (mintedCount >= allocation.max) return remainingAllowlist;
    return Math.max(remainingAllowlist, reservedPending);
  }, [allocation, mintedCount, remainingAllowlist, reservedPending]);
  const maxBatchSize = useMemo(() => Math.max(1, Math.min(5, availableToRequest || 1)), [availableToRequest]);

  useEffect(() => {
    setClaimCount((current) => Math.min(Math.max(1, current), maxBatchSize));
  }, [maxBatchSize]);

  const handleClaim = async () => {
    if (!wallet?.address || !wallet?.privateKey) {
      setError('Please connect your wallet');
      return;
    }
    if (!allocation) {
      setError('Wallet not whitelisted for this collection');
      return;
    }
    if (availableToRequest <= 0) {
      setError('Allocation exhausted');
      return;
    }
    const qty = Math.max(1, Math.min(maxBatchSize, claimCount));

    const convex = getConvexClient();
    if (!convex) {
      setError('Convex client not available');
      return;
    }

    setError(null);
    setMintResults([]);
    setUtxoWarning(null);
    setClaiming(true);
    try {
      const reserve = (await convex.mutation(api.collectionClaims.reserveTokens, {
        collectionSlug: collection.slug,
        address: wallet.address,
        count: qty,
        supply: collection.supply || 10000,
      } as any)) as { tokenIds: number[]; reservations?: ReservationRef[] };
      const reservations = reserve?.reservations ?? [];
      if (!reservations.length) {
        throw new Error('Reservation could not be confirmed. Please refresh and try again.');
      }
      const payloads = reservations.map(({ tokenId }) =>
        JSON.stringify({
          p: 'zrc-721',
          op: 'mint',
          collection: collection.name.toUpperCase(),
          id: String(tokenId),
        })
      );
      setPendingReservations(reservations);
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
    if (!convex || !pendingReservations.length || !wallet?.address) return;
    const currentBatch = batchId ?? `batch-${Date.now()}`;
    await Promise.all(
      pendingReservations.map(({ tokenId, claimId }) =>
        convex.mutation(api.collectionClaims.finalizeToken, {
          collectionSlug: collection.slug,
          tokenId,
          claimId,
          address: wallet.address,
          inscriptionId: '',
          txid: '',
          success: false,
          batchId: currentBatch,
          error: 'cancelled',
        } as any)
      )
    );
    setPendingReservations([]);
    setPendingPayloads([]);
    setBatchId(null);
    setUtxoWarning(null);
  };

  const confirmAndMint = async () => {
    if (!wallet?.address || !wallet?.privateKey) {
      setError('Please connect your wallet');
      return;
    }
    if (!pendingReservations.length || !pendingPayloads.length) {
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
    setMintResults([]);
    setUtxoWarning(null);
    setError(null);
    setShowConfirm(false);
    setClaiming(true);
    setMinting(true);
    try {
      const verification = (await convex.query(api.collectionClaims.verifyReservations, {
        collectionSlug: collection.slug,
        address: wallet.address,
        reservations: pendingReservations,
      } as any)) as { ok?: boolean; invalid?: ReservationIssue[] };

      if (!verification?.ok) {
        const issueMessage = describeReservationIssue(verification?.invalid?.[0]);
        setError(issueMessage);
        setPendingReservations([]);
        setPendingPayloads([]);
        setBatchId(null);
        return;
      }

      const wif = wallet.privateKey;

      for (let idx = 0; idx < pendingReservations.length; idx++) {
        const reservation = pendingReservations[idx];
        const tokenId = reservation.tokenId;
        const contentJson = pendingPayloads[idx];
        try {
          const bytes = new TextEncoder().encode(contentJson).length;
          const cost = calculateTotalCost(PLATFORM_FEES.INSCRIPTION, bytes, { feePerTx: selectedFeeTier.perTx });
          const jobRes = await convex.action(api.jobsActions.createMintJobAndRun, {
            address: wallet.address,
            wif,
            contentJson,
            contentType: 'application/json',
            inscriptionAmount: cost.inscriptionOutput,
            fee: cost.networkFee,
          } as any);
          // fetch job to get inscriptionId
          const job = await convex.query(api.jobs.getJob, { jobId: jobRes.jobId });
          if (job?.status === 'failed' && job.error) {
            throw new Error(job.error);
          }
          const inscriptionId = job?.inscriptionIds?.[0];
          if (!inscriptionId) throw new Error('Mint job completed without inscription id');

          setMintResults((prev) => [...prev, { tokenId, status: 'minted', inscriptionId }]);
          await convex.mutation(api.collectionClaims.finalizeToken, {
            collectionSlug: collection.slug,
            tokenId,
            claimId: reservation.claimId,
            address: wallet.address,
            inscriptionId,
            txid: undefined,
            success: true,
            batchId: newBatchId,
          } as any);
        } catch (err: any) {
          const msg = err?.message || String(err);
          setMintResults((prev) => [...prev, { tokenId, status: 'failed', error: msg }]);
          const normalizedMsg = msg.toLowerCase();
          if (normalizedMsg.includes('previous mint is still pending')) {
            setUtxoWarning((current) =>
              current ??
              'All spendable UTXOs from your wallet are already tied up in pending mints. Wait for the earlier transactions to confirm (≈1 minute) or split your balance into more UTXOs, then try again. The failed tokens will return to the pool once their reservation expires.'
            );
          }
          await convex.mutation(api.collectionClaims.finalizeToken, {
            collectionSlug: collection.slug,
            tokenId,
            claimId: reservation.claimId,
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
      await refreshClaimedTokens();
      setPendingReservations([]);
      setPendingPayloads([]);
      setBatchId(null);
    } catch (e: any) {
      console.error('Mint failed:', e);
      setError(e?.message || String(e));
    } finally {
      setClaiming(false);
      setMinting(false);
    }
  };

  const handleImageError = (img: HTMLImageElement, urls: string[], tokenKey: string) => {
    const currentIndex = Number(img.dataset.index || '0');
    const nextIndex = currentIndex + 1;
    if (nextIndex < urls.length) {
      img.dataset.index = String(nextIndex);
      img.src = urls[nextIndex];
      setClaimedImageLoaded((prev) => ({ ...prev, [tokenKey]: false }));
      setClaimedImageError((prev) => ({ ...prev, [tokenKey]: false }));
    } else {
      img.onerror = null;
      setClaimedImageError((prev) => ({ ...prev, [tokenKey]: true }));
    }
  };

  const handleTokenClick = async (token: ClaimedToken) => {
    setSelectedToken(token);
    setShowCodeForToken((prev) => ({ ...prev, [token.tokenId]: false }));
    try {
      const metadata = await fetchCollectionMetadata(collection, token.tokenId);
      setSelectedTokenMetadata(metadata);
    } catch (err) {
      console.error('Failed to load metadata for modal', err);
      setSelectedTokenMetadata(null);
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
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight leading-tight">{collection.name} Claim</h1>
              {collection.supply ? (
                <span className="text-xs sm:text-sm text-gold-300/80 border border-gold-500/30 rounded-full px-2 sm:px-3 py-1">
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

        {/* Onchain Stats */}
        <div className="glass-card p-6 border border-gold-500/20 rounded-sm mb-6">
          <h2 className="text-xl font-semibold mb-4">Collection Stats (Onchain)</h2>
          {loadingOnchain ? (
            <div className="text-sm text-gold-200/70">Loading onchain data...</div>
          ) : (onchainStats.collection && typeof onchainStats.collection.minted === 'number' && onchainStats.collection.supply) ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="bg-black/40 border border-gold-500/10 rounded p-4">
                <div className="text-xs text-gold-200/60 uppercase tracking-wider mb-1">Total Supply</div>
                <div className="text-2xl font-bold text-gold-100">{Number(onchainStats.collection.supply).toLocaleString()}</div>
              </div>
              <div className="bg-black/40 border border-gold-500/10 rounded p-4">
                <div className="text-xs text-gold-200/60 uppercase tracking-wider mb-1">Minted</div>
                <div className="text-2xl font-bold text-gold-100">{onchainStats.collection.minted.toLocaleString()}</div>
              </div>
              <div className="bg-black/40 border border-gold-500/10 rounded p-4">
                <div className="text-xs text-gold-200/60 uppercase tracking-wider mb-1">Progress</div>
                <div className="text-2xl font-bold text-gold-100">
                  {((onchainStats.collection.minted / Number(onchainStats.collection.supply)) * 100).toFixed(1)}%
                </div>
              </div>
            </div>
          ) : (
            <div className="text-sm text-red-300">Failed to load onchain data</div>
          )}
        </div>

        <div className="glass-card p-6 border border-gold-500/20 rounded-sm mb-6">
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
            </div>
          )}
          {!allocation && wallet?.address && !statusLoading && !error && (
            <div className="mt-4 text-sm text-red-300">
              This wallet is not in the whitelist for this collection.
            </div>
          )}
          {statusLoading && (
            <div className="mt-4 text-sm text-gold-200/70">Checking allocation...</div>
          )}
          {error && (
            <div className="mt-4 text-sm text-red-300">Error: {error}</div>
          )}
        </div>

        {/* Claim Paused Notice */}
        <div className="glass-card p-6 border border-gold-500/20 rounded-sm mb-6 bg-amber-500/5">
          <div className="flex items-start gap-4">
            <div className="text-3xl">ℹ️</div>
            <div className="flex-1 space-y-3">
              <h2 className="text-xl font-bold text-gold-100">Claim System Paused</h2>
              <p className="text-gold-200/80">
                The {collection.name} claim system has been temporarily paused. We have transitioned to using the onchain ZRC-721 index
                for displaying all minted tokens. This provides a more reliable and decentralized source of truth.
              </p>
              <p className="text-gold-200/80">

              </p>
            </div>
          </div>
        </div>

        {false && wallet?.address && !statusLoading && allocation && availableToRequest > 0 && (
          <div className="glass-card p-6 border border-gold-500/20 rounded-sm">
            <div className="flex items-center justify-between gap-3 mb-4">
              <h2 className="text-lg sm:text-xl font-semibold">Claim</h2>
            </div>

            <div className="flex flex-col gap-3 mb-4">
              <div className="text-sm text-gold-200/70 leading-tight">
                Remaining allocation: <span className="font-semibold text-gold-100">{remainingAllowlist}</span>
              </div>
              {reservedPending > 0 && (
                <div className="text-xs text-gold-200/60 leading-tight">
                  Pending reservations: <span className="font-semibold text-gold-100">{reservedPending}</span>
                </div>
              )}
              <label className="flex items-center gap-3 text-sm">
                <span>Batch Inscribe (max 5)</span>
                <input
                  type="number"
                  min={1}
                  max={maxBatchSize}
                  value={claimCount}
                  onChange={(e) => setClaimCount(Math.max(1, Math.min(maxBatchSize, Number(e.target.value) || 1)))}
                  className="bg-black/30 border border-gold-500/30 rounded px-3 py-2 w-24 text-gold-100 text-base sm:text-sm"
                  disabled={claiming || availableToRequest <= 0}
                />
              </label>
              <button
                className="px-5 sm:px-6 py-3 rounded-sm bg-gold-500 text-black font-bold hover:bg-gold-400 disabled:opacity-50 disabled:cursor-not-allowed text-sm sm:text-base"
                disabled={claiming || availableToRequest <= 0}
                onClick={handleClaim}
              >
                {claiming ? 'Minting...' : `Claim ${Math.min(claimCount, maxBatchSize)} ZGODS`}
              </button>
              {error && <div className="text-sm text-red-300">{error}</div>}
            </div>

            {mintResults.length > 0 && (
              <div className="mt-6">
                <div className="text-sm text-gold-200/70 mb-2">Mint results</div>
                <div className="grid gap-2">
                  {mintResults.map((r, idx) => (
                    <div key={`mint-${r.tokenId}-${idx}`} className="p-3 rounded border border-gold-500/20 bg-black/40 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                      <div className="text-gold-100 font-semibold">Mint ID #{r.tokenId}</div>
                      <div className="text-xs text-gold-200/70">
                        {r.status === 'minted' ? (
                          <>
                            Minted{' '}
                            {r.inscriptionId ? (
                              <span className="text-gold-300 font-mono text-[10px]">
                                {r.inscriptionId}
                              </span>
                            ) : null}
                          </>
                        ) : (
                          <span className="text-red-300">Failed{r.error ? `: ${r.error}` : ''}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {utxoWarning && (
                  <div className="mt-3 rounded-sm border border-amber-400/40 bg-amber-500/5 px-4 py-3 text-sm text-amber-200 space-y-2">
                    <p>{utxoWarning}</p>
                    <p className="text-amber-100/90">
                      Need fresh UTXOs? Use the
                      {' '}
                      <Link href="/inscribe?tab=utxo" className="underline font-semibold">
                        Inscribe → UTXO manager
                      </Link>
                      {' '}dialog to split a large coin into multiple smaller ones before retrying.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
        {false && wallet?.address && !statusLoading && allocation && availableToRequest <= 0 && (
          <div className="glass-card p-6 border border-gold-500/20 rounded-sm">
            <h2 className="text-lg sm:text-xl font-semibold mb-2">Allocation complete</h2>
            <p className="text-sm text-gold-200/70">You have already claimed your full allocation for this collection. Thank you!</p>
          </div>
        )}

        <div className="glass-card p-6 border border-gold-500/20 rounded-sm mt-6">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h3 className="text-xl font-semibold">My {collection.name} (Onchain)</h3>
            </div>
            {onchainStats.userTokenCount > 0 && (
              <span className="text-xs sm:text-sm text-gold-200/80 border border-gold-500/20 rounded-full px-2 sm:px-3 py-1 whitespace-nowrap">
                {onchainStats.userTokenCount} Owned
              </span>
            )}
          </div>

          {loadingClaims ? (
            <div className="grid grid-cols-5 gap-4">
              {Array.from({ length: 10 }).map((_, idx) => (
                <div
                  key={`skeleton-${idx}`}
                  className="p-3 rounded border border-gold-500/10 bg-black/40 animate-pulse h-full"
                >
                  <div className="aspect-square rounded bg-gold-500/10 mb-3" />
                  <div className="h-3 bg-gold-500/10 rounded w-2/3 mb-2" />
                  <div className="h-2 bg-gold-500/10 rounded w-1/2" />
                </div>
              ))}
            </div>
          ) : !wallet?.address ? (
            <div className="text-sm text-gold-200/70">Connect your wallet to see claimed tokens.</div>
          ) : claimedTokens.length === 0 ? (
            <div className="text-sm text-gold-200/70">No claims yet. Mint to reveal your artwork.</div>
          ) : (
            <div className="grid grid-cols-5 gap-4">
              {claimedTokens.map((token) => (
                <div
                  key={token.tokenId}
                  className="p-3 rounded border border-gold-500/20 bg-black/40 flex flex-col gap-3 cursor-pointer hover:border-gold-400/60 transition-all"
                  onClick={() => handleTokenClick(token)}
                >
                  <div className="relative aspect-square overflow-hidden rounded border border-gold-500/10 bg-black/60 flex items-center justify-center">
                    {token.imageUrls.length ? (
                      <>
                        {!claimedImageLoaded[String(token.tokenId)] && !claimedImageError[String(token.tokenId)] && (
                          <div className="absolute inset-0 bg-black/30 skeleton" />
                        )}
                        <img
                          src={token.imageUrls[0]}
                          data-index={0}
                          onLoad={() => setClaimedImageLoaded((prev) => ({ ...prev, [String(token.tokenId)]: true }))}
                          onError={(e) => handleImageError(e.currentTarget, token.imageUrls, String(token.tokenId))}
                          alt={token.name}
                          className={`w-full h-full object-cover transition-opacity duration-300 ${claimedImageLoaded[String(token.tokenId)] ? 'opacity-100' : 'opacity-0'}`}
                        />
                      </>
                    ) : (
                      <div className="text-xs text-gold-200/60">Image unavailable</div>
                    )}
                  </div>
                  <div className="space-y-1">
                    <div className="font-semibold text-gold-100 text-xs">{token.name}</div>
                    <div className="text-[10px] text-gold-200/70">#{token.tokenId.toLocaleString()}</div>
                  </div>
                </div>
              ))}
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

        {/* Token Detail Modal */}
        {selectedToken && (
          <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[60] p-4 md:p-6 overflow-y-auto">
            <div className="backdrop-blur-xl bg-black/40 border border-gold-500/30 rounded max-w-5xl w-full p-4 md:p-8 my-8">
              <div className="flex items-start justify-between mb-4 md:mb-6">
                <div>
                  <h3 className="text-xl md:text-2xl font-bold text-gold-300 mb-2">{selectedToken.name}</h3>
                  <div className="text-sm text-gold-200/70">#{selectedToken.tokenId.toLocaleString()}</div>
                </div>
                <button
                  onClick={() => {
                    setSelectedToken(null);
                    setSelectedTokenMetadata(null);
                    setShowCodeForToken({});
                  }}
                  className="text-gold-400 hover:text-gold-300 text-2xl"
                >
                  ×
                </button>
              </div>

              {/* Two-column layout: Art left, Details right */}
              <div className="flex flex-col md:flex-row gap-4 md:gap-6">
                {/* Left: Artwork / Code Display */}
                <div className="w-full md:w-1/2">
                  <div className="relative aspect-square overflow-hidden rounded border border-gold-500/20 bg-black/60">
                    <button
                      type="button"
                      onClick={() => setShowCodeForToken((prev) => ({ ...prev, [selectedToken.tokenId]: !prev[selectedToken.tokenId] }))}
                      className="absolute top-3 right-3 z-10 text-[10px] uppercase tracking-[0.1em] px-3 py-1 bg-black/70 border border-gold-500/40 text-gold-100 hover:border-gold-300 transition"
                    >
                      {showCodeForToken[selectedToken.tokenId] ? 'View Artwork' : 'View Code'}
                    </button>

                    {showCodeForToken[selectedToken.tokenId] ? (
                      <pre className="absolute inset-0 m-0 p-4 text-[11px] leading-tight text-gold-100/80 bg-black/80 overflow-auto">
                        {JSON.stringify({
                          p: 'zrc-721',
                          op: 'mint',
                          collection: collection.name.toUpperCase(),
                          id: String(selectedToken.tokenId),
                        }, null, 2)}
                      </pre>
                    ) : selectedToken.imageUrls.length ? (
                      <img
                        src={selectedToken.imageUrls[0]}
                        alt={selectedToken.name}
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <div className="absolute inset-0 flex items-center justify-center text-gold-200/60">
                        Image unavailable
                      </div>
                    )}
                  </div>
                </div>

                {/* Right: Inscription ID + Traits */}
                <div className="w-full md:w-1/2 flex flex-col gap-4">
                  {/* Inscription ID */}
                  {selectedToken.inscriptionId && (
                    <div>
                      <div className="text-xs text-gold-200/60 uppercase tracking-wider mb-2">Inscription ID</div>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(selectedToken.inscriptionId!);
                          setCopiedInscription(selectedToken.inscriptionId ?? null);
                          setTimeout(() => setCopiedInscription(null), 2000);
                        }}
                        className="w-full text-left bg-black/40 p-3 rounded border border-gold-500/20 hover:border-gold-500/40 transition-all"
                      >
                        <span className="text-sm text-gold-300 font-mono break-all">
                          {copiedInscription === selectedToken.inscriptionId ? '✓ Copied!' : selectedToken.inscriptionId}
                        </span>
                      </button>
                    </div>
                  )}

                  {/* Traits */}
                  {selectedTokenMetadata?.attributes && selectedTokenMetadata.attributes.length > 0 && (
                    <div className="bg-black/20 backdrop-blur-sm rounded border border-gold-500/10 p-4 space-y-4 flex-1">
                      <div className="text-xs text-gold-200/60 uppercase tracking-wider">Traits</div>
                      <div className="grid grid-cols-1 gap-3 max-h-[400px] overflow-y-auto">
                        {selectedTokenMetadata.attributes
                          .filter((attr: any) => Boolean(attr?.trait_type) && attr?.value !== undefined && attr?.value !== null)
                          .map((trait: any, idx: number) => (
                            <div key={`${trait.trait_type}-${idx}`} className="bg-black/30 border border-gold-500/10 rounded p-3">
                              <div className="text-xs text-gold-200/60 uppercase tracking-wider mb-1">{trait.trait_type}</div>
                              <div className="text-sm font-semibold text-gold-100/80">{String(trait.value)}</div>
                            </div>
                          ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
