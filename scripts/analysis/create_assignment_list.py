#!/usr/bin/env python3
import csv
from pathlib import Path

# Load on-chain taken IDs
taken = set()
with open('/Users/cloutcoin/GitHub/zord/zgods_collection.csv') as f:
    for line in f:
        if line.startswith('address,'): continue
        parts = line.strip().split(',')
        if len(parts) < 3: continue
        taken.update(int(x) for x in parts[2:] if x.strip())

# Available IDs
available = sorted(set(range(10000)) - taken)

# Load allowlist allocations
allowlist = {}
with open('convex/whitelists/zgods.json') as f:
    import json
    data = json.load(f)
    for addr, meta in data.items():
        allowlist[addr.lower()] = {'max': meta.get('max', 0), 'isVip': meta.get('isVip', False)}

# Load prod invalid claims
invalid = {}
with open('temp/analysis/zgods_invalid_claims_FINAL.csv') as f:
    reader = csv.DictReader(f)
    for row in reader:
        invalid[row['wallet'].lower()] = int(row['invalid_count'])

# Calculate needs
needs = []
for addr, meta in allowlist.items():
    allocation = meta['max']
    invalid_count = invalid.get(addr, 0)
    # Need = allocation - valid_claimed + invalid_to_replace
    # Simplified: just use allocation as max need
    if invalid_count > 0 or allocation > 0:
        needs.append({'wallet': addr, 'allocation': allocation, 'invalid': invalid_count, 'isVip': meta['isVip']})

# Sort VIPs first, then by allocation desc
needs.sort(key=lambda x: (not x['isVip'], -x['allocation']))

# Create outputs
Path('temp/analysis').mkdir(exist_ok=True)

with open('temp/analysis/TAKEN_IDS.csv', 'w') as f:
    f.write('tokenId\n')
    for tid in sorted(taken):
        f.write(f'{tid}\n')

with open('temp/analysis/AVAILABLE_IDS.csv', 'w') as f:
    f.write('tokenId\n')
    for tid in available:
        f.write(f'{tid}\n')

with open('temp/analysis/ASSIGNMENT_NEEDED.csv', 'w', newline='') as f:
    writer = csv.DictWriter(f, ['wallet', 'allocation', 'invalid_count', 'isVip'])
    writer.writeheader()
    for n in needs:
        writer.writerow({'wallet': n['wallet'], 'allocation': n['allocation'], 'invalid_count': n['invalid'], 'isVip': n['isVip']})

print(f"Taken IDs: {len(taken)}")
print(f"Available IDs: {len(available)}")
print(f"Wallets needing assignment: {len(needs)}")
print(f"\nFiles created:")
print(f"  temp/analysis/TAKEN_IDS.csv - {len(taken)} IDs")
print(f"  temp/analysis/AVAILABLE_IDS.csv - {len(available)} IDs")
print(f"  temp/analysis/ASSIGNMENT_NEEDED.csv - {len(needs)} wallets")
