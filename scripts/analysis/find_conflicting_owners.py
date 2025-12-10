#!/usr/bin/env python3
"""
Find tokens where Convex and on-chain both have the token, but with DIFFERENT owners.
These are the true conflicts - tokens that were re-inscribed after being inscribed to someone else.
"""

import csv
from pathlib import Path
from typing import Dict, Set

ONCHAIN_MASTER = Path("/Users/cloutcoin/GitHub/zord/zgods_collection.csv")
CONVEX_CLAIMS = Path("temp/analysis/zgods_address_claims.csv")
OUTPUT_FILE = Path("temp/analysis/zgods_owner_conflicts.csv")

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

def find_owner_conflicts(token_to_owner: Dict[int, str]) -> list:
    """
    Find cases where Convex has a token ID that ALSO exists on-chain, but with different owner.
    """
    conflicts = []

    with CONVEX_CLAIMS.open() as f:
        reader = csv.DictReader(f)

        for row in reader:
            convex_address = row["address"].lower()
            minted_count = int(row["mintedCount"]) if row["mintedCount"] else 0

            if minted_count == 0:
                continue

            claimed_tokens = parse_token_ids(row["mintedTokens"])
            if not claimed_tokens:
                continue

            conflicting_tokens = []

            for token_id in claimed_tokens:
                if token_id in token_to_owner:
                    onchain_owner = token_to_owner[token_id]
                    if onchain_owner != convex_address:
                        # Same token ID, DIFFERENT owners!
                        conflicting_tokens.append((token_id, onchain_owner))

            if conflicting_tokens:
                conflict_ids = [str(tid) for tid, _ in conflicting_tokens]
                actual_owners = [owner for _, owner in conflicting_tokens]

                conflicts.append({
                    "convex_wallet": convex_address,
                    "tokens_claimed_in_convex": minted_count,
                    "conflict_count": len(conflicting_tokens),
                    "conflicting_token_ids": ",".join(conflict_ids),
                    "actual_onchain_owners": ";".join(actual_owners)
                })

    print(f"Found {len(conflicts)} addresses with owner conflicts")
    return conflicts

def main():
    print("Loading on-chain master index...")
    token_to_owner = load_onchain_master()

    print("\nFinding owner conflicts (same token ID, different owners)...")
    conflicts = find_owner_conflicts(token_to_owner)

    # Sort by conflict count (descending)
    conflicts.sort(key=lambda x: x["conflict_count"], reverse=True)

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    with OUTPUT_FILE.open("w", newline="") as f:
        fieldnames = ["convex_wallet", "tokens_claimed_in_convex", "conflict_count", "conflicting_token_ids", "actual_onchain_owners"]
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(conflicts)

    print(f"\n✅ Wrote owner conflicts to: {OUTPUT_FILE}")
    print(f"\nSummary:")
    print(f"  - Addresses with ownership conflicts: {len(conflicts)}")
    if conflicts:
        total_conflicts = sum(c["conflict_count"] for c in conflicts)
        print(f"  - Total conflicting tokens: {total_conflicts}")
        print(f"\nTop 10 by conflict count:")
        for c in conflicts[:10]:
            print(f"    {c['convex_wallet']}: {c['conflict_count']} conflicts")

if __name__ == "__main__":
    main()
