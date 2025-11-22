import zgods from "./whitelists/zgods.json";

type AllowlistEntry = { max: number; isVip?: boolean };

const ALLOWLISTS: Record<string, Record<string, AllowlistEntry>> = {
  zgods: zgods as Record<string, AllowlistEntry>,
};

export function getAllowlistEntry(collectionSlug: string, address: string): AllowlistEntry | null {
  const list = ALLOWLISTS[collectionSlug.toLowerCase()];
  if (!list) return null;
  return list[address.toLowerCase()] ?? null;
}
