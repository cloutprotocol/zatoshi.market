export type CollectionConfig = {
  slug: string;
  name: string;
  description?: string;
  supply?: number;
  metaCid?: string;
  imageCid?: string;
  claimWhitelistPath?: string;
  themeColor?: string;
};

export const collections: Record<string, CollectionConfig> = {
  zgods: {
    slug: "zgods",
    name: "ZGODS",
    description:
      "Official PFP collection of the $ZERO ZRC20 Community.",
    supply: 10000,
    metaCid: "bafybeicqjqzixdtawkbcuyaagrmk3vyfweidwzb6hwbucadhoxoe2pd3qm",
    imageCid: "bafybeiaqmceddfi4y3dyqwepjs6go477x35ypaojwgegcsee2vgy63yobq",
    claimWhitelistPath: "/collections/zgods/claim/whitelist.csv",
    themeColor: "#0b0b0b",
  },
};

export function getCollectionConfig(slug: string): CollectionConfig | null {
  return collections[slug.toLowerCase()] ?? null;
}
