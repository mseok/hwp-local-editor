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

## Complex documents and export preservation

Verified on 2026-10-09 after connecting the transaction-owned export report to the local host. The host rejects nonzero or malformed preservation reports before publishing results, downloads or preview snapshots. The server also reparses the result and checks the reopened model's export report. These checks use the report accompanying the exported bytes, not a separate client export.

Eleven unit/server checks, eight recovery/download browser checks, nine multi-file browser checks and eight complex-document browser checks passed. The complex synthetic fixtures contain 90 body paragraphs across three pages, a generated PNG, an equation, a footnote, a header and a table inside another table. Browser find/replace changes all three requested occurrences in body and both table levels. Saved HWP and HWPX outputs preserve the extracted text outside those replacements, image payload hashes, queried object properties, page count and unchanged source hashes; results reopen and preview successfully.

A deliberately missing image payload produces a real engine loss report. Result saving, manual download and preview snapshot creation all reject it. The original and persisted command journal remain intact. Failure notices remain visible even after a pending journal acknowledgement updates the autosave status. This does not claim that recovery of a damaged source can always be reopened into the editor.

Actual Codex in-app browser computer use additionally reopened the complex HWPX result, changed three occurrences across body/nested tables, saved revision 2 and reopened the file to confirm them. No native Hancom window was opened. A zero-loss report is not a universal loss detector: unsupported controls or attributes may be outside the engine's reporting coverage. Native Hancom layout and untested objects remain separate compatibility gates.

The launcher and server check build metadata against the current public patch, overlay and upstream pin before opening a task. Missing engine files, changed patches and a different upstream pin are rejected. A fresh build records its source version only after all engine/Studio/SDK outputs are copied. This avoids current host controls silently running with an older built engine after an update.

## Character formatting and table structure

Verified on 2026-10-09 with fresh synthetic HWP and HWPX documents. Five additional browser checks apply bold 14 pt centered body text, bold table-cell text, insert a row and column through the menus, recover the operation journal after reload, and delete a selected row and column. Reopened outputs preserve the requested character/paragraph properties, exact cell placement and expected deletions, unaffected body styles and source hashes. The tests require no browser errors, console warnings or external runtime requests.

These checks found and fixed two real UI defects: find-selected cells omitted the path required by character formatting, and table deletion updated flat cell coordinates while leaving a stale path and text selection. Toolbar controls and the row/column count field now have explicit accessible names. The general recovery test also waits for the newly selected filename, rather than accepting the previous document's ready flag while a file open is pending.

Actual Codex in-app browser computer use additionally changed a synthetic HWPX title and table-cell formatting, inserted a row and column, saved/reopened the result and deleted a selected column. The output's requested styles, dimensions and unchanged original hash were checked separately. Column insertion can grow a table beyond the page; this test does not establish automatic table fitting. One MutationObserver console error was observed in the in-app editor, with no matching error in the headless suites or task-list page; its origin is not yet established. Native Hancom and live Claude execution remain unverified.

## Re-run commands

Run npm test, npm run audit and, after building and starting the server, npm run test:browser. Run npm run test:agent for the multi-file workflow, npm run test:complex for complex objects and preservation failures, and npm run test:format for formatting and table structure; these start/stop their own servers and use fresh ignored task directories. The audit expects release files to be staged. Browser tests require Playwright with a Chromium installation; PLAYWRIGHT_PACKAGE_PATH and PLAYWRIGHT_EXECUTABLE_PATH can point to an existing installation. Test reports and screenshots are written to ignored test-results/.
