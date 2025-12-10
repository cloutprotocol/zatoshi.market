#!/usr/bin/env python3
"""
CORRECTED analysis comparing on-chain master (7,138 tokens) vs Convex (5,803 claims)
"""

import csv
import json
from collections import defaultdict
from pathlib import Path

ONCHAIN_CSV = Path("/Users/cloutcoin/GitHub/zord/zgods_collection.csv")
CONVEX_SNAPSHOT = Path("temp/snapshots_prod/collectionClaims/documents.jsonl")
OUTPUT_DIR = Path("temp/analysis")

def load_onchain_master():
    """Load on-chain master - tokens are in separate CSV fields (field 3+)"""
    token_to_owner = {}
    address_tokens = defaultdict(set)

    with ONCHAIN_CSV.open() as f:
        for line in f:
            if line.startswith('address,'):
                continue

            parts = line.strip().split(',')
            if len(parts) < 3:
                continue

            address = parts[0].lower()
            # Fields 3+ are all token IDs
            token_ids = [int(x) for x in parts[2:] if x.strip()]

            for tid in token_ids:
                token_to_owner[tid] = address
                address_tokens[address].add(tid)

    return token_to_owner, address_tokens

def analyze_convex_claims(token_to_owner):
    """Analyze Convex claims against on-chain master"""

    # Load all Convex minted claims
    convex_claims = []
    with CONVEX_SNAPSHOT.open() as f:
        for line in f:
            doc = json.loads(line)
            if doc.get('collectionSlug') == 'zgods' and doc.get('status') == 'minted':
                convex_claims.append({
                    'address': doc.get('address', '').lower(),
                    'tokenId': int(doc.get('tokenId'))
                })

    # Group by address
    address_claims = defaultdict(list)
    for claim in convex_claims:
        address_claims[claim['address']].append(claim['tokenId'])

    # Analyze each address
    invalid_reports = []

    for address, claimed_tokens in address_claims.items():
        claimed_tokens = sorted(set(claimed_tokens))  # dedupe
        invalid_tokens = []

        for tid in claimed_tokens:
            if tid not in token_to_owner:
                # Token doesn't exist on-chain
                invalid_tokens.append(tid)
            elif token_to_owner[tid] != address:
                # Token exists but belongs to someone else
                invalid_tokens.append(tid)

        if invalid_tokens:
            invalid_reports.append({
                'wallet': address,
                'tokens_claimed': len(claimed_tokens),
                'invalid_count': len(invalid_tokens),
                'invalid_ids': ','.join(str(t) for t in sorted(invalid_tokens))
            })

    return invalid_reports, convex_claims, address_claims

def main():
    print("Loading on-chain master...")
    token_to_owner, onchain_address_tokens = load_onchain_master()

    print(f"  ✓ {len(onchain_address_tokens)} addresses")
    print(f"  ✓ {len(token_to_owner)} tokens (range: {min(token_to_owner.keys())}-{max(token_to_owner.keys())})")

    print("\nAnalyzing Convex claims...")
    invalid_reports, convex_claims, address_claims = analyze_convex_claims(token_to_owner)

    total_convex_claims = len(convex_claims)
    unique_convex_tokens = len(set(c['tokenId'] for c in convex_claims))
    duplicate_count = total_convex_claims - unique_convex_tokens

    print(f"  ✓ {total_convex_claims} total minted claims")
    print(f"  ✓ {unique_convex_tokens} unique token IDs")
    print(f"  ✓ {duplicate_count} duplicate tokens (same ID claimed multiple times)")
    print(f"  ✓ {len(address_claims)} addresses with claims")

    # Sort by invalid count
    invalid_reports.sort(key=lambda x: x['invalid_count'], reverse=True)

    # Write output
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    output_file = OUTPUT_DIR / "zgods_invalid_claims_FINAL.csv"

    with output_file.open('w', newline='') as f:
        fieldnames = ['wallet', 'tokens_claimed', 'invalid_count', 'invalid_ids']
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(invalid_reports)

    # Calculate stats
    total_invalid = sum(r['invalid_count'] for r in invalid_reports)
    total_claimed_by_invalid_addresses = sum(r['tokens_claimed'] for r in invalid_reports)

    print(f"\n{'='*60}")
    print(f"FINAL RESULTS")
    print(f"{'='*60}")
    print(f"On-chain master:        7,138 tokens")
    print(f"Convex total claims:    {total_convex_claims:,} claims")
    print(f"Convex unique tokens:   {unique_convex_tokens:,} tokens")
    print(f"Duplicate tokens:       {duplicate_count:,} tokens")
    print(f"")
    print(f"Addresses with invalid claims: {len(invalid_reports)}")
    print(f"Total invalid tokens:          {total_invalid:,}")
    print(f"")
    print(f"Output: {output_file}")
    print(f"")
    print(f"Top 20 addresses by invalid count:")
    for r in invalid_reports[:20]:
        print(f"  {r['wallet']}: {r['invalid_count']}/{r['tokens_claimed']} invalid")

if __name__ == "__main__":
    main()
