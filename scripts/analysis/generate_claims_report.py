#!/usr/bin/env python3
"""Offline analyzer for Convex snapshot data.

Reads collectionClaims and collectionClaimEvents JSONL dumps along with the
local allowlist JSON to produce CSV summaries in temp/analysis/.
"""
from __future__ import annotations

import argparse
import csv
import json
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set, Tuple

SNAPSHOT_ROOT = Path("temp/snapshots")
OUTPUT_DIR = Path("temp/analysis")
ALLOWLIST_DIR = Path("convex/whitelists")

@dataclass
class AddressSummary:
    address: str
    allocation: int = 0
    is_vip: bool = False
    minted_tokens: Set[int] = field(default_factory=set)
    reserved_tokens: Set[int] = field(default_factory=set)
    failed_count: int = 0
    failure_reasons: Counter = field(default_factory=Counter)
    inscription_tokens: Set[int] = field(default_factory=set)
    issues: Set[str] = field(default_factory=set)

    def to_row(self) -> List[str]:
        minted_count = len(self.minted_tokens)
        reserved_count = len(self.reserved_tokens)
        remaining_allocation = self.allocation - minted_count
        remaining_after_reservations = self.allocation - minted_count - reserved_count
        over_allocated = minted_count > self.allocation
        if over_allocated:
            self.issues.add("over_allocated")
        highlight = "red" if over_allocated else ""
        minted_list = ",".join(str(t) for t in sorted(self.minted_tokens))
        reserved_list = ",".join(str(t) for t in sorted(self.reserved_tokens))
        inscription_list = ",".join(str(t) for t in sorted(self.inscription_tokens))
        failure_info = ";".join(
            f"{reason}:{count}" for reason, count in sorted(self.failure_reasons.items())
        ) or "-"
        return [
            self.address,
            str(self.allocation),
            "yes" if self.is_vip else "no",
            str(minted_count),
            str(remaining_allocation),
            str(remaining_after_reservations),
            "YES" if over_allocated else "",
            minted_list,
            str(reserved_count),
            reserved_list,
            str(self.failed_count),
            failure_info,
            str(len(self.inscription_tokens)),
            inscription_list,
            ";".join(sorted(self.issues)) or "-",
            highlight,
        ]


def load_jsonl(path: Path) -> Iterable[dict]:
    with path.open() as fh:
        for line in fh:
            line = line.strip()
            if not line:
                continue
            yield json.loads(line)


def load_allowlist(slug: str) -> Dict[str, dict]:
    allowlist_file = ALLOWLIST_DIR / f"{slug}.json"
    if not allowlist_file.exists():
        raise FileNotFoundError(f"Allowlist file not found: {allowlist_file}")
    data = json.loads(allowlist_file.read_text())
    normalized = {}
    for addr, meta in data.items():
        normalized[addr.lower()] = meta
    return normalized


