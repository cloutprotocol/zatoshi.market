'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAction } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import dynamic from 'next/dynamic';
import { getCollectionConfig } from '@/config/collections';
import { buildImageUrls, buildTokenName, CollectionTokenMetadata, fetchCollectionMetadata } from '@/lib/collectionAssets';
import { getConvexClient } from '@/lib/convexClient';

// Client-only Dither to avoid SSR/hydration mismatch
const Dither = dynamic(() => import('@/components/Dither'), { ssr: false, loading: () => null });

interface InscriptionData {
  id: string;
  contentType: string;
  number?: number;
  address?: string;
  timestamp?: number;
  block?: number;
  txid?: string;
}

interface ContentData {
  content: string;
}

export default function InscriptionPage() {
  const params = useParams();
  const inscriptionId = params.id as string;
  const [inscription, setInscription] = useState<InscriptionData | null>(null);
  const [content, setContent] = useState<string | null>(null);
  const [imageData, setImageData] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [waitingConfirm, setWaitingConfirm] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [parseFromChain, setParseFromChain] = useState(false);
  const [collectionToken, setCollectionToken] = useState<{ collection: string; tokenId: number } | null>(null);
  const [collectionAsset, setCollectionAsset] = useState<{
    collectionName: string;
    name: string;
    imageUrls: string[];
    metadata?: CollectionTokenMetadata | null;
  } | null>(null);
  const [loadingAsset, setLoadingAsset] = useState(false);
  const [isZrc721Payload, setIsZrc721Payload] = useState(false);
  const [collectionImageLoaded, setCollectionImageLoaded] = useState(false);
  const [collectionImageError, setCollectionImageError] = useState(false);
  const [inscriptionImageLoaded, setInscriptionImageLoaded] = useState(false);
  const [inscriptionImageError, setInscriptionImageError] = useState(false);
  const [waitingMessage, setWaitingMessage] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showRawPayload, setShowRawPayload] = useState(false);
  const parseInscription = useAction(api.inscriptionParser.parseInscriptionFromChain);

  useEffect(() => {
    const MAX_RETRIES = 20;
    let cancelled = false;

    async function fetchInscription(attempt = 0) {
      try {
        setLoading(true);
        setError(null);
        setWaitingConfirm(false);
        setParseFromChain(false);
        setCollectionToken(null);
        setCollectionAsset(null);
        setLoadingAsset(false);
        setIsZrc721Payload(false);
        setContent(null);
        setImageData(null);
        setCollectionImageLoaded(false);
        setCollectionImageError(false);
        setInscriptionImageLoaded(false);
        setInscriptionImageError(false);
        setShowRawPayload(false);
        setWaitingMessage(null);

        // Try proxy first, fallback to direct if proxy is blocked
        let metaResponse = await fetch(`/api/zerdinals/inscription/${inscriptionId}`);
        if (!metaResponse.ok && metaResponse.status === 403) {
          console.log('Proxy blocked, trying direct fetch...');
          metaResponse = await fetch(`https://indexer.zerdinals.com/inscription/${inscriptionId}`);
        }

        if (!metaResponse.ok) {
          if (attempt < MAX_RETRIES) {
            setWaitingConfirm(true);
            setLoading(false);
            setRetryCount(attempt + 1);
            setWaitingMessage('Inscription seen in mempool. Waiting for confirmation...');
            setTimeout(() => fetchInscription(attempt + 1), 60000);
            return;
          }
          throw new Error(`Failed to fetch inscription: ${metaResponse.status}`);
        }

        const metaJson = await metaResponse.json();
        const data = metaJson.data || metaJson;
        const contentType = data.contentType || data.content_type || 'text/plain';

        if (cancelled) return;
        setRetryCount(0);
        setInscription({
          id: inscriptionId,
          contentType,
          number: data.inscriptionNumber || data.number || data.inscription_number,
          address: data.owner || data.address,
          timestamp: data.time || data.timestamp || data.created_at,
          block: data.block,
          txid: data.txid
        });

        // Try proxy first, fallback to direct if proxy is blocked
        let contentResponse = await fetch(`/api/zerdinals/content/${inscriptionId}`);
        if (!contentResponse.ok && contentResponse.status === 403) {
          console.log('Content proxy blocked, trying direct fetch...');
          contentResponse = await fetch(`https://indexer.zerdinals.com/content/${inscriptionId}`);
        }

        if (contentType.startsWith('image/')) {
          if (contentResponse.ok) {
            try {
              const arrayBuffer = await contentResponse.arrayBuffer();
              const bytes = new Uint8Array(arrayBuffer);

              console.log('Image loaded from Zerdinals:', {
                size: arrayBuffer.byteLength,
                contentType
              });

              if (bytes.length === 520 && !parseFromChain) {
                console.log('Detected potential chunked inscription (520 bytes), parsing from chain...');
                setParseFromChain(true);

                try {
                  const parsed = await parseInscription({ inscriptionId });
                  console.log('Parsed from chain:', {
                    size: parsed.size,
                    chunks: parsed.chunks,
                    contentType: parsed.contentType
                  });

                  const decodedBytes = Uint8Array.from(atob(parsed.content), c => c.charCodeAt(0));
                  const fullBlob = new Blob([decodedBytes], { type: parsed.contentType });
                  const fullUrl = URL.createObjectURL(fullBlob);
                  if (cancelled) return;
                  setImageData(fullUrl);
                } catch (parseErr) {
                  console.error('Chain parsing failed, using Zerdinals data:', parseErr);
                  const blob = new Blob([arrayBuffer], { type: contentType });
                  const objectUrl = URL.createObjectURL(blob);
                  if (cancelled) return;
                  setImageData(objectUrl);
                }
              } else {
                const blob = new Blob([arrayBuffer], { type: contentType });
                const objectUrl = URL.createObjectURL(blob);
                if (cancelled) return;
                setImageData(objectUrl);
              }
              if (arrayBuffer.byteLength === 0 && attempt < MAX_RETRIES) {
                setWaitingConfirm(true);
                setLoading(false);
                setRetryCount(attempt + 1);
                setWaitingMessage('Inscription detected but content is still indexing. This can take a few minutes.');
                setTimeout(() => fetchInscription(attempt + 1), 60000);
                return;
              }
            } catch (imgErr) {
              console.error('Error processing image data:', imgErr);
              setError('Failed to process image data');
            }
          } else if (attempt < MAX_RETRIES) {
            setWaitingConfirm(true);
            setLoading(false);
            setRetryCount(attempt + 1);
            setTimeout(() => fetchInscription(attempt + 1), 60000);
            return;
          }
        } else {
          if (contentResponse.ok) {
            const contentText = await contentResponse.text();
            if (cancelled) return;

            // If the indexer returns a 404 payload body, treat as pending and retry
            try {
              const parsedMaybeError = JSON.parse(contentText);
              if (parsedMaybeError?.code === 404) {
                if (attempt < MAX_RETRIES) {
                  setWaitingConfirm(true);
                  setLoading(false);
                  setRetryCount(attempt + 1);
                  setWaitingMessage('Inscription detected but not fully indexed yet. Waiting for confirmation...');
                  setTimeout(() => fetchInscription(attempt + 1), 60000);
                  return;
                }
                setError('Inscription not yet available. Please try again later.');
                return;
              }
            } catch {
              // Not an error JSON
            }

            if (!contentText.trim() && attempt < MAX_RETRIES) {
              setWaitingConfirm(true);
              setLoading(false);
              setRetryCount(attempt + 1);
              setWaitingMessage('Inscription detected but content is still indexing. This can take a few minutes.');
              setTimeout(() => fetchInscription(attempt + 1), 60000);
              return;
            }

            setContent(contentText);
            try {
              const parsedContent = JSON.parse(contentText);
              if (parsedContent?.p === 'zrc-721' && parsedContent?.id) {
                setIsZrc721Payload(true);
                const tokenIdNum = Number(parsedContent.id);
                const slugFromPayload = String(parsedContent.collection || parsedContent.slug || parsedContent.tick || '').toLowerCase();
                if (!Number.isNaN(tokenIdNum) && slugFromPayload) {
                  setCollectionToken((prev) => prev ?? { collection: slugFromPayload, tokenId: tokenIdNum });
                }
              }
            } catch {
              // Not a JSON payload we can use for collection rendering
            }
          } else if (attempt < MAX_RETRIES) {
            setWaitingConfirm(true);
            setLoading(false);
            setRetryCount(attempt + 1);
            setTimeout(() => fetchInscription(attempt + 1), 60000);
            return;
          }
        }
      } catch (err) {
        console.error('Error fetching inscription:', err);
        setError(err instanceof Error ? err.message : 'Failed to load inscription');
      } finally {
        setLoading(false);
        setWaitingConfirm(false);
      }
    }

    if (inscriptionId) {
      fetchInscription();
    }

    return () => {
      cancelled = true;
    };
  }, [inscriptionId, parseInscription, refreshKey]);

  useEffect(() => {
    const lookupClaim = async () => {
      const convex = getConvexClient();
      if (!convex || !inscriptionId) return;
      try {
        const claim = await convex.query(api.collectionClaims.getByInscriptionId, { inscriptionId });
        if (claim?.collectionSlug && typeof claim.tokenId === 'number') {
          setCollectionToken((prev) => prev ?? { collection: claim.collectionSlug, tokenId: claim.tokenId });
        }
      } catch (err) {
        console.error('Claim lookup failed:', err);
      }
    };
    lookupClaim();
  }, [inscriptionId]);

  useEffect(() => {
    const loadCollectionAsset = async () => {
      setCollectionImageLoaded(false);
      setCollectionImageError(false);
      if (!collectionToken) {
        setCollectionAsset(null);
        setLoadingAsset(false);
        return;
      }
      const config = getCollectionConfig(collectionToken.collection);
      if (!config) {
        setCollectionAsset(null);
        setLoadingAsset(false);
        return;
      }
      setLoadingAsset(true);
      try {
        const metadata = await fetchCollectionMetadata(config, collectionToken.tokenId);
        const imageUrls = buildImageUrls(config, collectionToken.tokenId, metadata);
        setIsZrc721Payload(true);
        setCollectionAsset({
          collectionName: config.name,
          name: buildTokenName(config, collectionToken.tokenId, metadata),
          imageUrls,
          metadata,
        });
      } catch (err) {
        console.error('Failed to load collection artwork:', err);
      } finally {
        setLoadingAsset(false);
      }
    };
    loadCollectionAsset();
  }, [collectionToken]);

  const renderContent = () => {
    if (!inscription) return null;

    const { contentType } = inscription;

    if ((waitingConfirm || (!content && !imageData && !error && !loading)) && !collectionAsset) {
      return (
        <div className="p-6 sm:p-10 flex items-center justify-center bg-black/20 min-h-[300px]">
          <div className="text-center space-y-2 text-gold-200/80">
            <div className="text-lg font-semibold">Transaction not yet confirmed</div>
            <div className="text-sm text-gold-200/60">Indexing can take up to 5 minutes. We’ll refresh automatically.</div>
            <button
              onClick={() => setRefreshKey((k) => k + 1)}
              className="text-xs px-4 py-2 border border-gold-500/40 rounded text-gold-200 hover:text-gold-100 hover:border-gold-300 transition-colors"
            >
              Retry now
            </button>
          </div>
        </div>
      );
    }

    if (collectionAsset && collectionAsset.imageUrls.length) {
      return (
        <div className="flex flex-col gap-4">
          <div className="flex justify-center items-center p-4 sm:p-8 lg:p-12">
            <div className={`relative w-full max-w-[500px] aspect-square flex items-center justify-center bg-black/20 border border-gold-500/10 rounded overflow-hidden ${(!collectionImageLoaded && !collectionImageError && !showRawPayload) ? 'skeleton' : ''}`}>
              {isZrc721Payload && content && (
                <button
                  type="button"
                  onClick={() => setShowRawPayload((prev) => !prev)}
                  className="absolute top-3 right-3 z-10 text-[10px] uppercase tracking-[0.1em] px-3 py-1 bg-black/70 border border-gold-500/40 text-gold-100 hover:border-gold-300 transition"
                >
                  {showRawPayload ? 'View Artwork' : 'View Code'}
                </button>
              )}

              {showRawPayload && content ? (
                <pre className="absolute inset-0 m-0 p-4 text-[11px] leading-tight text-gold-100/80 bg-black/80 overflow-auto">
                  {(() => {
                    try {
                      return JSON.stringify(JSON.parse(content), null, 2);
                    } catch {
                      return content;
                    }
                  })()}
                </pre>
              ) : (
                <>
                  {collectionImageError && (
                    <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm text-gold-200/70">
                      Artwork unavailable
                    </div>
                  )}
                  <img
                    src={collectionAsset.imageUrls[0]}
                    data-index={0}
                    loading="lazy"
                    onLoad={() => setCollectionImageLoaded(true)}
                    onError={(e) => {
                      const nextIndex = Number(e.currentTarget.dataset.index || '0') + 1;
                      const fallback = collectionAsset.imageUrls[nextIndex];
                      if (fallback) {
                        setCollectionImageLoaded(false);
                        setCollectionImageError(false);
                        e.currentTarget.dataset.index = String(nextIndex);
                        e.currentTarget.src = fallback;
                      } else {
                        setCollectionImageError(true);
                        e.currentTarget.onerror = null;
                      }
                    }}
                    alt=""
                    className={`w-full h-full object-contain transition-opacity duration-300 ${collectionImageLoaded ? 'opacity-100' : 'opacity-0'}`}
                  />
                </>
              )}
            </div>
          </div>

          {renderTraitsSection()}
        </div>
      );
    }

    if (collectionToken && loadingAsset) {
      return (
        <div className="flex justify-center items-center p-4 sm:p-8 lg:p-12">
          <div className="w-full max-w-[500px] aspect-square bg-black/20 border border-gold-500/10 skeleton rounded" />
        </div>
      );
    }

    // Handle images
    if (contentType.startsWith('image/')) {
      if (!imageData) {
        return (
          <div className="flex justify-center items-center p-4 sm:p-8 lg:p-12">
            <div className="w-full max-w-[500px] aspect-square bg-black/20 border border-gold-500/10 skeleton rounded" />
          </div>
        );
      }

      return (
        <div className="flex justify-center items-center p-4 sm:p-8 lg:p-12">
          <div className={`relative w-full max-w-[500px] aspect-square flex items-center justify-center bg-black/20 border border-gold-500/10 rounded overflow-hidden ${(!inscriptionImageLoaded && !inscriptionImageError && !showRawPayload) ? 'skeleton' : ''}`}>
            {isZrc721Payload && content && (
              <button
                type="button"
                onClick={() => setShowRawPayload((prev) => !prev)}
                className="absolute top-3 right-3 z-10 text-[10px] uppercase tracking-[0.1em] px-3 py-1 bg-black/70 border border-gold-500/40 text-gold-100 hover:border-gold-300 transition"
              >
                {showRawPayload ? 'View Artwork' : 'View Code'}
              </button>
            )}

            {showRawPayload && content ? (
              <pre className="absolute inset-0 m-0 p-4 text-[11px] leading-tight text-gold-100/80 bg-black/80 overflow-auto">
                {(() => {
                  try {
                    return JSON.stringify(JSON.parse(content), null, 2);
                  } catch {
                    return content;
                  }
                })()}
              </pre>
            ) : (
              <>
                {inscriptionImageError && (
                  <div className="absolute inset-0 flex items-center justify-center bg-black/40 text-sm text-gold-200/70">
                    Image unavailable
                  </div>
                )}
                <img
                  src={imageData}
                  alt=""
                  loading="lazy"
                  onLoad={() => setInscriptionImageLoaded(true)}
                  onError={() => setInscriptionImageError(true)}
                  className={`w-full h-full object-contain transition-opacity duration-300 ${inscriptionImageLoaded ? 'opacity-100' : 'opacity-0'}`}
                />
              </>
            )}
          </div>
        </div>
      );
    }

    // For non-image content, we need the fetched content
    if (!content) {
      return null;
    }

    // Handle JSON
    if (contentType === 'application/json') {
      try {
        const parsed = JSON.parse(content);
        return (
          <pre className="p-4 sm:p-6 bg-black/20 overflow-x-auto text-xs sm:text-sm">
            {JSON.stringify(parsed, null, 2)}
          </pre>
        );
      } catch {
        return <pre className="p-4 sm:p-6 bg-black/20 overflow-x-auto text-xs sm:text-sm">{content}</pre>;
      }
    }

    // Handle HTML
    if (contentType === 'text/html') {
      return (
        <iframe
          srcDoc={content}
          className="w-full h-64 sm:h-96 border-0"
          sandbox="allow-scripts"
        />
      );
    }

    // Handle SVG
    if (contentType === 'image/svg+xml') {
      return (
        <div
          className="p-4 sm:p-8 flex justify-center"
          dangerouslySetInnerHTML={{ __html: content }}
        />
      );
    }

    // Default: plain text
    return (
      <pre className="p-4 sm:p-6 bg-black/20 overflow-x-auto text-xs sm:text-sm whitespace-pre-wrap">
        {content}
      </pre>
    );
  };

  const renderTraitsSection = () => {
    if (!isZrc721Payload) return null;

    const traits = (collectionAsset?.metadata?.attributes || []).filter(
      (attr) => Boolean(attr?.trait_type) && attr?.value !== undefined && attr?.value !== null
    );
    const hasTraits = traits.length > 0;
    const loadingTraits = loadingAsset && !collectionAsset?.metadata;

    if (!loadingTraits && !hasTraits) return null;

    return (
      <div className="mt-4 bg-black/20 backdrop-blur-sm rounded border border-gold-500/10 p-4 sm:p-6 space-y-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="text-xs text-gold-200/60 uppercase tracking-wider">Traits</div>
        </div>

        {loadingTraits && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {Array.from({ length: 4 }).map((_, idx) => (
              <div key={idx} className="h-20 bg-black/20 border border-gold-500/10 rounded skeleton" />
            ))}
          </div>
        )}

        {!loadingTraits && hasTraits && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {traits.map((trait, idx) => (
              <div key={`${trait.trait_type}-${idx}`} className="bg-black/30 border border-gold-500/10 rounded p-3">
                <div className="text-xs text-gold-200/60 uppercase tracking-wider mb-1">{trait.trait_type}</div>
                <div className="text-sm font-semibold text-gold-100/80">{String(trait.value)}</div>
              </div>
            ))}
          </div>
        )}

        {showRawPayload && content && (
          <pre className="bg-black/30 border border-gold-500/10 rounded p-3 text-xs text-gold-100/80 overflow-x-auto whitespace-pre-wrap">
            {(() => {
              try {
                return JSON.stringify(JSON.parse(content), null, 2);
              } catch {
                return content;
              }
            })()}
          </pre>
        )}
      </div>
    );
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
  };

  const formatDate = (timestamp?: number) => {
    if (!timestamp) return 'Unknown';
    const date = new Date(timestamp * 1000);
    return date.toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true
    });
  };

  const formatFileType = (contentType: string) => {
    const match = contentType.match(/\/(.+)$/);
    return match ? match[1].toUpperCase() : contentType.toUpperCase();
  };

  return (
    <main className="relative min-h-screen pt-20 text-gold-100">
      {/* Dither Background */}
      <div className="fixed inset-0 w-full h-full opacity-10 -z-10">
        <Dither
          waveColor={[0.8, 0.6, 0.2]}
          disableAnimation={false}
          enableMouseInteraction={true}
          mouseRadius={0.3}
          colorNum={4}
          waveAmplitude={0.15}
          waveFrequency={2}
          waveSpeed={0.03}
        />
      </div>

      {/* Subtle Grid Background */}
      <div className="fixed inset-0 -z-5" style={{
        backgroundImage: `
          linear-gradient(to right, rgba(212, 175, 55, 0.05) 1px, transparent 1px),
          linear-gradient(to bottom, rgba(212, 175, 55, 0.05) 1px, transparent 1px)
        `,
        backgroundSize: '40px 40px'
      }}></div>

      {/* Content */}
      <div className="relative z-10 container mx-auto px-4 sm:px-6 max-w-4xl py-8 sm:py-12">
        {waitingConfirm && (
          <div className="mb-6 p-4 sm:p-5 border border-gold-500/20 bg-black/40 rounded animate-pulse">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-gold-100">Transaction not yet confirmed</div>
                <div className="text-xs text-gold-200/70">
                  {waitingMessage || 'Indexing can take up to 5 minutes. We’ll refresh automatically.'}
                </div>
                <div className="text-xs text-gold-200/60 mt-1">Attempt {Math.max(1, retryCount || 1)} / 12</div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setRefreshKey((k) => k + 1)}
                  className="text-xs px-3 py-1 border border-gold-500/40 rounded text-gold-200 hover:text-gold-100 hover:border-gold-300 transition-colors"
                >
                  Retry now
                </button>
                <a
                  href={`https://dev.zatoshi.market/inscription/${inscriptionId}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-gold-300 underline"
                >
                  Open in new tab
                </a>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-900/20 border border-red-500 rounded p-4 mb-6">
            <p className="text-red-400">{error}</p>
          </div>
        )}

        {inscription && (
          <div className="flex flex-col lg:flex-row gap-4 lg:gap-6">
            {/* Left side - Content */}
            <div className="flex-1 lg:flex-[2]">
              <div className="bg-black/10 backdrop-blur-sm overflow-hidden rounded">
                {renderContent()}
              </div>
            </div>

            {/* Right side - Details */}
            <div className="w-full lg:w-80 lg:flex-shrink-0">
              <div className="bg-black/30 backdrop-blur-sm rounded border border-gold-500/10 p-4 sm:p-6 space-y-4 sm:space-y-5">
                {/* Number */}
                {inscription.number !== undefined && (
                  <div>
                    <div className="text-xs text-gold-200/60 uppercase tracking-wider mb-1">Inscription</div>
                    <div className="text-3xl font-bold text-gold-300">{inscription.number.toLocaleString()}</div>
                  </div>
                )}

                {collectionToken && (
                  <div>
                    <div className="text-xs text-gold-200/60 uppercase tracking-wider mb-1">Collection Token</div>
                    <div className="font-semibold text-sm text-gold-100/80">
                      {(collectionAsset?.collectionName || collectionToken.collection.toUpperCase())} #{collectionToken.tokenId.toLocaleString()}
                    </div>
                  </div>
                )}

                {/* ID */}
                <div>
                  <div className="text-xs text-gold-200/60 uppercase tracking-wider mb-1 flex items-center gap-2">
                    ID
                    <button
                      onClick={() => copyToClipboard(inscription.id)}
                      className="text-gold-200/40 hover:text-gold-300 transition-colors"
                      title="Copy ID"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </button>
                  </div>
                  <div className="font-mono text-xs break-all text-gold-100/80">{inscription.id}</div>
                </div>

                {/* Owner */}
                {inscription.address && (
                  <div>
                    <div className="text-xs text-gold-200/60 uppercase tracking-wider mb-1 flex items-center gap-2">
                      Owned By
                      <button
                        onClick={() => copyToClipboard(inscription.address!)}
                        className="text-gold-200/40 hover:text-gold-300 transition-colors"
                        title="Copy address"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </button>
                    </div>
                    <div className="font-mono text-xs break-all text-gold-100/80">{inscription.address}</div>
                  </div>
                )}

                {/* File Type */}
                <div>
                  <div className="text-xs text-gold-200/60 uppercase tracking-wider mb-1">File Type</div>
                  <div className="font-semibold text-sm text-gold-100/80 space-y-1">
                    <div>{formatFileType(inscription.contentType)}</div>
                    {isZrc721Payload && (
                      <div className="pt-1">ZRC-721</div>
                    )}
                  </div>
                </div>

                {/* Created On */}
                {inscription.timestamp && (
                  <div>
                    <div className="text-xs text-gold-200/60 uppercase tracking-wider mb-1">Created On</div>
                    <div className="font-semibold text-sm text-gold-100/80">{formatDate(inscription.timestamp)}</div>
                  </div>
                )}

                {/* Creation Block */}
                {inscription.block && (
                  <div>
                    <div className="text-xs text-gold-200/60 uppercase tracking-wider mb-1">Creation Block</div>
                    <div className="font-semibold text-sm text-gold-100/80">{inscription.block.toLocaleString()}</div>
                  </div>
                )}

                {/* Location */}
                <div>
                  <div className="text-xs text-gold-200/60 uppercase tracking-wider mb-1 flex items-center gap-2">
                    Location
                    <button
                      onClick={() => copyToClipboard(`${inscription.txid}:0`)}
                      className="text-gold-200/40 hover:text-gold-300 transition-colors"
                      title="Copy location"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </button>
                  </div>
                  <div className="font-mono text-xs break-all text-gold-100/80">{inscription.txid}:0</div>
                </div>

                {/* Offset */}
                <div>
                  <div className="text-xs text-gold-200/60 uppercase tracking-wider mb-1">Offset</div>
                  <div className="font-semibold text-sm text-gold-100/80">0</div>
                </div>

                {/* Creation TXID */}
                {inscription.txid && (
                  <div>
                    <div className="text-xs text-gold-200/60 uppercase tracking-wider mb-1 flex items-center gap-2">
                      Creation TXID
                      <button
                        onClick={() => copyToClipboard(inscription.txid!)}
                        className="text-gold-200/40 hover:text-gold-300 transition-colors"
                        title="Copy TXID"
                      >
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                        </svg>
                      </button>
                    </div>
                    <div className="font-mono text-xs break-all text-gold-100/80">{inscription.txid}</div>
                  </div>
                )}

                {/* View on Explorer */}
                {/* <div className="pt-3 border-t border-gold-200/20">
                  <a
                    href={`https://zerdinals.com/zerdinals/${inscriptionId.replace('i0', '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gold-400 hover:text-gold-300 text-xs inline-flex items-center gap-1"
                  >
                    View on Zerdinals Explorer →
                  </a>
                </div> */}
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
