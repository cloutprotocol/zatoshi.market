/**
 * API Route: Create Inscription
 * POST /api/inscriptions/create
 */

import { NextRequest, NextResponse } from 'next/server';
import { InscriptionService } from '@/services/InscriptionService';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const ENABLE_CUSTODIAL = (process.env.ENABLE_CUSTODIAL_API || '').toLowerCase() === 'true';

interface CreateInscriptionRequest {
  content: string;
  contentType?: string;
  walletWIF: string;
}

export async function POST(request: NextRequest) {
  // Hard-disable custodial route unless explicitly enabled via env flag.
  if (!ENABLE_CUSTODIAL) {
    return NextResponse.json(
      {
        error: 'This endpoint is deprecated. Use the non-custodial flow.',
        status: 410,
      },
      { status: 410 }
    );
  }
  try {
    const body: CreateInscriptionRequest = await request.json();

    // Validate input
    if (!body.content) {
      return NextResponse.json(
        { error: 'Content is required' },
        { status: 400 }
      );
    }

    if (!body.walletWIF) {
      return NextResponse.json(
        { error: 'Wallet private key (WIF) is required' },
        { status: 400 }
      );
    }

    // Check content length (max 80 bytes)
    const contentBytes = Buffer.from(body.content, 'utf8');
    if (contentBytes.length > 80) {
      return NextResponse.json(
        { error: `Content too long: ${contentBytes.length} bytes (max 80 bytes)` },
        { status: 400 }
      );
    }

    // Validate WIF format
    if (!body.walletWIF.startsWith('L') && !body.walletWIF.startsWith('K')) {
      return NextResponse.json(
        { error: 'Invalid WIF format. Must start with L or K.' },
        { status: 400 }
      );
    }

    console.log('Creating inscription...');
    console.log(`  Content: "${body.content}"`);
    console.log(`  Type: ${body.contentType || 'text/plain'}`);
    console.log(`  Size: ${contentBytes.length} bytes`);

    // Create inscription
    const service = new InscriptionService();
    const result = await service.createInscription(
      body.walletWIF,
      body.content,
      body.contentType || 'text/plain'
    );

    console.log('Inscription created successfully!');
    console.log(`  Commit TXID: ${result.commitTxid}`);
    console.log(`  Reveal TXID: ${result.revealTxid}`);
    console.log(`  Inscription ID: ${result.inscriptionId}`);

    return NextResponse.json({
      success: true,
      ...result,
      explorerUrl: `https://zcashblockexplorer.com/transactions/${result.revealTxid}`,
      zerdinals: `https://zerdinals.com/zerdinals/${result.inscriptionId}`
    });

  } catch (error: any) {
    console.error('Inscription creation failed:', error);

    // Parse error message
    let errorMessage = error.message || 'Unknown error';

    // Extract specific error from JSON if present
    try {
      const errorJson = JSON.parse(errorMessage);
      if (errorJson.message) {
        errorMessage = errorJson.message;
      }
    } catch (e) {
      // Not JSON, use as-is
    }

    return NextResponse.json(
      {
        success: false,
        error: errorMessage,
        details: error.stack
      },
      { status: 500 }
    );
  }
}
