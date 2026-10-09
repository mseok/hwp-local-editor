# HWP Local Editor

A local HWP/HWPX browser editor for Codex/Claude computer-use workflows, with incremental recovery and independent working copies for multiple documents. Built on [rhwp](https://github.com/edwardkim/rhwp), an MIT-licensed Rust/WASM parser, renderer, Studio UI and embedding SDK.

This repository contains the local shell and source patches against rhwp v0.8.7. It is not a reimplementation of the rhwp engine, nor an official Hancom product.

The full agent-workflow goal and outstanding completion gates are tracked in [agent-workflow acceptance](docs/agent-workflow-acceptance.md). Passing a tested editing route does not establish universal Hancom compatibility.

## Features

- Open HWP/HWPX files in a browser or an embedded local browser panel.
- Register several local files once, then open each through its browser link without automating file uploads.
- Let an agent inspect accessible body/table text, operate find/replace or rich editing controls, and save results into a designated local folder.
- Reopen exported results and check text, source format and reported content losses before publication; reject stale duplicate-tab saves.
- Block exports with reported data loss before delivering a result, download or preview snapshot. Keep the original and edit journal.
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

The local build disables upstream PWA registration. Before creating an editor iframe, the host retires only the upstream worker registered for this origin’s `/rhwp/` scope, so a cached UI/engine cannot override a freshly built version. Other service-worker scopes and browser recovery copies are preserved.

Run `node scripts/check-build.mjs` after updating the repository. The task launcher and server reject missing or stale builds instead of mixing current controls with an older engine. Rebuild when this check fails, preserving an older managed cache rather than deleting it.

## Automatic document editing through an agent

After building, install the task skill for local Codex and Claude Code:

```sh
node scripts/install-skill.mjs
```

Use `--codex-only` to install only for Codex. This installs instructions and a local repository pointer, not an LLM service or credentials. A new session/reload may be needed for skill discovery. The installed skill explains how to handle files, edit through browser computer use, verify outputs and return file links. Claude must have its own working browser/computer-use tools; its execution has not been tested here.

Give the agent the files and the edits to make. It starts a task workspace using:

```sh
node scripts/open.mjs --output local/results/task-001 --port 8766 document.hwp second-document.hwpx
```

The command prints the manifest, output directory and `/tasks` URL, then runs the local server. Use an unused port; preserve existing servers and tabs. Each document gets a direct editor link and its own result path. Register only files the user asked to edit. No arbitrary file-path endpoint is exposed.

The agent opens the task list in a background browser, edits separate tabs, clicks **결과 파일 저장**, inspects the result and returns the files. The source is never overwritten. The output folder receives editable HWP/HWPX files plus per-file `.receipt.json` records. To resume after stopping the owned server, start it with the saved `DOCUMENT_MANIFEST` and the same `PORT`.

Natural-language planning stays with Codex/Claude; this app supplies editing controls and file handling. It does not call a model automatically or run an agent without a browser tool. Validation checks engine reopening, text, format and reported export losses. A zero-loss report does not certify native Hancom layout or every special object; some unsupported properties may not be reported by the engine.

## Fonts and layout

Private documents, signatures, personnel information, proprietary font binaries, converted font outlines and locally extracted font-metric tables are not distributed here. This public build uses upstream open-font fallbacks. It does not promise pixel-identical Hancom output or support for every special object.

To supply fonts that you have permission to use, copy font-config.example.json to local/font-config.json, edit the paths and family/weight metadata, and run:

```sh
FONT_CONFIG=local/font-config.json npm start
```

Font files are read only from this explicitly configured list and served only over loopback. Do not commit your fonts or local configuration. A font being installed does not imply permission to redistribute it. Specialized document-specific rendering profiles and their private reference PDFs are intentionally excluded.

## Persistence and privacy

Working copies and command logs remain in this browser profile's IndexedDB. With `scripts/open.mjs`, registered sources are read from disk and explicitly saved results/receipts are written only to the selected output directory. The save endpoint validates the same-origin request, document identity, revision, text fingerprint, source format and preservation reports. There is no cloud sync or analytics. The server listens only on 127.0.0.1 and validates the Host header. Do not expose this server through a tunnel or public reverse proxy.

Download important finished work. Browser storage can be cleared, evicted or fail on quota; it is a recovery aid, not an archival backup. A forced close before a pending transaction completes can lose the newest changes. Recovery logs from incompatible engine versions are rejected.

## Verification

```sh
npm test
npm run audit
# After building, start the server in another terminal.
npm install --no-save --package-lock=false playwright
npx playwright install chromium
npm run test:browser
npm run test:agent
npm run test:complex
npm run test:format
npm run test:nested
npm run test:table-split
npm run test:table-object
npm run test:table-move
```

The browser check uses synthetic documents created by the engine, never private fixtures. See docs/verification.md for the tested public release and boundaries.

## License

MIT. Preserve upstream attribution in NOTICE and licenses/rhwp-MIT.txt. Runtime components and fonts have their own notices summarized in licenses/rhwp-THIRD_PARTY_LICENSES.md; the build fetches these from upstream. Do not add private documents, credential files or unlicensed assets to this repository.
