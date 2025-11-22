import { NextResponse } from 'next/server';

export async function callZcashRPC(method: string, params: any[] = []) {
    const url = process.env.NEXT_PUBLIC_ZCASH_RPC_URL || 'https://rpc.zatoshi.market/api/rpc';
    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
    };

    // Add Basic Auth if credentials are present
    const username = process.env.ZCASH_RPC_USERNAME;
    const password = process.env.ZCASH_RPC_PASSWORD;
    if (username && password) {
        const auth = Buffer.from(`${username}:${password}`).toString('base64');
        headers['Authorization'] = `Basic ${auth}`;
    }

    const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            jsonrpc: '2.0',
            method,
            params,
            id: 'zatoshi-nextjs'
        })
    });

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`RPC HTTP ${response.status}: ${text}`);
    }

    const data = await response.json();
    if (data.error) {
        throw new Error(data.error.message || JSON.stringify(data.error));
    }
    return data.result;
}
