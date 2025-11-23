# Edge Case Report: Failed Inscriptions with Valid IDs

**Generated:** 2025-11-23
**Collection:** zgods
**Total Edge Cases:** 38
**Unique Users Affected:** 28

---

## Executive Summary

During the reconciliation process, **38 tokens** were identified as edge cases that require manual review. These cases involve either:
1. **Tokens already minted** (4 cases) - Where a token has a successful mint but also failed inscription attempts
2. **Multiple failed inscriptions** (34 cases) - Where multiple inscription attempts failed for the same token

### User Allocation Status

- **Fully Allocated (17 users):** Users who have already claimed their full allocation
- **Partially Allocated (10 users):** Users who have remaining allocation available
- **None Allocated (1 user):** User with no successful mints yet

---

## High-Priority Cases

### 1. Users with Zero Mints (Need Immediate Attention)

**Token 5392** - User: `t1bb4co8dzr6chaxdhtcgddwbealrnepeoj`
- **Allocation:** 10
- **Claimed:** 0 ❌
- **Remaining:** 10
- **Issue:** 3 failed inscription attempts, no successful mints
- **Inscription IDs:**
  - `3415ce5156319f401467a0496e82430859503187c96f854c974b7e7f7210053bi0`
  - `f4167544047dcf012825995200e14b4ec5cce96d3e95665a208df7f52344ce73i0`
  - `a496806fde02b8f8a523847fcba84c8a8b80875ff5eea49395d0aca5e5a38624i0`
- **Action Required:** Verify which inscription (if any) succeeded on-chain and credit the user

---

### 2. Users Over Allocation (Potential Issues)

#### Token 1680 - User: `t1qunysptkw1jvmv2abfvljustmikybvfiy`
- **Allocation:** 46
- **Claimed:** 50 ⚠️ (4 over)
- **Remaining:** -4
- **Failed Attempts:** 3 different inscription IDs
- **Status:** User has exceeded allocation, multiple failed attempts exist

#### Token 6390 - User: `t1px7hlrau7co9lk3k81jcrntnilhrwgoxj`
- **Allocation:** 50
- **Claimed:** 62 ⚠️ (12 over)
- **Remaining:** -12
- **Failed Attempts:** 11 different inscription IDs (most repeated: `6b91da014284b109e84c46217e20bb4ad90c0406fadb792a23c336237b320b2fi0` - 6 times)
- **Status:** User significantly over allocation

#### Token 2245 - User: `t1nveuzt6vcr9tm2p2xd1gxdbnwyo6rrd39`
- **Allocation:** 50
- **Claimed:** 82 ⚠️ (32 over)
- **Remaining:** -32
- **Failed Attempts:** 3 different inscription IDs
- **Status:** Severely over allocation

#### Token 2658 - User: `t1fcmnktgqtxnnsq9llfxityrj12uteieuk`
- **Allocation:** 50
- **Claimed:** 92 ⚠️ (42 over)
- **Remaining:** -42
- **Failed Attempts:** 4 different inscription IDs
- **Status:** Severely over allocation

---

## Cases by Category

### Category A: Already Minted Tokens (4 cases)

These tokens have been successfully minted but also have failed inscription attempts recorded.

#### 1. Token 2858
- **Minted To:** `t1kcuw1npvr56on7dbzkddjob41akjlwe2h` (87/50 claimed, -37 remaining)
- **Failed Attempt From:** `t1cufblk8osimwlfkpnt815kcsllnjqetwk` (51/50 claimed, -1 remaining)
- **Minted Inscription:** `da4f277f0a55f77b632fb8b5b05f84f3e33c2e0965539ead7946ce566dc522d6i0`
- **Failed Inscription:** `f0bec55999af1aee722348a6f82b76f8d9041908ca032a8ffa9c94584985578bi0`
- **Action:** No action needed - keep minted version

