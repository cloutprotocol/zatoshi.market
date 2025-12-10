#!/usr/bin/env python3
"""
Analyze DEV snapshot (pre-cleanup) - should align closer to on-chain master
"""

import csv
import json
from collections import defaultdict
from pathlib import Path

ONCHAIN_CSV = Path("/Users/cloutcoin/GitHub/zord/zgods_collection.csv")
DEV_SNAPSHOT = Path("temp/snapshots_dev_extracted/collectionClaims/documents.jsonl")
OUTPUT_DIR = Path("temp/analysis")

def load_onchain_master():
    """Load on-chain master"""
    token_to_owner = {}
    with ONCHAIN_CSV.open() as f:
        for line in f:
            if line.startswith('address,'):
                continue
            parts = line.strip().split(',')
            if len(parts) < 3:
                continue
            address = parts[0].lower()
            token_ids = [int(x) for x in parts[2:] if x.strip()]
            for tid in token_ids:
                token_to_owner[tid] = address
    return token_to_owner

def analyze_dev_claims(token_to_owner):
    """Analyze DEV Convex claims"""
    dev_claims = []
    with DEV_SNAPSHOT.open() as f:
        for line in f:
            doc = json.loads(line)
            if doc.get('collectionSlug') == 'zgods' and doc.get('status') == 'minted':
                dev_claims.append({
                    'address': doc.get('address', '').lower(),
                    'tokenId': int(doc.get('tokenId'))
                })

    # Group by address
    address_claims = defaultdict(list)
    for claim in dev_claims:
        address_claims[claim['address']].append(claim['tokenId'])

    # Analyze
    invalid_reports = []
    for address, claimed_tokens in address_claims.items():
        claimed_tokens = sorted(set(claimed_tokens))
        invalid_tokens = []

        for tid in claimed_tokens:
            if tid not in token_to_owner:
                invalid_tokens.append(tid)
            elif token_to_owner[tid] != address:
                invalid_tokens.append(tid)

        if invalid_tokens:
            invalid_reports.append({
                'wallet': address,
                'tokens_claimed': len(claimed_tokens),
                'invalid_count': len(invalid_tokens),
                'invalid_ids': ','.join(str(t) for t in sorted(invalid_tokens))
            })

    return invalid_reports, dev_claims, address_claims

def main():
    print("Loading on-chain master...")
    token_to_owner = load_onchain_master()
    print(f"  ✓ {len(token_to_owner)} tokens")

    print("\nAnalyzing DEV Convex claims (pre-cleanup)...")
    invalid_reports, dev_claims, address_claims = analyze_dev_claims(token_to_owner)

    total_dev_claims = len(dev_claims)
    unique_dev_tokens = len(set(c['tokenId'] for c in dev_claims))
    duplicate_count = total_dev_claims - unique_dev_tokens

    print(f"  ✓ {total_dev_claims} total minted claims")
    print(f"  ✓ {unique_dev_tokens} unique token IDs")
    print(f"  ✓ {duplicate_count} duplicate tokens")
    print(f"  ✓ {len(address_claims)} addresses")

    # Sort
    invalid_reports.sort(key=lambda x: x['invalid_count'], reverse=True)

    # Write
    output_file = OUTPUT_DIR / "zgods_invalid_claims_DEV.csv"
    with output_file.open('w', newline='') as f:
        fieldnames = ['wallet', 'tokens_claimed', 'invalid_count', 'invalid_ids']
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(invalid_reports)

    total_invalid = sum(r['invalid_count'] for r in invalid_reports)

    print(f"\n{'='*60}")
    print(f"DEV SNAPSHOT RESULTS (PRE-CLEANUP)")
    print(f"{'='*60}")
    print(f"On-chain master:        7,138 tokens")
    print(f"DEV total claims:       {total_dev_claims:,} claims")
    print(f"DEV unique tokens:      {unique_dev_tokens:,} tokens")
    print(f"Duplicate tokens:       {duplicate_count:,} tokens")
    print(f"")
    print(f"Addresses with invalid: {len(invalid_reports)}")
    print(f"Total invalid tokens:   {total_invalid:,}")
    print(f"")
    print(f"Output: {output_file}")
    print(f"")
    print(f"Top 20 addresses by invalid count:")
    for r in invalid_reports[:20]:
        print(f"  {r['wallet']}: {r['invalid_count']}/{r['tokens_claimed']} invalid")

if __name__ == "__main__":
    main()
