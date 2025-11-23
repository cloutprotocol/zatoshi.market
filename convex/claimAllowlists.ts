import zgods from "./whitelists/zgods.json";

export type AllowlistEntry = { max: number; isVip?: boolean };

const ALLOWLISTS: Record<string, Record<string, AllowlistEntry>> = {
  zgods: zgods as Record<string, AllowlistEntry>,
};

export function getAllowlistEntry(collectionSlug: string, address: string): AllowlistEntry | null {
  const list = ALLOWLISTS[collectionSlug.toLowerCase()];
  if (!list) return null;
  return list[address.toLowerCase()] ?? null;
}

export function getAllowlistEntries(collectionSlug: string): Array<{
  address: string;
  max: number;
  isVip?: boolean;
}> {
  const list = ALLOWLISTS[collectionSlug.toLowerCase()];
  if (!list) return [];
  return Object.entries(list).map(([address, entry]) => ({
    address,
    max: entry.max,
    isVip: entry.isVip,
  }));
}
