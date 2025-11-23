export const IPFS_GATEWAYS = [
  'https://dweb.link/ipfs', // Protocol Labs
  'https://ipfs.io/ipfs', // Official gateway
  '/ipfs',
] as const;

export const UPSTREAM_IPFS_GATEWAYS = IPFS_GATEWAYS.filter((url) => !url.startsWith('/'));

export const IPFS_REQUEST_TIMEOUT_MS = 8000;
