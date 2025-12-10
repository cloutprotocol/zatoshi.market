#!/usr/bin/env python3
"""
Generate final report: wallet, tokens_claimed, invalid_count, invalid_ids

This combines:
1. Tokens that don't exist on-chain at all (invalid re-inscriptions that failed)
2. Tokens that exist on-chain but belong to a different owner (re-inscriptions that succeeded but are invalid)
"""

import csv
from pathlib import Path
from typing import Dict, Set

ONCHAIN_MASTER = Path("/Users/cloutcoin/GitHub/zord/zgods_collection.csv")
CONVEX_CLAIMS = Path("temp/analysis/zgods_address_claims.csv")
OUTPUT_FILE = Path("temp/analysis/zgods_final_invalid_report.csv")

def parse_token_ids(token_str: str) -> Set[int]:
    if not token_str or token_str == "-":
        return set()
    return {int(tid.strip()) for tid in token_str.split(",") if tid.strip()}

def load_onchain_master() -> Dict[int, str]:
    token_to_owner = {}
    with ONCHAIN_MASTER.open() as f:
        reader = csv.DictReader(f)
        for row in reader:
            address = row["address"].lower()
            token_ids = parse_token_ids(row["TOKEN IDS"])
            for token_id in token_ids:
                token_to_owner[token_id] = address
    return token_to_owner

def generate_final_report(token_to_owner: Dict[int, str]) -> list:
    report = []

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

            invalid_tokens = []

            for token_id in claimed_tokens:
                if token_id not in token_to_owner:
                    # Token doesn't exist on-chain = invalid
                    invalid_tokens.append(token_id)
                else:
                    onchain_owner = token_to_owner[token_id]
                    if onchain_owner != convex_address:
                        # Token exists but belongs to someone else = invalid
                        invalid_tokens.append(token_id)

            if invalid_tokens:
                invalid_ids_str = ",".join(str(tid) for tid in sorted(invalid_tokens))
                report.append({
                    "wallet": convex_address,
                    "tokens_claimed": minted_count,
                    "invalid_count": len(invalid_tokens),
                    "invalid_ids": invalid_ids_str
                })

    return report

def main():
    print("Loading on-chain master index...")
    token_to_owner = load_onchain_master()
    print(f"  - {len(token_to_owner)} tokens on-chain")

    print("\nGenerating final invalid claims report...")
    report = generate_final_report(token_to_owner)

    # Sort by invalid count (descending)
    report.sort(key=lambda x: x["invalid_count"], reverse=True)

    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)

    with OUTPUT_FILE.open("w", newline="") as f:
        fieldnames = ["wallet", "tokens_claimed", "invalid_count", "invalid_ids"]
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(report)

    print(f"\n✅ Final report: {OUTPUT_FILE}")
    print(f"\nSummary:")
    print(f"  - Total addresses with invalid claims: {len(report)}")

    total_invalid = sum(r["invalid_count"] for r in report)
    total_claimed = sum(r["tokens_claimed"] for r in report)

    print(f"  - Total tokens claimed in Convex: {total_claimed}")
    print(f"  - Total invalid tokens: {total_invalid}")
    print(f"  - Validity rate: {((total_claimed - total_invalid) / total_claimed * 100):.1f}%")

    print(f"\nTop 20 addresses by invalid claim count:")
    for r in report[:20]:
        print(f"  {r['wallet']}: {r['invalid_count']}/{r['tokens_claimed']} invalid")

if __name__ == "__main__":
    main()
