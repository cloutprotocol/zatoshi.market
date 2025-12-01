import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'nodejs';
import { callZcashRPC } from '../../rpcHelper';

const ORDINAL_INDEX_BASE =
  process.env.ORDINAL_INDEX_API_BASE?.replace(/\/$/, '') ||
  process.env.NEXT_PUBLIC_ORDINAL_INDEX_API?.replace(/\/$/, '') ||
  'http://135.181.6.234:3333';

/**
 * Zcash Inscriptions Lookup API
 *
 * Fetches all inscriptions owned by a Zcash address using Zatoshi RPC.
 * Used to identify inscribed UTXOs that must not be spent in regular transactions.
 */

// Cache inscriptions for 30 seconds
const inscriptionCache = new Map<string, { data: any; timestamp: number }>();
const CACHE_DURATION = 30 * 1000; // 30 seconds

export async function GET(
  request: NextRequest,
  { params }: { params: { address: string } }
) {
  const { address } = params;

  // Check if refresh is requested (bypass cache)
  const searchParams = request.nextUrl.searchParams;
  const forceRefresh = searchParams.get('refresh') === 'true';

  try {
    // Check cache first (unless force refresh)
    if (!forceRefresh) {
      const cached = inscriptionCache.get(address);
      if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
        return NextResponse.json(cached.data);
      }
    }

    const fallbackResult = await fetchRpcInscriptions(address);
    inscriptionCache.set(address, { data: fallbackResult, timestamp: Date.now() });
    trimCache();
    return NextResponse.json(fallbackResult);

  } catch (error) {
    console.error('Inscription lookup error:', error);
    return NextResponse.json({
      inscribedLocations: [],
      count: 0,
      inscriptions: [],
      error: error instanceof Error ? error.message : 'Failed to fetch inscriptions'
    });
  }
}

async function fetchRpcInscriptions(address: string) {
  // Step 1: Fetch confirmed UTXOs for this address
  const utxos = await callZcashRPC('getaddressutxos', [{ addresses: [address] }]);

  if (!Array.isArray(utxos)) {
    return { inscribedLocations: [], count: 0, inscriptions: [] };
  }

  // Step 2: Check each UTXO for inscriptions by location (confirmed)
  const inscriptions: any[] = [];
  const inscribedLocations: string[] = [];

  await Promise.all(
    utxos.map(async (utxo: any) => {
      if (utxo.outputIndex !== 0) return;
      const location = `${utxo.txid}:${utxo.outputIndex}`;
      const inscriptionId = `${utxo.txid}i0`;
      const indexerData = await fetchTransferFromIndexer(inscriptionId);
      if (indexerData) {
        inscribedLocations.push(indexerData.location || location);
        inscriptions.push(indexerData);
        return;
      }
      const hasOrd = await hasOrdinalReveal(utxo.txid);
      if (hasOrd) {
        inscribedLocations.push(location);
        inscriptions.push({
          id: inscriptionId,
          txid: utxo.txid,
          vout: utxo.outputIndex,
          source: 'rpc',
        });
      }
    })
  );

  try {
    const mem = await callZcashRPC('getaddressmempool', [{ addresses: [address] }]);
    const memList: any[] = Array.isArray(mem) ? mem : [];
    for (const m of memList) {
      try {
        const txid = m?.txid || m?.txId || m?.txID;
        const vout = typeof m?.index === 'number' ? m.index : (typeof m?.outputIndex === 'number' ? m.outputIndex : 0);
        if (!txid || vout !== 0) continue;
        const inscriptionId = `${txid}i0`;
        const indexerData = await fetchTransferFromIndexer(inscriptionId);
        if (indexerData) {
          const location = indexerData.location || `${txid}:0`;
          if (!inscribedLocations.includes(location)) inscribedLocations.push(location);
          if (!inscriptions.some((i) => i.id === indexerData.id)) inscriptions.push(indexerData);
          continue;
        }
        const hasOrd = await hasOrdinalReveal(txid);
        if (!hasOrd) continue;
        const location = `${txid}:0`;
        if (!inscribedLocations.includes(location)) inscribedLocations.push(location);
        const exists = inscriptions.some((i) => i.id === inscriptionId);
        if (!exists) inscriptions.push({ id: inscriptionId, txid, vout: 0, pending: true, source: 'rpc' });
      } catch (e) {}
    }
  } catch (e) {}

  return {
    inscribedLocations,
    count: inscriptions.length,
    inscriptions,
    source: 'rpc',
  };
}

