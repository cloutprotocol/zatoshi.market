'use client';

import { useParams } from 'next/navigation';
import { useEffect, useState } from 'react';

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
              // Create blob with correct content type
              const blob = new Blob([arrayBuffer], { type: contentType });
              const objectUrl = URL.createObjectURL(blob);

              console.log('Image loaded:', {
                size: arrayBuffer.byteLength,
                contentType,
                objectUrl
              });

              setImageData(objectUrl);
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
        <div className="flex justify-center p-8">
          <img
            src={imageData}
            alt={`Inscription ${inscriptionId}`}
            className="max-w-full max-h-[600px] border border-gray-700 rounded"
          />
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
          <pre className="p-4 bg-gray-900 rounded overflow-x-auto text-sm">
            {JSON.stringify(parsed, null, 2)}
          </pre>
        );
      } catch {
        return <pre className="p-4 bg-gray-900 rounded overflow-x-auto text-sm">{content}</pre>;
      }
    }

    // Handle HTML
    if (contentType === 'text/html') {
      return (
        <iframe
          srcDoc={content}
          className="w-full h-96 border border-gray-700 rounded"
          sandbox="allow-scripts"
        />
      );
    }

    // Handle SVG
    if (contentType === 'image/svg+xml') {
      return (
        <div
          className="p-8 flex justify-center"
          dangerouslySetInnerHTML={{ __html: content }}
        />
      );
    }

    // Default: plain text
    return (
      <pre className="p-4 bg-gray-900 rounded overflow-x-auto text-sm whitespace-pre-wrap">
        {content}
      </pre>
    );
  };

  return (
    <div className="min-h-screen bg-black text-white p-8">
      <div className="max-w-4xl mx-auto">
        <div className="mb-8">
          <a href="/" className="text-purple-400 hover:text-purple-300">
            ← Back to Home
          </a>
        </div>

        <div className="bg-gray-800 rounded-lg p-6">
          <h1 className="text-2xl font-bold mb-6">Inscription Details</h1>

          {loading && (
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-purple-500"></div>
              <p className="mt-4 text-gray-400">Loading inscription...</p>
            </div>
          )}

          {error && (
            <div className="bg-red-900/20 border border-red-500 rounded p-4 mb-6">
              <p className="text-red-400">{error}</p>
            </div>
          )}

          {inscription && (
            <>
              <div className="grid grid-cols-2 gap-4 mb-6 text-sm">
                <div>
                  <span className="text-gray-400">Inscription ID:</span>
                  <p className="font-mono text-xs break-all mt-1">{inscription.id}</p>
                </div>
                <div>
                  <span className="text-gray-400">Content Type:</span>
                  <p className="mt-1">{inscription.contentType}</p>
                </div>
                {inscription.number !== undefined && (
                  <div>
                    <span className="text-gray-400">Number:</span>
                    <p className="mt-1">#{inscription.number}</p>
                  </div>
                )}
                {inscription.address && (
                  <div>
                    <span className="text-gray-400">Owner:</span>
                    <p className="font-mono text-xs break-all mt-1">{inscription.address}</p>
                  </div>
                )}
              </div>

              <div className="border-t border-gray-700 pt-6">
                <h2 className="text-lg font-semibold mb-4">Content</h2>
                {renderContent()}
              </div>

              <div className="mt-6 pt-6 border-t border-gray-700">
                <a
                  href={`https://zerdinals.com/zerdinals/${inscriptionId.replace('i0', '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-purple-400 hover:text-purple-300 text-sm"
                >
                  View on Zerdinals Explorer →
                </a>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
