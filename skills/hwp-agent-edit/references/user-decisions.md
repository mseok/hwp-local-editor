# User decisions for hwp-agent-edit

Each entry gives the date, the question the user was asked, the user's answer in their own words, and the rule it produced.

## 2026-11-17: the Tether gateway's browser is an allowed background browser

- Context: an agent in a conversation run through a Tether gateway edited a blank HWP file with the `tether_browser` tools (entered a line, saved the result, original unchanged) when the request named those tools. The skill then allowed only the built-in Browser in Codex desktop and the `hwp-browser` server in Claude Code, so without that sentence in the request the agent could report that no background browser was available.
- Question: "스킬에 이 브라우저를 허용 대상으로 추가할까요?"
- Answer: "ㅇㅇ"
- Rule: when the session offers `tether_browser` tools, use them as the background browser for the editor.
