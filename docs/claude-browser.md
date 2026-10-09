# Background editing with Claude Code

Claude's [Chrome integration](https://code.claude.com/docs/en/chrome) operates in a visible browser and shares its login state. For background document tasks, use a separate headless [Playwright MCP](https://github.com/microsoft/playwright-mcp) session instead. This setup does not change global MCP registrations or connect to a personal browser profile.

## One-time browser setup

From this checkout, install the pinned optional dependency in its own directory:

```sh
npm install --prefix .cache/claude-browser --ignore-scripts --no-audit --no-fund --save-exact @playwright/mcp@0.0.83
```

Use an existing compatible browser. The configuration helper accepts `--executable-path` for an explicit binary; otherwise Playwright MCP uses its default browser installation. This helper does not install a browser or change credentials.

After an agent has started its registered task server, create a configuration for that exact origin:

```sh
node scripts/claude-browser-config.mjs --origin http://127.0.0.1:8766 --output local/claude-browser-8766.json
claude --no-chrome --strict-mcp-config --mcp-config "$PWD/local/claude-browser-8766.json"
```

Use the actual task port. Choose a new configuration filename when it already exists; the helper refuses to overwrite it. This Claude session loads only the specified MCP server. The wrapper starts an isolated headless browser, blocks service workers and page-provided WebMCP tools, and omits inherited credentials from its browser child environment.

The origin allowlist is request filtering, not a security sandbox. Keep normal Claude tool permissions and the registered-file scope. Do not grant unrestricted file access or attach this workflow to a personal browser/CDP endpoint.

## Document tasks

Install the `hwp-agent-edit` skill using `node scripts/install-skill.mjs`. The agent registers the user-authorized files with `scripts/open.mjs`, opens separate editor tabs, edits through the visible controls, explicitly saves and reopens each result, and returns the editable output files. The natural-language agent stays in Claude Code; the editor itself does not run a model.

Keep personal skill discovery enabled. Claude's `--restricted` mode and `--setting-sources ''` exclude this installed personal skill; `--setting-sources user` discovers it. A bounded dry-run with only the `Skill` tool verified that a synthetic HWP/HWPX edit request, without naming the skill, selected and successfully loaded `hwp-agent-edit`. The run reached its cost limit immediately after loading, so it establishes routing only. It did not edit documents. See Claude's [skills](https://code.claude.com/docs/en/skills) and [CLI reference](https://code.claude.com/docs/en/cli-reference) for those settings.

For a server that already exists, ask Claude to use `hwp-agent-edit`, open its `/tasks` URL and apply the specified edits. Keep that server and its manifest/process handle until the task finishes. A response that only links to an accessibility snapshot file is not the page contents; the agent should call `browser_snapshot` to read the current page directly.

## Exercised route

On 2026-10-10, actual Claude Code 2.1.295 used browser UI tools to open two independent synthetic HWP/HWPX files, replace body and table text, and explicitly save both. It changed the files to different participant counts. Both saved files were reopened through browser UI, and independent parsing checked exact text, source format, original hashes, body styles, table/cell properties and receipt fingerprints.

The first bounded run reached its cost limit after both saves and the HWP reopening. A separate read-only run through this configuration helper completed the saved HWPX reopening and screenshot/console/network inspection. Both runs had one denied optional `browser_find` call under the test's narrow permission list; accessibility snapshots provided the same permitted page-reading route. No JavaScript evaluation, shell/file editing or other agent was used by Claude. These tests do not establish every object or actual Hancom layout fidelity.
