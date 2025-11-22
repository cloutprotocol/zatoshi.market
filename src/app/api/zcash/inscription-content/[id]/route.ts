import { NextRequest, NextResponse } from 'next/server';
import { callZcashRPC } from '../../rpcHelper';

/**
 * Fetch inscription content directly from Zcash chain via RPC
 * Returns the raw content of an inscription by parsing the transaction witness/scriptSig
 */

// Cache content for 1 hour (inscriptions are immutable)
// Version 3: Fixed binary data filtering (check before adding chunks)
const PARSER_VERSION = 'v3';
const contentCache = new Map<string, { data: Buffer; contentType: string; timestamp: number; version: string }>();
const CACHE_DURATION = 60 * 60 * 1000; // 1 hour

function hexToBuffer(hex: string): Buffer {
  return Buffer.from(hex, 'hex');
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const txid = id.replace(/i\d+$/, '');

  try {
    // Check cache first (invalidate if version mismatch)
    const cached = contentCache.get(id);
    if (cached && cached.version === PARSER_VERSION && Date.now() - cached.timestamp < CACHE_DURATION) {
      return new NextResponse(new Uint8Array(cached.data), {
        headers: {
          'Content-Type': cached.contentType,
          'Cache-Control': 'public, max-age=31536000, immutable'
        }
      });
    }

    // Fetch raw transaction from Zatoshi RPC
    const tx = await callZcashRPC('getrawtransaction', [txid, 1]);

    if (!tx) {
      return new NextResponse('Transaction not found', { status: 404 });
    }

    // Find input with "ord" marker
    const vin = tx.vin.find((v: any) => v.scriptSig?.hex?.includes('6f7264')); // 'ord'

    if (!vin || !vin.scriptSig?.hex) {
      return new NextResponse('No inscription data found', { status: 404 });
    }

    const buf = hexToBuffer(vin.scriptSig.hex);

    // Parse Ordinals envelope
    let pos = 0;

    // Scan for "ord" marker (0x03 0x6f 0x72 0x64)
    const ordMarker = Buffer.from([0x03, 0x6f, 0x72, 0x64]);
    const foundStart = buf.indexOf(ordMarker);

    if (foundStart === -1) {
      return new NextResponse('Ordinals protocol marker not found', { status: 404 });
    }

    pos = foundStart + 4; // Skip "ord" push

    let contentType = 'application/octet-stream';

    // Helper to read a push from buffer
    const readPush = (): Buffer | null => {
      if (pos >= buf.length) return null;
      const op = buf[pos++];

      if (op === 0x00) return Buffer.alloc(0); // OP_0
      if (op >= 0x51 && op <= 0x60) { // OP_1 .. OP_16
        return Buffer.from([op - 0x50]);
      }

      let len = 0;
      if (op > 0 && op <= 0x4b) { len = op; }
      else if (op === 0x4c) {
        if (pos >= buf.length) { pos--; return null; }
        len = buf[pos++];
      }
      else if (op === 0x4d) {
        if (pos + 1 >= buf.length) { pos--; return null; }
        len = buf.readUInt16LE(pos); pos += 2;
      }
      else if (op === 0x4e) {
        if (pos + 3 >= buf.length) { pos--; return null; }
        len = buf.readUInt32LE(pos); pos += 4;
      }
      else {
        // Not a push opcode (e.g. OP_ENDIF 0x68)
        pos--; // Backtrack
        return null;
      }

      if (pos + len > buf.length) {
        pos -= (op === 0x4c ? 1 : op === 0x4d ? 2 : op === 0x4e ? 4 : 0);
        pos--;
        return null;
      }
      const data = buf.subarray(pos, pos + len);
      pos += len;
      return data;
    };

    // Parse fields until body separator (OP_0) or end (OP_ENDIF)
    while (pos < buf.length) {
      const peek = buf[pos];
      if (peek === 0x68) break; // OP_ENDIF
      if (peek === 0x00) {
        pos++; // Consume OP_0 (Body separator)
        break;
      }

      // Read Tag
      const tag = readPush();
      if (!tag) {
        // If we can't read a tag, maybe we hit a non-push opcode?
        // Just break to be safe
        break;
      }

      // Read Value
      const val = readPush();
      if (!val) {
        break; // Malformed
      }

      // Check if Tag is Content Type (1)
      // Tag 1 is represented by a single byte 0x01
      if (tag.length === 1 && tag[0] === 0x01) {
        contentType = val.toString('utf-8');
      }
    }

    // Extract content chunks
    const chunks: Buffer[] = [];

    while (pos < buf.length) {
      const op = buf[pos++];

      if (op === 0x68) break; // OP_ENDIF - end of envelope

      // Handle push opcodes only
      if (op === 0x00) {
        chunks.push(Buffer.alloc(0));
        continue;
      }

      if (op >= 0x51 && op <= 0x60) {
        // OP_1 through OP_16
        chunks.push(Buffer.from([op - 0x50]));
        continue;
      }

      // Check if it's a push data opcode
      let len = 0;
      if (op > 0 && op <= 0x4b) {
        len = op;
      } else if (op === 0x4c) {
        if (pos >= buf.length) break;
        len = buf[pos++];
      } else if (op === 0x4d) {
        if (pos + 1 >= buf.length) break;
        len = buf.readUInt16LE(pos);
        pos += 2;
      } else if (op === 0x4e) {
        if (pos + 3 >= buf.length) break;
        len = buf.readUInt32LE(pos);
        pos += 4;
      } else {
        // Not a push opcode - end of content
        break;
      }

      if (pos + len > buf.length) break;

      // BEFORE adding the next chunk, check if we already have complete valid content
      if (chunks.length > 0 && (contentType.includes('json') || contentType.includes('text'))) {
        try {
          const currentContent = Buffer.concat(chunks).toString('utf-8');

          // For JSON, check if current content is already valid and complete
          if (contentType.includes('json')) {
            try {
              JSON.parse(currentContent);
              // We have valid complete JSON - don't read any more chunks
              break;
            } catch {
              // Not valid yet, continue
            }
          }
        } catch {
          // UTF-8 decode failed
        }
      }

      const nextChunk = buf.subarray(pos, pos + len);

      // Check if this chunk looks like binary garbage before adding it
      if (contentType.includes('json') || contentType.includes('text')) {
        const hasNullBytes = nextChunk.some(b => b === 0);
        const nonPrintable = nextChunk.filter(b => b < 32 && b !== 10 && b !== 13 && b !== 9).length;
        const hasHighBinary = nextChunk.filter(b => b > 127 && b < 192).length > nextChunk.length * 0.3;

        if (hasNullBytes || nonPrintable > nextChunk.length * 0.2 || hasHighBinary) {
          // This chunk is binary garbage (likely signature data), stop here
          break;
        }
      }

      chunks.push(nextChunk);
      pos += len;
    }

    const fullContent = Buffer.concat(chunks);

    // Update cache
    contentCache.set(id, { data: fullContent, contentType, timestamp: Date.now(), version: PARSER_VERSION });

    // Clean old cache entries
    if (contentCache.size > 100) {
      const firstKey = contentCache.keys().next().value;
      if (firstKey) contentCache.delete(firstKey);
    }

    return new NextResponse(new Uint8Array(fullContent), {
      headers: {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=31536000, immutable'
      }
    });

  } catch (error) {
    console.error('Inscription content error:', error);
    return new NextResponse('Failed to fetch content', { status: 500 });
  }
}
