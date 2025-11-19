import { action } from "./_generated/server";
import { v } from "convex/values";

/**
 * Parse inscription content from raw transaction data
 * This reassembles chunked inscriptions that Zerdinals indexer cannot read
 */
export const parseInscriptionFromChain = action({
  args: { inscriptionId: v.string() },
  handler: async (ctx, args) => {
    const txid = args.inscriptionId.replace(/i\d+$/, '');

    try {
      // Fetch raw transaction from Blockchair
      const response = await fetch(
        `https://api.blockchair.com/zcash/raw/transaction/${txid}`
      );

      if (!response.ok) {
        throw new Error(`Failed to fetch tx: ${response.status}`);
      }

      const data = await response.json();
      const rawTx = data.data?.[txid]?.raw_transaction;

      if (!rawTx) {
        throw new Error('Transaction not found');
      }

      // Parse scriptSig hex to extract inscription data
      const scriptSigHex = data.data[txid].decoded_raw_transaction.vin[0].scriptSig.hex;
      const buf = hexToBytes(scriptSigHex);

      // Parse Ordinals envelope
      let pos = 0;

      // Skip "ord" push
      const ordLen = buf[pos++];
      pos += ordLen;

      // Skip OP_1 (content type tag)
      pos += 1;

      // Read content type
      const ctLen = buf[pos++];
      const contentType = bytesToUtf8(buf.slice(pos, pos + ctLen));
      pos += ctLen;

      // Skip OP_0 (content tag)
      pos += 1;

      // Extract all content chunks
      const chunks: Uint8Array[] = [];
      while (pos < buf.length - 150) { // Stop before signature/pubkey area
        const opcode = buf[pos++];

        if (opcode === 0x4c) { // OP_PUSHDATA1
          const len = buf[pos++];
          chunks.push(buf.slice(pos, pos + len));
          pos += len;
        } else if (opcode === 0x4d) { // OP_PUSHDATA2
          const len = buf[pos] | (buf[pos + 1] << 8);
          pos += 2;
          chunks.push(buf.slice(pos, pos + len));
          pos += len;
        } else if (opcode === 0x4e) { // OP_PUSHDATA4
          const len = buf[pos] | (buf[pos + 1] << 8) | (buf[pos + 2] << 16) | (buf[pos + 3] << 24);
          pos += 4;
          chunks.push(buf.slice(pos, pos + len));
          pos += len;
        } else {
          break; // Hit signature or other data
        }
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
function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

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
