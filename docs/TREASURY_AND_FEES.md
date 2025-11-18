# Treasury and Platform Fees

This repo hard-codes the platform fee recipient and amount to avoid fragile
runtime configuration for critical inscription flows.

## Configuration Files

- Server (Convex): `convex/treasury.config.ts`
  - `TREASURY_ADDRESS = 't1YbJR1f6fv5LkTG1avBQFH1UtRT5hGGxDh'`
  - `PLATFORM_FEE_ZATS = 100000` (0.001 ZEC)
- Client/UI: `src/config/treasury.config.ts`
  - Same constants for consistent display and client-side building paths.

UI fee helpers read from `src/config/fees.ts`, which now imports the treasury
address from the client config.

## Where the Fee Is Applied

- Commit transaction outputs include:
  - Inscription P2SH output (value = `inscriptionAmount`)
  - Platform fee P2PKH output (value = `PLATFORM_FEE_ZATS`) → `TREASURY_ADDRESS`
  - Change output back to the minter (if above dust)
- Reveal transaction outputs do not include fees.

Relevant code:
- Commit sighash (client signing): `convex/zcashHelpers.ts:474`
- Commit assembly (client signing): `convex/zcashHelpers.ts:500`
- Commit build (server signing): `convex/zcashHelpers.ts:260`
- Server actions (platform fee persisted for audit):
  - `convex/inscriptionsActions.ts`
  - `convex/jobsActions.ts`

## Best Practices Adopted

- No env dependency for treasury address/fee in critical paths.
- Always include the platform fee output during inscription commits.
- Persist `platformFeeZat` and `treasuryAddress` with each inscription for
  auditability.
- Compute change as `input - inscription - txfee - platformFee` and drop change
  output if below dust.
- Construct fee output using P2PKH derived from the hard-coded address via
  `addressToPkh()`. If decoding ever fails, commit assembly throws fast.

## Changing the Treasury Address or Fee

- Update both config files:
  - `convex/treasury.config.ts`
  - `src/config/treasury.config.ts`
- Optional: adjust client-side `PLATFORM_FEES` constants in `src/config/fees.ts`
  if different products (e.g., name registration) use different fees.

## Notes

- Values are in zatoshis. 1 ZEC = 100,000,000 zatoshis.
- Fee visibility in the confirmation modal now references config rather than
  env flags.

