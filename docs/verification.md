# Public release verification

Verified on 2026-10-09 with Node.js 24.19.0, Rust 1.93.1 and wasm-bindgen 0.2.127, using the pinned public rhwp v0.8.7 source plus this repository's patch and overlay. No private reference files or locally extracted font tables were used.

## Passed

- Fresh locked WASM build and TypeScript/Vite Studio build.
- Six automated unit/server tests: command capture, acknowledgement during concurrent edits, undo handle remapping, invalid replay rejection, failure state, binary-input copying, and allowlisted loopback routes.
- Eight browser checks: unchanged-byte download, journal saving without whole-document export, recovery/forking, two independent windows, edited HWPX reopen, preview rendering, edited HWP reopen, and no page errors or external runtime requests in this synthetic-document session.
- Visual inspection of the synthetic editor screenshot.
- Source-only release allowlist and credential/local-path checks.
- Preserved upstream MIT license matched the pinned GitHub source byte-for-byte.

The browser fixtures derive from the upstream public blank template and synthetic text. The public repository has no document, font or compiled WASM binaries. Build outputs, browser recovery data and local QA files are excluded from Git.

## Boundaries

This is an experimental local editor, not a claim of complete Hancom compatibility. The public release has not been checked for pixel-identical Hancom output, every special object, all encrypted formats or operating-system Korean IME behavior. Password-protected edited export/plaintext recovery is intentionally blocked. The public build uses upstream open-font fallbacks unless a user explicitly supplies legally usable local fonts.

IndexedDB saves are asynchronous and depend on browser quota and retention. Download finished work; recovery copies are not a durable archive. Separate windows do not merge changes.

## Re-run

Run npm test, npm run audit and, after building and starting the server, npm run test:browser. The audit expects release files to be staged. The browser test requires Playwright with a Chromium installation; PLAYWRIGHT_PACKAGE_PATH and PLAYWRIGHT_EXECUTABLE_PATH can point to an existing installation. Test reports and screenshots are written to ignored test-results/.
