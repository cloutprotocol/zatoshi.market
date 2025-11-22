import type { CollectionConfig } from '@/config/collections';

export const IPFS_GATEWAYS = [
  'https://ipfs.io/ipfs',
  'https://cloudflare-ipfs.com/ipfs',
  'https://dweb.link/ipfs',
  'https://zatoshi.market/ipfs',
] as const;

export type CollectionTokenMetadata = {
  name?: string;
  description?: string;
  img?: string;
  image?: string;
  attributes?: { trait_type?: string; value?: string }[];
  [key: string]: unknown;
};

const uniqueList = (items: (string | null | undefined)[]) =>
  Array.from(new Set(items.filter(Boolean) as string[]));

export const buildGatewayUrl = (cid: string, path: string, gatewayIndex = 0) =>
  `${IPFS_GATEWAYS[gatewayIndex]}/${cid}/${path}`;

export function buildMetadataUrls(collection: CollectionConfig, tokenId: number) {
  const paths: string[] = [];
  // Local copy inside /public for known collections
  paths.push(`/collections/${collection.slug}/claim/metadata/${tokenId}.json`);
  if (collection.metaCid) {
    IPFS_GATEWAYS.forEach((_, idx) => {
      paths.push(buildGatewayUrl(collection.metaCid!, `${tokenId}.json`, idx));
    });
  }
  return uniqueList(paths);
}

export async function fetchCollectionMetadata(collection: CollectionConfig, tokenId: number) {
  const urls = buildMetadataUrls(collection, tokenId);
  let lastError: unknown;
  for (const url of urls) {
    try {
      const res = await fetch(url, { cache: 'force-cache' });
      if (!res.ok) continue;
      const json = (await res.json()) as CollectionTokenMetadata;
      return json;
    } catch (err) {
      lastError = err;
    }
  }
  if (lastError) {
    console.warn(`Metadata fetch failed for ${collection.slug} #${tokenId}`, lastError);
  }
  return null;
}

export function buildImageUrls(
  collection: CollectionConfig,
  tokenId: number,
  metadata?: CollectionTokenMetadata | null
) {
  const fromMeta = metadata?.img || (typeof metadata?.image === 'string' ? (metadata.image as string) : undefined);
  const urls = uniqueList([
    fromMeta || undefined,
    ...(collection.imageCid
      ? IPFS_GATEWAYS.map((_, idx) => buildGatewayUrl(collection.imageCid!, `${tokenId}.png`, idx))
      : []),
  ]);
  return urls;
}

export function buildTokenName(collection: CollectionConfig, tokenId: number, metadata?: CollectionTokenMetadata | null) {
  return metadata?.name || `${collection.name} ${tokenId}`;
}
