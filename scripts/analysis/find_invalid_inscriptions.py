#!/usr/bin/env python3
"""
Compare on-chain index (master truth) with Convex database to find invalid re-inscriptions.

On-chain index = /Users/cloutcoin/GitHub/zord/zgods_collection.csv (MASTER TRUTH)
Convex DB = temp/analysis/zgods_address_claims.csv (contains invalid re-inscriptions)

Output: CSV with wallet, tokens_claimed, invalid_count, invalid_ids
"""

import csv
from pathlib import Path
from typing import Dict, Set

# File paths
ONCHAIN_MASTER = Path("/Users/cloutcoin/GitHub/zord/zgods_collection.csv")
CONVEX_CLAIMS = Path("temp/analysis/zgods_address_claims.csv")
OUTPUT_FILE = Path("temp/analysis/zgods_invalid_claims.csv")

def parse_token_ids(token_str: str) -> Set[int]:
    """Parse comma-separated token IDs into a set of integers."""
    if not token_str or token_str == "-":
        return set()
    return {int(tid.strip()) for tid in token_str.split(",") if tid.strip()}

def load_onchain_master() -> Dict[int, str]:
    """Load on-chain master index. Returns {token_id: owner_address}"""
    token_to_owner = {}

    with ONCHAIN_MASTER.open() as f:
        reader = csv.DictReader(f)
        for row in reader:
            address = row["address"].lower()
            token_ids = parse_token_ids(row["TOKEN IDS"])

            for token_id in token_ids:
                token_to_owner[token_id] = address

    print(f"Loaded {len(token_to_owner)} tokens from on-chain master index")
    return token_to_owner

def analyze_invalid_claims(token_to_owner: Dict[int, str]) -> list:
    """
    Compare Convex claims against on-chain master.
    Returns list of invalid claims.
    """
    invalid_claims = []

    with CONVEX_CLAIMS.open() as f:
        reader = csv.DictReader(f)

        for row in reader:
            convex_address = row["address"].lower()
            minted_count = int(row["mintedCount"]) if row["mintedCount"] else 0

            if minted_count == 0:
                continue

            # Parse tokens claimed in Convex
            claimed_tokens = parse_token_ids(row["mintedTokens"])

            if not claimed_tokens:
                continue

            # Check each claimed token against on-chain master
            invalid_tokens = []

            for token_id in claimed_tokens:
                if token_id not in token_to_owner:
                    # Token not in on-chain index at all (shouldn't happen)
                    invalid_tokens.append((token_id, "not_found_onchain"))
                else:
                    onchain_owner = token_to_owner[token_id]
                    if onchain_owner != convex_address:
                        # Token belongs to different owner on-chain!
                        invalid_tokens.append((token_id, onchain_owner))

            if invalid_tokens:
                invalid_ids = [str(tid) for tid, _ in invalid_tokens]
                invalid_owners = [owner for _, owner in invalid_tokens]

                invalid_claims.append({
                    "wallet": convex_address,
                    "tokens_claimed": minted_count,
                    "invalid_count": len(invalid_tokens),
                    "invalid_ids": ",".join(invalid_ids),
                    "actual_onchain_owners": ";".join(invalid_owners)
                })

    print(f"Found {len(invalid_claims)} addresses with invalid claims")
    return invalid_claims

def main():
    print("Loading on-chain master index...")
    token_to_owner = load_onchain_master()

    print("\nAnalyzing Convex claims for invalid re-inscriptions...")
    invalid_claims = analyze_invalid_claims(token_to_owner)

    # Sort by invalid count (descending)
    invalid_claims.sort(key=lambda x: x["invalid_count"], reverse=True)

    # Write output
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    with OUTPUT_FILE.open("w", newline="") as f:
        fieldnames = ["wallet", "tokens_claimed", "invalid_count", "invalid_ids", "actual_onchain_owners"]
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(invalid_claims)

    print(f"\n✅ Wrote invalid claims to: {OUTPUT_FILE}")
    print(f"\nSummary:")
    print(f"  - Total addresses with invalid claims: {len(invalid_claims)}")
    if invalid_claims:
        total_invalid = sum(claim["invalid_count"] for claim in invalid_claims)
        print(f"  - Total invalid token claims: {total_invalid}")
        print(f"\nTop 10 addresses by invalid claim count:")
        for claim in invalid_claims[:10]:
            print(f"    {claim['wallet']}: {claim['invalid_count']} invalid tokens")

if __name__ == "__main__":
    main()
