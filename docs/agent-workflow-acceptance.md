# Full agent-workflow acceptance

The goal remains: a user supplies several HWP/HWPX files and edit instructions; Codex or Claude edits through browser computer use, checks saved editable results and returns them with source structure preserved, without routine foreground/native Hancom interaction. A passing subset does not complete this goal.

This is the requirement checklist as of 2026-10-10. Detailed evidence and earlier checkpoints are in `verification.md`. Local reports and real-browser artifacts are deliberately ignored by Git because document-derived evidence may be private.

| Requirement | Evidence now | Completion boundary |
| --- | --- | --- |
| Agent can start from local input files and instructions. | `scripts/open.mjs`, task manifest and direct links; installed `hwp-agent-edit` skill; real Codex browser execution. | Codex route exercised. Claude skill installed, live Claude execution unverified. |
| Several files can be edited independently. | Nine multi-file checks; real HWP and HWPX in separate hidden tabs, separate saved paths and receipts. | Tested batch verified; this is independent documents rather than merging duplicate tabs. |
| Body, table text, formatting and table structure can be changed. | Formatting/nested/split/object suites; real Find, typing, format and structural edits documented in `verification.md`. | Partial overall: remaining table object move/cut/transpose/caption routes and special-object editing need full-path/preservation audits. |
| Source and unrequested content remain preserved. | Original/output SHA-256 receipts; independent parsing of real saved artifacts; outer-table/cell properties and outside text/style comparisons. | Verified for exercised edits. Unsupported object/property coverage is incomplete. |
| Preview reflects edits and saved results can be reopened. | Real saved-byte reopening, screenshots, table containment and non-overlap checks. | Exercised preview verified. Exact-source native Hancom font/wrapping/pagination equivalence remains unverified for current edited outputs. |
| Recovery is efficient and does not silently overwrite results. | Operation journal, idle/continued-input acknowledgement, undo/reload tests, stale duplicate-tab rejection and loss-blocking. | Exercised recovery verified; a journal acknowledgement is not a final editable file. |
| Results are actual HWP/HWPX artifacts. | Format checks, export/reparse, separate final files and per-file receipts, task-list links. | Exercised outputs verified; native Hancom reopening/fidelity is a separate outstanding gate. |
| Work preserves the foreground and private data. | Hidden Codex browser tabs; loopback-only task server and registered-file allowlist; no native window used; publication audit excludes docs/fonts/binaries. | Verified in the exercised session. Future native comparisons must preserve the foreground preference. |

The current build passes 111 checks across eight suites. This does not close the outstanding boundaries above. The next concrete audit is nested-table object movement through arrow keys and drag, where code still passes flat table addresses. Establish a failing reproducer before changing those routes. Then continue the remaining editing/preservation and native fidelity gates; do not disable requested functionality or redefine the goal to the already passing cases.
