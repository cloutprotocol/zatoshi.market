'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAction } from 'convex/react';
import { api } from '../../../../convex/_generated/api';
import dynamic from 'next/dynamic';

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
  const [parseFromChain, setParseFromChain] = useState(false);
  const parseInscription = useAction(api.inscriptionParser.parseInscriptionFromChain);

  useEffect(() => {
    async function fetchInscription() {
      try {
        setLoading(true);
        setError(null);

        // Fetch metadata from Zerdinals indexer
        const metaResponse = await fetch(`https://indexer.zerdinals.com/inscription/${inscriptionId}`);

        if (!metaResponse.ok) {
          throw new Error(`Failed to fetch inscription: ${metaResponse.status}`);
        }

        const metaJson = await metaResponse.json();
        const data = metaJson.data || metaJson;

        // Extract inscription metadata
        const contentType = data.contentType || data.content_type || 'text/plain';

        setInscription({
          id: inscriptionId,
          contentType,
          number: data.inscriptionNumber || data.number || data.inscription_number,
          address: data.owner || data.address,
          timestamp: data.time || data.timestamp || data.created_at,
          block: data.block,
          txid: data.txid
        });

        // Fetch content based on type
        const contentResponse = await fetch(`https://indexer.zerdinals.com/content/${inscriptionId}`);

        if (contentType.startsWith('image/')) {
          // For images, fetch as blob and create object URL
          // (Zerdinals API has broken content-type headers, so we override it)
          if (contentResponse.ok) {
            try {
              const arrayBuffer = await contentResponse.arrayBuffer();
              const bytes = new Uint8Array(arrayBuffer);

              console.log('Image loaded from Zerdinals:', {
                size: arrayBuffer.byteLength,
                contentType
              });

              // Detect truncated/chunked inscriptions (exactly 520 bytes likely means first chunk only)
              if (bytes.length === 520 && !parseFromChain) {
                console.log('Detected potential chunked inscription (520 bytes), parsing from chain...');
                setParseFromChain(true);

                // Parse full content from blockchain
                try {
                  const parsed = await parseInscription({ inscriptionId });
                  console.log('Parsed from chain:', {
                    size: parsed.size,
                    chunks: parsed.chunks,
                    contentType: parsed.contentType
                  });

                  // Decode base64 and create object URL
                  const decodedBytes = Uint8Array.from(atob(parsed.content), c => c.charCodeAt(0));
                  const fullBlob = new Blob([decodedBytes], { type: parsed.contentType });
                  const fullUrl = URL.createObjectURL(fullBlob);
                  setImageData(fullUrl);
                } catch (parseErr) {
                  console.error('Chain parsing failed, using Zerdinals data:', parseErr);
                  // Fall back to potentially truncated Zerdinals data
                  const blob = new Blob([arrayBuffer], { type: contentType });
                  const objectUrl = URL.createObjectURL(blob);
                  setImageData(objectUrl);
                }
              } else {
                // Normal case: use Zerdinals data
                const blob = new Blob([arrayBuffer], { type: contentType });
                const objectUrl = URL.createObjectURL(blob);
                setImageData(objectUrl);
              }
            } catch (imgErr) {
              console.error('Error processing image data:', imgErr);
              setError('Failed to process image data');
            }
          } else {
            console.error('Content fetch failed:', contentResponse.status);
          }
        } else {
          // For non-image content, fetch as text
          if (contentResponse.ok) {
            const contentText = await contentResponse.text();
            setContent(contentText);
          }
        }
      } catch (err) {
        console.error('Error fetching inscription:', err);
        setError(err instanceof Error ? err.message : 'Failed to load inscription');
      } finally {
        setLoading(false);
      }
    }

    if (inscriptionId) {
      fetchInscription();
    }
  }, [inscriptionId]);

  const renderContent = () => {
    if (!inscription) return null;

    const { contentType } = inscription;

    // Handle images
    if (contentType.startsWith('image/')) {
      if (!imageData) {
        return (
          <div className="text-center py-8 text-gray-400">
            Loading image...
          </div>
        );
      }

      return (
        <div className="flex justify-center items-center p-4 sm:p-8 lg:p-12">
          <div className="w-full max-w-[500px] aspect-square flex items-center justify-center">
            <img
              src={imageData}
              alt={`Inscription ${inscriptionId}`}
              className="w-full h-full object-contain"
            />
          </div>
        </div>
      );
    }

    // For non-image content, we need the fetched content
    if (!content) {
      return (
        <div className="text-center py-8 text-gray-400">
          Loading content...
        </div>
      );
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
        {loading && (
          <div className="text-center py-12">
            <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gold-500"></div>
            <p className="mt-4 text-gold-200/60">Loading inscription...</p>
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
                    <div className="text-xs text-gold-200/60 uppercase tracking-wider mb-1">Zecscription</div>
                    <div className="text-3xl font-bold text-gold-300">{inscription.number.toLocaleString()}</div>
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
                  <div className="font-semibold text-sm text-gold-100/80">{formatFileType(inscription.contentType)}</div>
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
                <div className="pt-3 border-t border-gold-200/20">
                  <a
                    href={`https://zerdinals.com/zerdinals/${inscriptionId.replace('i0', '')}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-gold-400 hover:text-gold-300 text-xs inline-flex items-center gap-1"
                  >
                    View on Zerdinals Explorer →
                  </a>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
