import { NextResponse } from 'next/server';
import { callZcashRPC } from '../rpcHelper';

type RpcStatus = 'online' | 'degraded' | 'offline';

export async function GET() {
  const [blockchainResult, mempoolResult, networkResult] = await Promise.allSettled([
    callZcashRPC('getblockchaininfo'),
    callZcashRPC('getmempoolinfo'),
    callZcashRPC('getnetworkinfo'),
  ]);

  const blockchainInfo = blockchainResult.status === 'fulfilled' ? blockchainResult.value : null;
  const mempoolInfo = mempoolResult.status === 'fulfilled' ? mempoolResult.value : null;
  const networkInfo = networkResult.status === 'fulfilled' ? networkResult.value : null;

  const successes = [blockchainInfo, mempoolInfo, networkInfo].filter(Boolean).length;
  const status: RpcStatus = successes === 3 ? 'online' : successes > 0 ? 'degraded' : 'offline';

  const errors: Record<string, string> = {};
  if (blockchainResult.status === 'rejected') {
    errors.blockchain = blockchainResult.reason instanceof Error
      ? blockchainResult.reason.message
      : 'Unknown blockchain RPC error';
  }
  if (mempoolResult.status === 'rejected') {
    errors.mempool = mempoolResult.reason instanceof Error
      ? mempoolResult.reason.message
      : 'Unknown mempool RPC error';
  }
  if (networkResult.status === 'rejected') {
    errors.network = networkResult.reason instanceof Error
      ? networkResult.reason.message
      : 'Unknown network RPC error';
  }

  return NextResponse.json(
    {
      status,
      healthy: status === 'online',
      blockchainInfo,
      mempoolInfo,
      networkInfo,
      timestamp: Date.now(),
      errors,
    },
    {
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate',
      },
    },
  );
}
