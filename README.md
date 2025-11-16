# Zordinals.market

**The premiere marketplace for Zerdinals & ZRC20 on Zcash**

A modern, privacy-focused marketplace for discovering, trading, and minting ZRC20 tokens and Zerdinal inscriptions on the Zcash blockchain.

## Features

- **Privacy First**: Built on Zcash, ensuring transaction privacy and security
- **Beautiful UI**: Retro dithered background effect with modern, responsive design
- **ZRC20 Support**: Full support for ZRC20 token protocol
- **Zerdinals Marketplace**: Browse and trade unique digital artifacts inscribed on Zcash

## Tech Stack

- **Next.js 14** - React framework for production
- **TypeScript** - Type safety and better developer experience
- **Tailwind CSS** - Utility-first CSS framework
- **Three.js + React Three Fiber** - 3D graphics and shader effects
- **Postprocessing** - Advanced visual effects for the dither background

## Getting Started

### Prerequisites

- Node.js 18+
- npm or yarn

### Installation

```bash
# Install dependencies
npm install

# Run development server
npm run dev

# Build for production
npm run build

# Start production server
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
zordinals.market/
├── src/
│   ├── app/              # Next.js app directory
│   │   ├── layout.tsx    # Root layout
│   │   ├── page.tsx      # Homepage
│   │   └── globals.css   # Global styles
│   └── components/       # React components
│       ├── Dither.tsx    # Shader-based background effect
│       └── Dither.css    # Dither component styles
├── public/               # Static assets
├── package.json          # Dependencies and scripts
└── README.md            # This file
```

## ZRC-20 CLI Development Roadmap

This marketplace will eventually integrate with a custom ZRC-20 CLI tool. Here's the development strategy:

### Phase 1: CLI Prototype (Current Focus)

Build a lightweight CLI that uses existing Zerdinals infrastructure:

- **API Client**: Interface with zerdinals.com API endpoints
- **Transaction Building**: Client-side transaction construction and signing
- **Wallet Integration**: Local private key management
- **Core Commands**:
  - `deploy` - Deploy new ZRC20 tokens
  - `mint` - Mint tokens to addresses
  - `transfer` - Transfer tokens between addresses
  - `balance` - Check token balances

**Libraries to use:**
- `@mayaprotocol/zcash-js` or `WebZjs` for Zcash primitives
- Transaction signing and UTXO management
- JSON payload creation for ZRC-20 protocol

### Phase 2: Custom Indexer (Future)

Build independent infrastructure:

- **Full Zcash Node**: Run `zcashd` with full transaction indexing
- **Custom Indexer**: Parse blockchain for ZRC-20 inscriptions
- **Database**: PostgreSQL for token state and ownership
- **API Server**: Self-hosted API matching zerdinals endpoints
- **CLI Integration**: Point CLI to self-hosted infrastructure

### Phase 3: Marketplace Integration

Connect the marketplace frontend with CLI capabilities:

- **Web3 Wallet Support**: Browser-based transaction signing
- **Marketplace Listings**: On-chain orderbook or listing system
- **Trading Interface**: Buy/sell ZRC20 tokens and Zerdinals
- **Portfolio Dashboard**: Track holdings and activity

## Contributing

This is an early-stage project. Contributions, issues, and feature requests are welcome!

## Resources

- [ZRC-20 Protocol Documentation](https://docs.zerdinals.com)
- [Zcash Developer Docs](https://zcash.readthedocs.io/)
- [Next.js Documentation](https://nextjs.org/docs)

## License

MIT

---

Built with privacy and security on Zcash
