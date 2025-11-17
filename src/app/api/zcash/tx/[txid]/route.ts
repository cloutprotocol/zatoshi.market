import { NextResponse } from 'next/server';

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

  const rawFromBlockchair = await fetchFromBlockchair(txid);
  if (rawFromBlockchair) {
    return NextResponse.json({ raw: rawFromBlockchair });
  }

  const rawFromSoChain = await fetchFromSoChain(txid);
  if (rawFromSoChain) {
    return NextResponse.json({ raw: rawFromSoChain });
  }

  return NextResponse.json({ error: 'Transaction not found from providers' }, { status: 404 });
}