#### 2. Token 778
- **Minted To:** `t1qvsgshrmywnykp5dbfpzezgcqnnrn9fuj` (3/10 claimed, 7 remaining)
- **Failed Attempt From:** `t1aphfzzmcujqhuenxl5odscmyv97ti5dwv` (49/50 claimed, 1 remaining)
- **Minted Inscription:** `72903dd1283de2a1b4b189df70330349a1f77852e25f6b0bdf010a919e772430i0`
- **Failed Inscription:** `c4507b1e0e5cbcb2163a057f27eead1bae3d4cff3911cd3d9ca0d00f84a0d270i0`
- **Action:** No action needed - keep minted version

#### 3. Token 3665
- **Minted To:** `t1qvsgshrmywnykp5dbfpzezgcqnnrn9fuj` (3/10 claimed, 7 remaining)
- **Failed Attempt From:** `t1ls3lszpnhsc73sva1vxdteuwkprr9xwmv` (25/15 claimed, -10 remaining ⚠️)
- **Minted Inscription:** `ea6a9cb241f088d2e8440a8a7209abf79fa0aae9c2386ce6eea49a13df7911cdi0`
- **Failed Inscription:** `1125c30abfd985719c61312bfabcf194fda5736e2b54a07b0eb8bc655d80f210i0`
- **Action:** No action needed - keep minted version

#### 4. Token 5561
- **Minted To:** `t1rmhswkzucw9ub1owuggjwv6lbrvbfxczv` (34/50 claimed, 16 remaining)
- **Failed Attempts:** 4 inscription IDs (3 duplicates)
- **Minted Inscription:** (already in claims table)
- **Failed Inscriptions:**
  - `30871a3bef47111c0b9335affff075a4028e79e78b42d968fba50a24d45b195ci0`
  - `4bc50675a1760d014691f65b6f1be3284272dc80a63fb642f867308a1550ac88i0` (x2)
  - `c2076066fded57b6e9f52f70e66fadbf39a59ed04999e7870da6b05d3ebd1466i0`
- **Action:** No action needed - keep minted version

---

### Category B: Multiple Failed Inscriptions (34 cases)

#### Extreme Cases (>10 attempts)

**Token 8764** - User: `t1zybnnvwk71nxwnwh56brslsjsedo1utre`
- **Allocation:** 2
- **Claimed:** 3
- **Remaining:** -1
- **Failed Attempts:** **13** different inscription IDs
- **Action:** Verify on-chain which inscription (if any) succeeded. User is already over allocation.

**Token 6390** - User: `t1px7hlrau7co9lk3k81jcrntnilhrwgoxj` + `t1rsq4gsyy9b4nzndczrgbwhfdlbumj5uxd`
- **Primary User Allocation:** 50
- **Primary User Claimed:** 62 (12 over)
- **Secondary User:** 17 allocation, 2 claimed
- **Failed Attempts:** **11** inscription IDs (6 are duplicates)
- **Action:** User already over allocation. Verify if any failed inscription should be credited to secondary user.

---

#### High-Impact Cases (Users with Remaining Allocation)

**Token 228** - Multiple Users
- **User 1:** `t1xyrfax3c7zbwfxmqcfsqxbmtngrnjhygh` (10/5 claimed, -5 remaining ⚠️)
- **User 2:** `t1qvsgshrmywnykp5dbfpzezgcqnnrn9fuj` (3/10 claimed, **7 remaining** ✅)
- **Failed Attempts:** 3 inscription IDs (1 duplicate)
- **Action:** User 2 has 7 remaining allocation - verify which inscription should be credited

**Token 3326** - Multiple Users
- **User 1:** `t1rjxectx3e63ydhaerxyynqck71mp117ty` (49/50 claimed, **1 remaining** ✅)
- **User 2:** `t1xzzv9apfaq5ypoekiegwcq2tuf4vr1g2a` (7/30 claimed, **23 remaining** ✅)
- **Failed Attempts:** 2 different inscription IDs
- **Action:** Both users have remaining allocation - determine which user's inscription succeeded

**Token 1544, 1952, 901, 7628** - User: `t1qr5zva26etiovwiahfuqv2ay8d9jltdan`
- **Allocation:** 50
- **Claimed:** 4
- **Remaining:** **46** ✅
- **Failed Tokens:** 4 different tokens, 2 attempts each
- **Action:** User has significant remaining allocation - verify all 4 tokens on-chain

