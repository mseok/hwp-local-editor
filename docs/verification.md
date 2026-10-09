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

## Table width and stale browser builds

Verified on 2026-10-09 with eleven unit/server checks, eight recovery/download checks, nine multi-file checks, eight complex-document checks and eight formatting/cache checks, 44 checks in total. Both formats now expose explicit table-width control through **표 → 표/셀 속성 → 기본 → 표 너비(mm)**. Zero or excessively small widths are rejected without closing the dialog. The persisted cell widths scale proportionally through the undo/recovery transaction. Inserted rows/columns, width changes and selected deletions survive file export/reopening and journal recovery; unaffected text styles and original hashes remain preserved.

A real stale service worker was installed in the browser test and confirmed to replace an iframe with a stale-build marker. Without the retirement fix, the same test failed because the editor never became ready. Restoring the fix made all eight checks pass. Opening the editor retires only the worker for the upstream `/rhwp/` scope before creating the document iframe, and loads the current Studio successfully. New local builds do not register the upstream PWA. This fixes a cache path that could otherwise bypass server-side build checks.

Actual Codex in-app browser computer use changed a saved synthetic HWPX table to 140 mm, saved revision 3, reopened the saved bytes and inspected the rendered page. A separate engine check measured 140.0034 mm, retained the 3×2 table and verified the original hash. No new MutationObserver error appeared in the observed reload/save/reopen sequence after worker retirement. The earlier error remains in the tab log; its exact throwing stack was not established. A further actual in-app-browser isolation check reproduced the same observer error in two static HTML pages containing only an empty iframe and a same-origin error-listener script, without Studio, SDK, WASM or application MutationObserver code. This separates the message from document-engine editing; the exact throwing/injecting stack is still unknown. Automatic table fitting, merged-cell width editing, native Hancom equivalence and live Claude execution remain unverified.


A further property comparison found that merely confirming table properties rounded untouched padding values to the displayed 0.1 mm precision. The dialog now preserves original HWPUNIT values whenever an input display has not changed. Fresh two-format tests use non-round table/cell padding, offsets, outer margins and spacing; all queried properties outside the requested dimensions remain exactly equal after width editing and reopening. Actual in-app-browser HWP editing additionally saved a 140 mm table, reopened the result and verified unchanged text, all other queried table properties and the original hash.

## Nested-cell selection and single replacement

Verified on 2026-10-09 with eleven unit/server checks, eight recovery/download checks, nine multi-file checks, eight complex-document checks, eight formatting/cache checks and seven nested-cell checks, 51 checks in total. The final build passes all six suites.

The original nested-cell regression failed because selectable search excluded deeper cells. Path-aware Find/F3 now returns ordinary text at every searched table depth and uses the full path for selection and single replacement. Next/previous search distinguishes cells whose matches share the same character offset. Existing native callers that omit the new path argument retain their previous search scope. Text boxes and equation scripts remain excluded from selectable search.

In both formats, the browser test finds one inner cell, applies bold 12 pt, reloads its command journal, replaces just that occurrence, saves and reopens the result. The surrounding text, outer table properties, outer-cell character runs, inner table dimensions and source hash remain equal. The changed inner text retains bold 12 pt. The tests require no browser errors, console warnings or external requests.

Actual Codex in-app browser editing also exposed a separate interaction hazard: closing the Find dialog for formatting discarded the replacement input. An empty replacement was consequently saved during QA and detected by reopening the result. The original remained intact. The dialog now retains the replacement input as well as the search query when reopened in the same editor. A regression test failed on the empty value before the fix and passes afterward. This field retention is not persistence across a page reload; inspect both fields before applying a replacement.

The in-app browser then edited both synthetic formats successfully. Saved HWP revision 3 and HWPX revision 4 reopen with both requested inner-cell replacements and bold 11/12 pt. Independent engine checks verify the expected text, outer-cell styles, outer table properties, inner table dimensions, source hashes and zero reported content loss. No error/warning log was observed in those two editor tabs. No native Hancom window was opened.

This remains progress toward the complete agent workflow. Nested-table property and structural commands still contain flat-coordinate paths and are not safe to use for inner-table edits. The task skill explicitly identifies that remaining work. Native Hancom layout, live Claude execution and unsupported properties outside the engine's loss-report coverage remain unverified.

## Nested-table properties

