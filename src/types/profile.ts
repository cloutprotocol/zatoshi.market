export type SocialLinks = {
  twitter?: string;
  discord?: string;
  website?: string;
};

export type UserProfileDoc = {
  _id?: string;
  address: string;
  username?: string | null;
  displayName?: string | null;
  bio?: string | null;
  socialLinks?: SocialLinks;
  pfpInscriptionId?: string | null;
  pinnedTokenIds?: string[];
  isPrivate?: boolean;
  createdAt?: number;
  updatedAt?: number;
};

export type MintedTokenSummary = {
  id: string;
  collectionSlug: string;
  collectionName: string;
  tokenId: number;
  inscriptionId?: string;
  imageUrls: string[];
  name: string;
  createdAt?: number;
  ownerAddress?: string;
};
