# HWPX proposal review copy and native QA

Use for a Korean HWP/HWPX proposal where the user asks to fill a supplied 작성중 or template document while preserving its text, comments and layout. Never represent a review copy as a submitted final, never invent legacy content, and never treat LibreOffice rendering as the layout authority.

1. Identify the latest governing source, the target HWPX, its comment- or memo-directed fields, and any prior version still needing retrieval. Keep `source/`, `extracted/`, `draft/` and `qa/` folders with a source index (file, status, SHA-256).
2. Map each requested addition to its location before editing. Keep original nonempty text and comments intact; create a distinctly named review copy and a Markdown plan beside it. List unresolved owner decisions (title, personnel, budget, KPIs, targets, schedule) with review markers instead of completing them.
3. Structural checks (ZIP/XML/CRC) and source-coverage checks narrow the review; they are not layout checks.
4. Native QA only on a copy, only when no user document is open in Hancom (check AXMain and the PID first), and only through 파일 → PDF로 저장하기; inspect every rendered page. If native control is unavailable or focus must be preserved, stop at structural QA and say "native visual QA not performed".
5. Report output path, completed and missing validation layers, and unresolved fields separately.

Pitfalls: PDF text extraction loses table numerals and Latin text (inspect pages); `failedToCreateImageDestination` from Hancom automation means no page count or visual claim; large or authentication-blocked older files are retrieved later, not inferred.