async function hasOrdinalReveal(txid: string) {
  try {
    const tx = await callZcashRPC('getrawtransaction', [txid, 1]);
    const vins = tx?.vin || [];
    return vins.some((vin: any) => {
      const hex: string = vin?.scriptSig?.hex || '';
      return typeof hex === 'string' && hex.toLowerCase().includes('6f7264');
    });
  } catch (err) {
    console.error(`Failed to inspect tx ${txid}:`, err);
    return false;
  }
}

async function fetchTransferFromIndexer(inscriptionId: string) {
  try {
    const res = await fetch(`${ORDINAL_INDEX_BASE}/api/v1/zrc20/transfer/${inscriptionId}`, {
      headers: { 'User-Agent': 'zatoshi.market/inscriptions' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const tf: any = await res.json();

    // Fetch token info to get decimals
    const tick = (tf?.transfer?.tick || tf?.tick || '').toString().toLowerCase();
    if (tick) {
      try {
        const tokenUrl = `${ORDINAL_INDEX_BASE}/api/v1/zrc20/token/${tick}`;
        const tokenRes = await fetch(tokenUrl, {
          headers: { 'User-Agent': 'zatoshi.market/inscriptions' },
          cache: 'no-store',
        });
        if (tokenRes.ok) {
          const tokenInfo = await tokenRes.json();
          if (tokenInfo?.dec) {
            tf.dec = parseInt(tokenInfo.dec, 10);
          }
        }
      } catch (e) {
        // Token info fetch failed, continue without decimals
      }
    }

    return normalizeIndexerTransfer(tf, inscriptionId);
  } catch (err) {
    return null;
  }
}

function normalizeIndexerTransfer(record: any, fallbackId: string) {
  if (!record) return null;
  const id = record.id || record.inscription_id || fallbackId;
  const location = record.outpoint || record.location || record.output || `${record.reveal_txid || record.txid}:0`;
  const tick = (record.transfer?.tick || record.tick || record.ticker || record.symbol || '').toString().toUpperCase();
  if (!location || !tick) return null;

  const decimals = parseDecimals(record.dec ?? record.decimals ?? record.transfer?.dec);
  const amtBaseRaw = pickFirstDefined(
    record.transfer?.amount_base_units,
    record.transfer?.value_base_units,
    record.transfer?.base_units,
    record.amount_base_units,
    record.value_base_units,
    record.base_units,
    record.amt_base_units,
    record.amtBase,
    record.base
  );

  let amtBase: string | undefined = amtBaseRaw != null ? String(amtBaseRaw) : undefined;
  const amtHumanRaw = record.transfer?.amt ?? record.amt ?? record.amount ?? record.value;
  let amtHuman: string | undefined = amtHumanRaw != null ? String(amtHumanRaw) : undefined;

  if (!amtBase && amtHuman) {
    const looksHuman = amtHuman.includes('.') || /e/i.test(amtHuman);
    if (looksHuman && typeof decimals === 'number') {
      try { amtBase = humanToBaseUnits(amtHuman, decimals).toString(); } catch {}
    } else {
      amtBase = amtHuman;
      amtHuman = undefined;
    }
  }
  if (!amtHuman && amtBase && typeof decimals === 'number') {
    try { amtHuman = baseToHuman(amtBase, decimals); } catch {}
  }

  return {
    id,
    txid: record.reveal_txid || record.txid || fallbackId.replace(/i\d+$/, ''),
    vout: typeof record.vout === 'number' ? record.vout : 0,
    location,
    used: Boolean(record.used || record.consumed),
    pending: Boolean(record.pending || record.is_pending || record.status === 'pending'),
    source: 'indexer',
    zrc20: {
      tick,
      decimals,
      amtBase,
      amtHuman,
      raw: record,
    },
    raw: record,
  };
}

function parseDecimals(value: any): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function pickFirstDefined(...values: any[]) {
  for (const v of values) {
    if (v != null) return v;
  }
  return undefined;
}

function humanToBaseUnits(amount: string, decimals: number): bigint {
  const normalized = amount.trim();
  if (!/^[0-9]+(\.[0-9]+)?$/.test(normalized)) throw new Error('invalid');
  const [intPart, fracPart = ''] = normalized.split('.');
  const frac = (fracPart + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(intPart || '0') * 10n ** BigInt(decimals) + BigInt(frac || '0');
}

function baseToHuman(baseStr: string, decimals: number): string {
  const value = BigInt(baseStr);
  const scale = 10n ** BigInt(decimals);
  const integer = value / scale;
  const remainder = value % scale;
  if (remainder === 0n) return integer.toString();
  const frac = remainder.toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${integer.toString()}.${frac}`;
}

function trimCache() {
  if (inscriptionCache.size > 50) {
    const firstKey = inscriptionCache.keys().next().value;
    inscriptionCache.delete(firstKey);
  }
}
