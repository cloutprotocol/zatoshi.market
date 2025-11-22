import { action } from "./_generated/server";
import { v } from "convex/values";
import { callZcashRPC, hexToBytes } from "./zcashHelpers";

/**
 * Parse inscription content from raw transaction data
 * This reassembles chunked inscriptions directly from the chain via RPC
 */
export const parseInscriptionFromChain = action({
  args: { inscriptionId: v.string() },
  handler: async (ctx, args) => {
    const txid = args.inscriptionId.replace(/i\d+$/, '');

    try {
      // Fetch raw transaction from Zatoshi RPC
      const tx = await callZcashRPC('getrawtransaction', [txid, 1]);

      if (!tx) {
        throw new Error('Transaction not found');
      }

      // Inscriptions are in the input scriptSig (witness data in BTC, but scriptSig in ZEC usually)
      // We look at the first input usually, or iterate inputs to find the one with "ord"
      const vin = tx.vin.find((v: any) => v.scriptSig?.hex?.includes('6f7264')); // 'ord'

      if (!vin || !vin.scriptSig?.hex) {
        throw new Error('No inscription data found in transaction');
      }

      const scriptSigHex = vin.scriptSig.hex;
      const buf = hexToBytes(scriptSigHex);

      // Parse Ordinals envelope
      // Standard format: ... OP_FALSE OP_IF push("ord") OP_1 push(contentType) OP_0 push(content) ... OP_ENDIF
      // Zerdinals often just does: push("ord") OP_1 push(contentType) OP_0 push(content)

      let pos = 0;

      // Scan for "ord" marker (0x03 0x6f 0x72 0x64)
      // This allows us to skip signature data at the start
      const ordMarker = [0x03, 0x6f, 0x72, 0x64];
      let foundStart = -1;

      for (let i = 0; i < buf.length - 3; i++) {
        if (buf[i] === ordMarker[0] && buf[i + 1] === ordMarker[1] && buf[i + 2] === ordMarker[2] && buf[i + 3] === ordMarker[3]) {
          foundStart = i;
          break;
        }
      }

      if (foundStart === -1) {
        throw new Error('Ordinals protocol marker not found');
      }

      pos = foundStart + 4; // Skip "ord" push

      // Expect OP_1 (0x51) - Content Type Tag
      if (buf[pos] !== 0x51) {
        // Try to be lenient? No, strictly follow protocol for now.
        // Some implementations might differ.
      }
      pos++;

      // Read Content Type
      let contentType = 'application/octet-stream';
      // Next opcode should be a push
      let opcode = buf[pos++];
      let len = 0;

      if (opcode > 0 && opcode <= 0x4b) { len = opcode; }
      else if (opcode === 0x4c) { len = buf[pos++]; }
      else if (opcode === 0x4d) { len = buf[pos] | (buf[pos + 1] << 8); pos += 2; }

      if (len > 0) {
        contentType = new TextDecoder().decode(buf.slice(pos, pos + len));
        pos += len;
      }

      // Expect OP_0 (0x00) - Content Tag
      if (buf[pos] !== 0x00) {
        // Maybe metadata? Skip until OP_0
        while (pos < buf.length && buf[pos] !== 0x00 && buf[pos] !== 0x68) { // 0x68 is OP_ENDIF
          pos++;
        }
      }

      if (buf[pos] === 0x00) {
        pos++; // Consume OP_0
      }

      // Extract content chunks
      const chunks: Uint8Array[] = [];

      while (pos < buf.length) {
        opcode = buf[pos++];

        if (opcode === 0x68) break; // OP_ENDIF - End of envelope

        len = 0;
        if (opcode > 0 && opcode <= 0x4b) {
          len = opcode;
        } else if (opcode === 0x4c) {
          len = buf[pos++];
        } else if (opcode === 0x4d) {
          len = buf[pos] | (buf[pos + 1] << 8);
          pos += 2;
        } else if (opcode === 0x4e) {
          len = buf[pos] | (buf[pos + 1] << 8) | (buf[pos + 2] << 16) | (buf[pos + 3] << 24);
          pos += 4;
        } else {
          // Unexpected opcode, might be end of script or signature
          break;
        }

        if (pos + len > buf.length) break; // Safety check

        chunks.push(buf.slice(pos, pos + len));
        pos += len;
      }

      // Reassemble content
      const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
      const fullContent = new Uint8Array(totalLength);
      let offset = 0;
      for (const chunk of chunks) {
        fullContent.set(chunk, offset);
        offset += chunk.length;
      }

      // Convert to base64 for transport
      const base64Content = bytesToBase64(fullContent);

      return {
        contentType,
        content: base64Content,
        size: fullContent.length,
        chunks: chunks.length
      };

    } catch (error) {
      console.error('Failed to parse inscription:', error);
      throw error;
    }
  }
});

// Helper functions
function bytesToUtf8(bytes: Uint8Array): string {
  return new TextDecoder().decode(bytes);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}
