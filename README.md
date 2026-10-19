# AI Tab Grouper

A Chrome extension that groups the tabs in your window **by feature or workstream, not by website**. It reads each tab and sends the title, a cleaned URL and a little page text to Claude, together with your standing rules and an optional prompt for the run. Claude proposes groups, you adjust them in the side panel, and then you click **Apply**.

## Install

**From a release (quickest):** download `ai-tab-grouper-<version>-chrome.zip` from the [latest release](../../releases/latest) and unzip it somewhere permanent.

**From source:** you need Node.js 20 or later.

```bash
git clone https://github.com/jean-paul-supy-io/ai-tab-grouper.git
cd ai-tab-grouper
npm install
npm run build
```

Then:

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and pick the unzipped folder, or `.output/chrome-mv3` if you built from source.
3. Click the extension's icon (or press `Alt+Shift+G`). The side panel opens.
4. Open **Settings** and choose how to connect to Claude (see below), then **Save**.

The Claude subscription option needs the source checkout, because it installs a small local helper.

## Connecting to Claude

**Anthropic API key:** paste a key from console.anthropic.com and click **Test**. You pay per run.

**Claude subscription (via Claude Code):** uses your Pro, Max, Team or Enterprise plan. Runs count against the usage limits your plan shares between Claude and Claude Code.

1. Install [Claude Code](https://code.claude.com) and sign in by running `claude` once.
2. In your clone of this repo, run `npm run install-host`. This registers a small native messaging host with Chrome. On Windows it adds a per-user registry key; on macOS and Linux it writes a file into Chrome's per-user `NativeMessagingHosts` folder. No admin rights are needed.
3. Reload the extension, pick **Claude subscription** in Settings, and click **Check connection**.

How it works: when you group tabs, Chrome starts `native-host/host.mjs`, which runs the official CLI as `claude -p` with your own login. It passes the same prompt and JSON schema the API path uses. All tools are off, as are MCP servers, CLAUDE.md, plugins and hooks (`--tools "" --safe-mode`). The run isn't saved as a session. The host removes `ANTHROPIC_API_KEY` from the CLI's environment so the run uses your subscription, not an API key. The extension never sees or stores your Claude credentials. Anthropic doesn't allow third-party apps to use claude.ai login tokens, which is why this goes through the unmodified CLI.

Run `npm run install-host` again if you move this folder. Run `npm run uninstall-host` to remove the registration. The extension ID is pinned by the public key in `extension.json`, so it stays the same wherever the folder lives.

## Using it

1. Optionally type instructions for this run, e.g. *"Split Orders into dev and prod"*.
2. Click **Group tabs**. The extension reads every unpinned tab in the current window and asks Claude.
3. Review the preview:
   - Rename a group, or click its color dot to change the color.
   - Drag tabs between groups or into **Ungrouped**.
   - Duplicates are listed next to the tab they copy, ticked **close**. Untick any you want to keep.
4. Click **Apply**. Existing groups in the window are dissolved and rebuilt. Ungrouped tabs move to the end of the tab strip, and pinned tabs aren't touched.
5. **Undo last grouping** puts the window back the way it was, reopening any duplicates that were closed.

## What gets sent to Claude

For each tab:

| Sent | Not sent |
|---|---|
| Tab title | The raw URL |
| URL with tokens, signatures, session ids and long opaque values removed | Query params such as `token`, `code`, `state`, `meta`, `sig`, plus anything shaped like a JWT |
| For login pages (Cloudflare Access, SSO, Databricks…): the decoded page the login leads to | The login page's own text |
| Meta description, `h1`/`h2` headings, the first ~1,500 characters of visible text | Page text from hosts on the **privacy blocklist** |

The blocklist (Settings) ships with mail, chat, password managers and PayPal. Add your bank, production dashboards and anything else sensitive. Tabs on those hosts send only their title and cleaned URL. Sleeping (discarded) tabs are never woken up, so they also go as title + URL.

Exact duplicates are sent once.

## Settings

- **Model:** Claude Sonnet 5.5 (default, better at telling features apart) or Claude Haiku 5.5 (cheaper and faster). Sonnet requests opt into server-side refusal fallbacks (`fallbacks: "default"`), so a rare false-positive decline on scraped page text is retried on Anthropic's recommended fallback model instead of failing.
- **Standing rules:** sent with every run. Describe your features and what belongs to each. The defaults are an example to replace with your own features.
- **Privacy blocklist:** one host per line. `*.example.com` also matches subdomains.
- **Page text per tab:** 0–5,000 characters.

Settings, including any API key, are kept in `chrome.storage.local`. They are never synced to other devices, and the key is only sent to `api.anthropic.com`.

## Development

```bash
npm install
npm run dev       # starts a separate Chrome profile that reloads the extension as you edit
npm test          # unit tests (Vitest)
npm run compile   # type check
npm run build     # production build in .output/chrome-mv3
npm run zip       # zipped build, as attached to releases
```

After `npm run build`, click the reload icon on the extension's card in `chrome://extensions`.

Built with [WXT](https://wxt.dev), React, TypeScript, Tailwind CSS, [dnd-kit](https://dndkit.com) and the [Anthropic TypeScript SDK](https://github.com/anthropics/anthropic-sdk-typescript).

### Project layout

```
entrypoints/
  background.ts         opens the side panel from the toolbar icon / shortcut
  sidepanel/App.tsx     run → preview → apply / undo flow
  options/App.tsx       settings page
components/Preview.tsx  editable preview with drag and drop (dnd-kit)
lib/
  url.ts                redirect unwrapping, token stripping, duplicate keys, blocklist
  gather.ts             reads tabs and injects the page-text extractor
  grouping.ts           prompt, output schema, response repair, duplicate placement
  claude.ts             picks the connection; Anthropic SDK call (structured output via Zod)
  subscription.ts       talks to the native host (Claude subscription connection)
  apply.ts              snapshot, apply groups, undo
  settings.ts           defaults and storage
native-host/
  host.mjs              runs `claude -p` for the extension (Chrome native messaging)
  install.mjs           npm run install-host / uninstall-host
extension.json          pinned extension key/ID and native host name
tests/                  Vitest unit tests for url.ts and grouping.ts
```

### Releasing

Push a tag such as `v0.2.0`. The release workflow runs the tests, builds the extension and attaches the zip to a GitHub release. Keep `version` in `package.json` in step with the tag.

## Contributing

Issues and pull requests are welcome. Before opening a PR, run `npm test` and `npm run compile`. Never put real tokens, cookies or internal URLs in test fixtures: use placeholders such as `example.com` and the fake JWT in `tests/url.test.ts`.

## Notes

- With an API key, Claude Sonnet 5.5 at `medium` effort costs a few cents for about 50 tabs, and Haiku 5.5 a small fraction of that. With a subscription, runs use your plan's limits instead.
- Chrome groups tabs within one window, so each run only covers the window the side panel is open in.
- Page text is treated as untrusted. The system prompt tells Claude to ignore instructions found in it, and the output can only ever be a grouping.
- This project is not affiliated with or endorsed by Anthropic.

## License

[MIT](LICENSE)