Verified on 2026-10-09 after a failing regression exposed an inner table of 49.4 mm being represented by its outer table's 148 mm width. Property lookup, cell updates, table updates, proportional width changes and object-property command routing now retain the complete cell path. The new mutating methods are included in the operation journal.

The final fresh build passes eleven unit/server checks, eight recovery/download checks, nine multi-file checks, eight complex-document checks, eight ordinary-table/formatting checks and eleven nested-table checks, 55 checks in total. Nested tests cover width and cell/table margins, undo/redo, asynchronous journal acknowledgement before reload, recovery, result saving and reopening in both formats. Outer-table properties and all outer-cell properties remain exactly equal. Engine-level checks also exercise invalid-path rejection, shared-edge border propagation between inner cells and inner-caption creation through export/reopen. Browser reports have no errors or external requests; the format and nested suites also require no console warnings.

Actual Codex in-app browser computer use changed both synthetic result files to 42 mm, set an inner-cell left margin of 1.7 mm and inner-table top margin of 1.2 mm, waited for journal acknowledgement, reloaded and confirmed the recovered width. Saved HWP revision 4 and HWPX revision 5 were reopened in the browser and independently reparsed. They measure 42.0017 mm, preserve outer properties, expected inner text and bold 11/12 pt, retain the original source hashes and have zero reported export losses. Both editor-tab warning/error logs are empty. The rendered nested table fits within its outer cell in the inspected synthetic page. No native Hancom window was opened.

Nested structural commands remain separate work: row/column insertion and deletion, split/merge and merged-cell geometry are not covered by these property checks. Live Claude execution, same-source native Hancom comparison and unreported unsupported-property losses also remain unverified. These are still gates for the full agent-editing objective.

## Nested-table row and column operations

Verified on 2026-10-09 with a fresh build. All six suites pass: eleven unit/server, eight recovery/download, nine multi-file, eight complex-document, eight formatting/cache and nineteen nested-table checks, 63 checks in total. Browser reports have no errors or external requests; the format and nested suites also require no console warnings.

Inner row/column insertion and deletion now resolve the complete cell path in native commands, UI cursor updates and operation-journal recovery. Invalid paths, out-of-bounds indexes, counts outside u16 and final-row deletion leave exported bytes unchanged. A three-level nested merged-cell fixture matches the same operations on a flat reference through export/reopen, including cell spans and properties. Path-aware structural events preserve existing flat-call event contracts.

The first regression exposed an inner-table operation changing the outer table. Subsequent actual browser inspection found that preserved text and dimensions were insufficient: the enclosing cell's label overflowed horizontally and then overlapped the expanded table. Edited inline-table host paragraphs now reflow with occupied width and measured content height. Nested inline placement uses that measured body only when the host line matches its occupied band rather than the stale declared height. Original stored geometry retains its existing path. The final regression checks both inner-table containment and outer-label non-overlap after reopening.

Actual Codex in-app browser editing saved HWP revision 8 and HWPX revision 9 with a 2×3 inner table, width 63.0026 mm, table top padding 1.2 mm and selected-cell left padding 1.7 mm. Independent reparsing confirms expected text, bold 11/12 pt, unchanged outer table/cell properties, original source hashes, output/receipt hashes and zero reported export loss. Both saved files were reopened and visually inspected; the table and enclosing text fit within the outer cell. Both tab error/warning logs are empty. No native Hancom window was opened.

This verifies the tested structural operations, not every Hancom document. Nested split/merge and Tab navigation, live Claude execution, same-source Hancom layout and unsupported properties outside the engine's loss-report coverage remain separate gates. Existing drafts are version-bound; after rebuilding, open their last saved result file rather than replaying an incompatible journal.

## Re-run commands

Run npm test, npm run audit and, after building and starting the server, npm run test:browser. Run npm run test:agent for the multi-file workflow, npm run test:complex for complex objects and preservation failures, npm run test:format for formatting and table structure, and npm run test:nested for nested-cell selection, formatting, single replacement, nested-table properties and row/column operations. These four task suites start/stop their own servers and use fresh ignored task directories. The audit expects release files to be staged. Browser tests require Playwright with a Chromium installation; PLAYWRIGHT_PACKAGE_PATH and PLAYWRIGHT_EXECUTABLE_PATH can point to an existing installation. Test reports and screenshots are written to ignored test-results/.
