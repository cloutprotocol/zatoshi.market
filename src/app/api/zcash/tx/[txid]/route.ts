import { NextResponse } from 'next/server';

export const runtime = 'edge';

// Cache raw transactions for 5 minutes (transactions are immutable once confirmed)
// Used during inscription building to fetch UTXOs for signing
const txCache = new Map<string, { raw: string; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

async function fetchFromBlockchair(txid: string): Promise<string | null> {
  try {
    const url = `https://api.blockchair.com/zcash/raw/transaction/${txid}`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) return null;
    const json = await res.json();
    // Blockchair typically returns { data: { [txid]: { raw_transaction: '...' } } }
    const raw = json?.data?.[txid]?.raw_transaction;
    return typeof raw === 'string' ? raw : null;
  } catch {
    return null;
  }
}

async function fetchFromSoChain(txid: string): Promise<string | null> {
  try {
    const url = `https://sochain.com/api/v2/get_tx/zec/${txid}`;
    const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!res.ok) return null;
    const json = await res.json();
    const raw = json?.data?.tx_hex;
    return typeof raw === 'string' ? raw : null;
  } catch {
    return null;
  }
}

export async function GET(_request: Request, { params }: { params: { txid: string } }) {
  const txid = params.txid;
  if (!txid || typeof txid !== 'string') {
    return NextResponse.json({ error: 'Invalid txid' }, { status: 400 });
  }

  // Check cache first
  const cached = txCache.get(txid);
  if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
    return NextResponse.json({ raw: cached.raw });
  }

  const rawFromBlockchair = await fetchFromBlockchair(txid);
  if (rawFromBlockchair) {
    // Update cache
    txCache.set(txid, { raw: rawFromBlockchair, timestamp: Date.now() });

    // Clean old cache entries (keep last 100 transactions)
    if (txCache.size > 100) {
      const firstKey = txCache.keys().next().value;
      txCache.delete(firstKey);
    }

    return NextResponse.json({ raw: rawFromBlockchair });
  }

  const rawFromSoChain = await fetchFromSoChain(txid);
  if (rawFromSoChain) {
    // Update cache
    txCache.set(txid, { raw: rawFromSoChain, timestamp: Date.now() });

    // Clean old cache entries (keep last 100 transactions)
    if (txCache.size > 100) {
      const firstKey = txCache.keys().next().value;
      txCache.delete(firstKey);
    }

    return NextResponse.json({ raw: rawFromSoChain });
  }

  return NextResponse.json({ error: 'Transaction not found from providers' }, { status: 404 });
}

