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

## Agent workflow extension

Verified on 2026-10-09 with two synthetic documents containing Korean body text and a 2×2 table. Actual Codex in-app browser computer use opened both registered formats without a file chooser, replaced text in body and table, and saved separate HWP/HWPX results. Native Hancom was not opened and the user's existing private-editor tab was not changed.

Nine unit/server tests passed, including output ownership, source tampering, mismatched text/format, duplicate filenames, symlinks, cross-source destinations and receipt recovery. Nine additional browser checks covered multi-file registration, body/table edits and output saving, stale-tab rejection, output reopening and unchanged originals/table properties/body styles, cross-origin write rejection, preview rendering, preview-to-editor result association, server restart and absence of browser errors/external requests. These fixtures do not prove complex-object compatibility.

The portable task skill was installed for local Codex and Claude Code. Codex computer use was exercised; Claude skill discovery and live execution require its own session/tools and were not exercised.

## Re-run

Run npm test, npm run audit and, after building and starting the server, npm run test:browser. Run npm run test:agent for the multi-file workflow; it starts/stops its own server and uses a fresh ignored task directory. The audit expects release files to be staged. Browser tests require Playwright with a Chromium installation; PLAYWRIGHT_PACKAGE_PATH and PLAYWRIGHT_EXECUTABLE_PATH can point to an existing installation. Test reports and screenshots are written to ignored test-results/.
