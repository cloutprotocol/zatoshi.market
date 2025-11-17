# Inscription Signature Verification Debug Summary

## Problem

Both the manual Zcash transaction builder AND bitcore-lib-zcash (official library) are producing transactions that fail with:
```
Error code: -26
Message: 16: mandatory-script-verify-flag-failed (Script evaluated without error but finished with a false/empty top stack element)
```

This indicates the signatures are not validating correctly.

## What We Tested

### 1. Fixed Transaction Format Issues
- ✅ Added overwintered bit to version field (`0x80000004`)
- ✅ Set correct versionGroupId for Sapling (`0x892f2085`)
- ✅ Fixed sequence number to `0xFFFFFFFF`
- ✅ Proper Zcash v4 Sapling transaction structure

### 2. Verified Wallet Setup
- ✅ Private key matches address (t1ZemSSmv1kcqapcCReZJGH4driYmbALX1x)
- ✅ Both are mainnet (L prefix for key, t1 prefix for address)
- ✅ UTXO exists and is unspent (500,000 zatoshis)

### 3. Tested Multiple Approaches
- ❌ Manual transaction builder - signature verification fails
- ❌ bitcore-lib-zcash with uncheckedSerialize() - signature verification fails
- ❌ Simple send (no inscription) - signature verification fails

## Current Status

**Both implementations produce identical errors**, which suggests:
1. The issue is NOT with our code logic
2. The issue is likely with the UTXO itself or how it was created
3. OR there's a fundamental misunderstanding of Zcash Sapling signing

## Transaction Comparison

### Bitcore-generated transaction:
```
0400008085202f8901b19a00055d57c96ef344e7de42d27371fa9062345a9b4046548e362b2da6d948000000006b483045022100bb8473b1da7501e10a02491c7df3a2c3065bbcc2c77c65765923fddd92326ce302204debf051f17abc0339ba50f5bdabe09356288298cd0d8fa44029b772ca6bad65012103cbe99e3fd41a3f4ed04961c7dafc5074b790ccc076fc3b7aafff5a59bac96a8bffffffff020000000000000000126a107a6572647c68656c6c6f20776f726c64107a0700000000001976a914ad147aafdeaeba4dbb59874e7aec3c44110283be88ac00000000000000000000000000000000000000
```
- Size: 238 bytes
- Signature: Valid DER format
- Structure: Correct Zcash v4 Sapling

### Manual builder transaction:
```
0400008085202f8901b19a00055d57c96ef344e7de42d27371fa9062345a9b4046548e362b2da6d948000000006a4730440220434f0840f987c0ddb2dfeebf45ccf31f235cc9f67efee01ed9e6526e7d8847a1022053eadc9b90efa63b410d300bd8dcc084eded56cb513f9df519680ce15bdb425b012103cbe99e3fd41a3f4ed04961c7dafc5074b790ccc076fc3b7aafff5a59bac96a8bffffffff020000000000000000126a107a6572647c68656c6c6f20776f726c64107a0700000000001976a914ad147aafdeaeba4dbb59874e7aec3c44110283be88ac00000000000000000000000000000000000000
```
- Size: 237 bytes
- Signature: Valid DER format
- Structure: Correct Zcash v4 Sapling

**Both fail with the same error.**

## Possible Causes

### 1. UTXO Script Type Mismatch
The UTXO might have a different scriptPubKey than standard P2PKH:
- Could be P2SH (OP_HASH160)
- Could be a multisig
- Could be a special Zcash script

### 2. Signature Hash Algorithm
Zcash Sapling uses ZIP 243 signature hashing which is different from Bitcoin:
- Requires specific preimage structure
- Includes additional Sapling-specific fields
- Our implementation may have subtle differences

### 3. Source Transaction Issues
- The transaction that created this UTXO might have special characteristics
- Need to inspect the source transaction to verify scriptPubKey

### 4. Network/Node Issues
- Tatum's Zcash node might be outdated
- Zerdinals API might have specific requirements
- May need to test with local zcashd node

## Next Steps

### Immediate
1. **Test with fresh wallet**: Generate new address and fund it directly
   - New address: `t1KH1BxiQEFcmCQhT4LQBZihKLUmbxNB8J8`
   - Private key: `KzyAS9CobpZyCMj5TKuxNDZiST7Cg8ifvqgmj1mwDGYfcmCPUVDY`
   - Need user to fund with ~0.01 ZEC

2. **Inspect source transaction**: Get the raw transaction that created our UTXO
   - Transaction: `48d9a62d2b368e5446409b5a346290fa7173d242dee744f36ec9575d05009ab1`
   - Output: 0
   - Verify the scriptPubKey matches our expectations

3. **Test with local node**: If available, test with local zcashd
   - Can use `zcash-cli signrawtransaction` to verify
   - Can use `zcash-cli decoderawtransaction` to inspect

### Alternative Approaches

1. **Use Zerdinals UI** (temporary solution)
   - Go to https://mint.zerdinals.com
   - Import wallet with private key
   - Create inscription manually
   - This proves the concept while we debug programmatic approach

2. **Different RPC endpoint**
   - Try different Zcash RPC providers
   - Some may have different validation rules

3. **Signature debugging**
   - Add detailed logging of signature preimage
   - Compare with known working transaction
   - Verify each byte of the signature hash

## Code Status

### What Works ✅
- Inscription protection system (production-ready)
- UTXO fetching and verification
- Transaction structure building
- Wallet generation and key derivation
- Integration with Tatum and Zerdinals APIs

### What's Blocked ❌
- Transaction signing (signature verification fails)
- Programmatic inscription creation
- Automated broadcasting

## Recommendations

1. **Short-term**: Use Zerdinals UI to create first inscription
   - Proves the wallet and funds work
   - Unblocks user testing
   - Allows inscription protection system to be tested

2. **Medium-term**: Debug with fresh UTXO
   - Fund new wallet and test immediately
   - Compare with existing UTXO
   - May reveal source of signature issue

3. **Long-term**: Investigate ZIP 243 implementation
   - Review Zcash signature hashing specification
   - Compare with reference implementations
   - May need to adjust signature hash calculation

## Resources

- [ZIP 243: Transaction Signature Validation for Sapling](https://zips.z.cash/zip-0243)
- [Zcash Protocol Specification](https://zips.z.cash/protocol/protocol.pdf)
- [bitcore-lib-zcash GitHub](https://github.com/zcash-hackworks/bitcore-lib-zcash)