def analyze_collection(slug: str, snapshot_root: Path) -> None:
    slug = slug.lower()
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    allowlist = load_allowlist(slug)
    address_summary: Dict[str, AddressSummary] = {
        addr: AddressSummary(
            address=addr,
            allocation=int(meta.get("max", 0)),
            is_vip=bool(meta.get("isVip")),
        )
        for addr, meta in allowlist.items()
    }
    token_history: Dict[int, List[dict]] = defaultdict(list)

    claims_path = snapshot_root / "collectionClaims" / "documents.jsonl"
    for doc in load_jsonl(claims_path):
        if doc.get("collectionSlug") != slug:
            continue
        address = (doc.get("address") or "").lower()
        token_id = int(doc.get("tokenId"))
        status = doc.get("status")
        updated = doc.get("updatedAt") or doc.get("_creationTime") or 0

        summary = address_summary.setdefault(address, AddressSummary(address=address))
        if address in allowlist:
            summary.allocation = int(allowlist[address].get("max", summary.allocation))
            summary.is_vip = bool(allowlist[address].get("isVip"))
        if status == "minted":
            summary.minted_tokens.add(token_id)
        elif status == "reserved":
            summary.reserved_tokens.add(token_id)
        elif status == "failed":
            summary.failed_count += 1
            reason = doc.get("lastError") or "unknown"
            summary.failure_reasons[reason] += 1

        token_history[token_id].append({
            "address": address,
            "status": status,
            "updatedAt": updated,
            "doc": doc,
        })

    events_path = snapshot_root / "collectionClaimEvents" / "documents.jsonl"
    inscription_events: Dict[int, List[Tuple[str, dict]]] = defaultdict(list)
    for event in load_jsonl(events_path):
        if event.get("collectionSlug") != slug:
            continue
        if not event.get("inscriptionId"):
            continue
        address = (event.get("address") or "").lower()
        token_id = int(event.get("tokenId"))
        inscription_events[token_id].append((address, event))
        summary = address_summary.setdefault(address, AddressSummary(address=address))
        summary.inscription_tokens.add(token_id)
        if address in allowlist:
            summary.allocation = int(allowlist[address].get("max", summary.allocation))
            summary.is_vip = bool(allowlist[address].get("isVip"))

    # Detect token-level issues
    token_report_rows: List[List[str]] = []
    header = [
        "tokenId",
        "finalStatus",
        "finalAddress",
        "historyLength",
        "inscriptionAddresses",
        "issues",
    ]
    duplicate_inscriptions_rows: List[List[str]] = []
    reserved_without_inscription_rows: List[List[str]] = []
    inscribed_missing_rows: List[List[str]] = []
    for token_id, history in token_history.items():
        history.sort(key=lambda h: h["updatedAt"] or 0)
        latest = history[-1]
        issues = set()
        addresses_in_history = {h["address"] for h in history}
        if len(addresses_in_history) > 1:
            issues.add("address_changed")
        if len({h["status"] for h in history}) > 1:
            issues.add("status_changed")
        has_inscription = token_id in inscription_events
        if has_inscription:
            event_addresses = {addr for addr, _ in inscription_events[token_id]}
            if latest["status"] != "minted":
                issues.add("inscribed_missing_mint")
                inscribed_missing_rows.append([
                    str(token_id),
                    latest["status"],
                    latest["address"],
                    str(len(history)),
                    ",".join(sorted(event_addresses)),
                    str(len(event_addresses)),
                ])
            if latest["address"] not in event_addresses:
                issues.add("inscribed_address_mismatch")
                summary = address_summary.setdefault(latest["address"], AddressSummary(address=latest["address"]))
                summary.issues.add("token_mismatch")
                for addr in event_addresses:
                    address_summary.setdefault(addr, AddressSummary(address=addr)).issues.add("token_mismatch")
            if len(event_addresses) > 1:
                duplicate_inscriptions_rows.append([
                    str(token_id),
                    ",".join(sorted(event_addresses)),
                    latest["address"],
                    latest["status"],
                ])
        if latest["status"] == "minted":
            addr_summary = address_summary.setdefault(latest["address"], AddressSummary(address=latest["address"]))
            if latest["address"] not in allowlist:
                addr_summary.issues.add("not_in_allowlist")
                issues.add("unlisted_address")
        if latest["status"] == "reserved" and not has_inscription:
            reserved_without_inscription_rows.append([
                str(token_id),
                latest["address"],
                str(latest.get("updatedAt") or 0),
            ])
        token_report_rows.append([
            str(token_id),
            latest["status"],
            latest["address"],
            str(len(history)),
            ",".join({addr for addr, _ in inscription_events.get(token_id, [])}) or "-",
            ";".join(sorted(issues)) or "-",
        ])

    # Write CSVs
    claims_out = OUTPUT_DIR / f"{slug}_address_claims.csv"
    with claims_out.open("w", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow([
            "address",
            "allocation",
            "isVip",
            "mintedCount",
            "remainingAllocation",
            "remainingAfterReservations",
            "overAllocated",
            "mintedTokens",
            "reservedCount",
            "reservedTokens",
            "failedCount",
            "failedReasons",
            "inscriptionCount",
            "inscriptionTokens",
            "issues",
            "highlight",
        ])
        for addr, summary in sorted(address_summary.items()):
            writer.writerow(summary.to_row())

    tokens_out = OUTPUT_DIR / f"{slug}_token_history.csv"
    with tokens_out.open("w", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(header)
        for row in sorted(token_report_rows, key=lambda r: int(r[0])):
            writer.writerow(row)

    print(f"Wrote {claims_out} and {tokens_out}")

    duplicates_out = OUTPUT_DIR / f"{slug}_duplicate_inscriptions.csv"
    with duplicates_out.open("w", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["tokenId", "inscriptionAddresses", "finalAddress", "finalStatus"])
        for row in sorted(duplicate_inscriptions_rows, key=lambda r: int(r[0])):
            writer.writerow(row)

    reserved_out = OUTPUT_DIR / f"{slug}_reserved_pending.csv"
    with reserved_out.open("w", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow(["tokenId", "address", "lastUpdated"])
        for row in sorted(reserved_without_inscription_rows, key=lambda r: int(r[0])):
            writer.writerow(row)

    print(f"Also wrote {duplicates_out} and {reserved_out}")

    inscribed_out = OUTPUT_DIR / f"{slug}_inscribed_missing_mint.csv"
    with inscribed_out.open("w", newline="") as fh:
        writer = csv.writer(fh)
        writer.writerow([
            "tokenId",
            "finalStatus",
            "finalAddress",
            "historyLength",
            "inscriptionAddresses",
            "inscriptionCount",
        ])
        for row in sorted(inscribed_missing_rows, key=lambda r: int(r[0])):
            writer.writerow(row)

    print(f"And wrote {inscribed_out}")


def main():
    parser = argparse.ArgumentParser(description="Analyze Convex claim snapshot data")
    parser.add_argument("slug", nargs="?", default="zgods", help="Collection slug to analyze (default: zgods)")
    parser.add_argument(
        "--snapshot-root",
        dest="snapshot_root",
        default=str(SNAPSHOT_ROOT),
        help="Path to the snapshot directory (default: temp/snapshots)",
    )
    args = parser.parse_args()
    snapshot_root = Path(args.snapshot_root)
    analyze_collection(args.slug, snapshot_root)

if __name__ == "__main__":
    main()
