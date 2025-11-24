import type { CollectionConfig } from '@/config/collections';
import { IPFS_GATEWAYS } from '@/config/ipfs';

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

const buildProxyUrl = (cid: string, path: string) => {
  const params = new URLSearchParams();
  params.set('cid', cid);
  if (path) params.set('path', path.replace(/^\/+/, ''));
  return `/api/ipfs/proxy?${params.toString()}`;
};

export const buildGatewayUrl = (cid: string, path: string, gatewayIndex = 0) =>
  `${IPFS_GATEWAYS[gatewayIndex]}/${cid}/${path}`;

export function buildMetadataUrls(collection: CollectionConfig, tokenId: number) {
  const paths: string[] = [];
  // Local copy inside /public for known collections
  paths.push(`/collections/${collection.slug}/claim/metadata/${tokenId}.json`);
  if (collection.metaCid) {
    paths.push(buildProxyUrl(collection.metaCid, `${tokenId}.json`));
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
    ...(collection.imageCid ? [buildProxyUrl(collection.imageCid, `${tokenId}.png`)] : []),
    ...(collection.imageCid
      ? IPFS_GATEWAYS.map((_, idx) => buildGatewayUrl(collection.imageCid!, `${tokenId}.png`, idx))
      : []),
    fromMeta || undefined,
  ]);
  return urls;
}

export function buildTokenName(collection: CollectionConfig, tokenId: number, metadata?: CollectionTokenMetadata | null) {
  return metadata?.name || `${collection.name} ${tokenId}`;
}