**Token 6114, 7142, 9562, 1632, 7943** - User: `t1relemkcagbfnehud1r1jsu9dhpqwybapn`
- **Allocation:** 50
- **Claimed:** 10
- **Remaining:** **40** ✅
- **Failed Tokens:** 5 different tokens, 3-4 attempts each
- **Action:** User has 40 remaining allocation - verify all 5 tokens on-chain

---

## Users Summary

### Users with Significant Remaining Allocation

| Address | Allocation | Claimed | Remaining | Affected Tokens |
|---------|-----------|---------|-----------|----------------|
| `t1qr5zva26etiovwiahfuqv2ay8d9jltdan` | 50 | 4 | **46** | 4 tokens |
| `t1relemkcagbfnehud1r1jsu9dhpqwybapn` | 50 | 10 | **40** | 5 tokens |
| `t1xzzv9apfaq5ypoekiegwcq2tuf4vr1g2a` | 30 | 7 | **23** | 1 token |
| `t1rmhswkzucw9ub1owuggjwv6lbrvbfxczv` | 50 | 34 | **16** | 3 tokens |
| `t1rsq4gsyy9b4nzndczrgbwhfdlbumj5uxd` | 17 | 2 | **15** | 4 tokens |
| `t1bb4co8dzr6chaxdhtcgddwbealrnepeoj` | 10 | 0 | **10** | 1 token ⚠️ |

### Users Over Allocation (Investigate)

| Address | Allocation | Claimed | Over By |
|---------|-----------|---------|---------|
| `t1fcmnktgqtxnnsq9llfxityrj12uteieuk` | 50 | 92 | **-42** |
| `t1kcuw1npvr56on7dbzkddjob41akjlwe2h` | 50 | 87 | **-37** |
| `t1nveuzt6vcr9tm2p2xd1gxdbnwyo6rrd39` | 50 | 82 | **-32** |
| `t1vf4k61qeseulhxpzkjch3nb3q1vw6fvx9` | 15 | 45 | **-30** |
| `t1ackjtwvbsfgafminnbmneegdypv9g3gca` | 36 | 59 | **-23** |
| `t1px7hlrau7co9lk3k81jcrntnilhrwgoxj` | 50 | 62 | **-12** |
| `t1ls3lszpnhsc73sva1vxdteuwkprr9xwmv` | 15 | 25 | **-10** |

---

## Recommended Actions

### Immediate (Priority 1)
1. **Token 5392** - User has 0 mints with 10 allocation. Verify on-chain and credit if valid.
2. **Tokens 1544, 1952, 901, 7628** - User `t1qr5zva26etiovwiahfuqv2ay8d9jltdan` has 46 remaining - verify all 4 tokens.
3. **Tokens 6114, 7142, 9562, 1632, 7943** - User `t1relemkcagbfnehud1r1jsu9dhpqwybapn` has 40 remaining - verify all 5 tokens.

### High Priority (Priority 2)
1. **Token 228** - User `t1qvsgshrmywnykp5dbfpzezgcqnnrn9fuj` has 7 remaining.
2. **Token 3326** - Two users with remaining allocation (1 and 23).
3. **Tokens 9887, 966** - User `t1rmhswkzucw9ub1owuggjwv6lbrvbfxczv` has 16 remaining.

### Investigate (Priority 3)
1. **Over-allocated users** - Determine how users exceeded their allocations.
2. **Token 8764** - 13 failed attempts from user with allocation of 2.
3. **Token 6390** - 11 failed attempts, user 12 over allocation.

---

## Next Steps

1. **On-Chain Verification:** Use a Zcash block explorer to verify which inscription IDs actually exist on-chain for each token.
2. **Credit Valid Inscriptions:** For users with remaining allocation and valid on-chain inscriptions, update their claims.
3. **Document Over-Allocation:** Investigate and document how users exceeded their allocations for future prevention.
4. **Manual Review:** For tokens with multiple different inscription IDs, manually determine which one is valid.

---

*Report generated by `adminReconcile:generateEdgeCaseReport`*
