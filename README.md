# HWP Local Editor

A local HWP/HWPX browser editor with incremental recovery and independent working copies for multiple documents. Built on [rhwp](https://github.com/edwardkim/rhwp), an MIT-licensed Rust/WASM parser, renderer, Studio UI and embedding SDK.

This repository contains the local shell and source patches against rhwp v0.8.7. It is not a reimplementation of the rhwp engine, nor an official Hancom product.

## Features

- Open HWP/HWPX files in a browser or an embedded local browser panel.
- Edit, preview and explicitly download a working copy. The original file is never overwritten.
- Record successful editing commands in IndexedDB rather than repeatedly exporting the full document while typing.
- Attempt a save after 300 ms of idle time or 1000 ms of continued input.
- Recover using the same source bytes and a matching engine/source fingerprint. Recovery creates a new working-copy ID.
- Keep separate documents and duplicate tabs independent. This is not collaborative merging.
- Handle native undo snapshot/fragment IDs during recovery.
- Exclude password-protected documents from plaintext recovery and edited export.

## Requirements and build

Use Node.js 22.18 or newer, npm, Git, Rust 1.93.1 with the wasm32-unknown-unknown target, and wasm-bindgen-cli 0.2.127.

```sh
rustup toolchain install 1.93.1
rustup target add wasm32-unknown-unknown --toolchain 1.93.1
cargo install wasm-bindgen-cli --version 0.2.127 --locked
npm run build
npm start
```

Open http://127.0.0.1:8766/editor. The build fetches a pinned public upstream revision and dependencies; runtime requests stay on the local server. PORT can select another port. Keep the same browser profile and origin to find existing recovery copies. The app must run from the server, not file:// URLs.

The build cache is ignored. If patches change, move .cache/rhwp aside before rebuilding. CARGO_BIN, WASM_BINDGEN_BIN and CARGO_TARGET_DIR can use an existing toolchain/cache.

## Fonts and layout

Private documents, signatures, personnel information, proprietary font binaries, converted font outlines and locally extracted font-metric tables are not distributed here. This public build uses upstream open-font fallbacks. It does not promise pixel-identical Hancom output or support for every special object.

To supply fonts that you have permission to use, copy font-config.example.json to local/font-config.json, edit the paths and family/weight metadata, and run:

```sh
FONT_CONFIG=local/font-config.json npm start
```

Font files are read only from this explicitly configured list and served only over loopback. Do not commit your fonts or local configuration. A font being installed does not imply permission to redistribute it. Specialized document-specific rendering profiles and their private reference PDFs are intentionally excluded.

## Persistence and privacy

Documents and command logs remain in this browser profile's IndexedDB. There is no upload endpoint, cloud sync or analytics in the local shell. The server listens only on 127.0.0.1 and validates the Host header. Do not expose this server through a tunnel or public reverse proxy.

Download important finished work. Browser storage can be cleared, evicted or fail on quota; it is a recovery aid, not an archival backup. A forced close before a pending transaction completes can lose the newest changes. Recovery logs from incompatible engine versions are rejected.

## Verification

```sh
npm test
npm run audit
# After building, start the server in another terminal.
npm install --no-save --package-lock=false playwright
npx playwright install chromium
npm run test:browser
```

The browser check uses synthetic documents created by the engine, never private fixtures. See docs/verification.md for the tested public release and boundaries.

## License

MIT. Preserve upstream attribution in NOTICE and licenses/rhwp-MIT.txt. Runtime components and fonts have their own notices summarized in licenses/rhwp-THIRD_PARTY_LICENSES.md; the build fetches these from upstream. Do not add private documents, credential files or unlicensed assets to this repository.
