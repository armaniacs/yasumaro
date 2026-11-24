# Yasumaro - Chrome Web Store Listing

Source of truth for the store submissions of the Yasumaro extension.
For GA, the same text is shared across Chrome / Edge / AMO (owner decision 2026-11-24; no per-store listing files exist in the repo).
Target version: 6.9.77 (`package.json`). Version decided by the owner on 2026-11-24 (6.9.77, not 7.0.0). Tag push and store submission are the owner's actions.

## Store identity

- Title: Yasumaro - AI Browsing Logger
- Short name: Yasumaro
- Description: Save browsing history with AI summaries to local SQLite. Built-in AI, content cleansing, archive. Obsidian optional.
- Category: Productivity
- Language: English
- Homepage: https://github.com/armaniacs/yasumaro
- Privacy policy: https://armaniacs.github.io/yasumaro/PRIVACY.md
- Contact: GitHub Issues (see the homepage repository)
- Icons (sizes verified against the file names):
  - `public/icons/icon16.png` - 16x16
  - `public/icons/icon48.png` - 48x48
  - `public/icons/icon128.png` - 128x128

## Single purpose

Yasumaro has a single purpose: logging the pages you choose to record and summarizing them with AI. When a page is recorded, the page body text is sent to the AI provider you selected so it can generate a summary. Nothing else leaves your device unless you switch on one of the optional sharing features below, and each of those asks for your approval first.

## Full description

Yasumaro is a browsing logger that saves your history with AI summaries.

When you record a page, the page text is sent to the AI service you chose so it can write a summary. Everything else stays on your device.

- Records automatically based on how long you stay and how far you scroll, or manually with Record Now
- Record Without AI saves the entry with no sending at all
- Type y in the address bar or press Alt+Shift+Y to record without opening the popup
- Keeps everything in a local SQLite history on your device
- Optional daily notes in Obsidian, local Markdown files, and archive files you can import back later
- Cleans personal details out of saved text, spots private pages on its own, and lets you filter domains and set per-site AI rules
- Keeps an on-device log of every AI send, backs up to Gist only if you switch it on, and offers a minimal webhook export (experimental) that stays off until you set it up
- Built-in browser AI option summarizes without sending page text anywhere

Your data stays yours: there is no developer server, ever. Optional extras (Obsidian sync, Gist backup, webhooks, bug reports) run only when you turn them on.

## Features

- Automatic AI-summary recording by dwell time and scroll depth
- Manual Record Now and Record Without AI
- Omnibox recording (keyword `y`) and shortcut recording (`Alt+Shift+Y`)
- Local SQLite history database on your device
- Optional Obsidian daily notes
- Local Markdown export
- History archive import and export
- 4 privacy modes
- PII masking (personal details cleaned before saving)
- Private-page auto-detect (banking, mail, and similar pages are held back)
- Domain filters in uBlock format
- Per-domain AI policy (send as-is, record without summary, or always mask)
- AI audit log (when, where, and how much was sent, kept on-device only)
- Optional Gist sync backup
- Optional minimal webhook export (experimental, https loopback destinations only)
- Built-in browser AI option (on-device summarization)

## Permissions justification

Every entry below is one specific reason. Nothing here is requested "to make the extension work" in general.

| Permission | Why Yasumaro needs it |
|-----------|----------------------|
| `storage` | Keeps your settings and encrypted keys on this device so your setup survives a browser restart. |
| `unlimitedStorage` | Lets a multi-year browsing log grow past the normal browser quota instead of losing old entries. |
| `scripting` | Runs the in-page reader that measures stay time and pulls the text of pages you record. |
| `activeTab` | Reads the open tab once when you press Record Now or trigger a manual save. |
| `offscreen` | Keeps the on-device history database running in a hidden page so no extra window pops up. |
| `favicon` | Shows each site's icon next to its history row so you can recognize entries at a glance. |
| `notifications` | Shows a short note when a recording, backup, or blocked send needs your attention. |
| `webRequest` | Reads page privacy headers to catch private pages before automatic recording touches them. |
| `declarativeNetRequest` | Removes one request header on calls to your self-hosted AI helper so its default setup accepts the connection. |
| `alarms` | Wakes the extension on a timer to close idle sessions and clear expired entries. |
| `contextMenus` | Adds a right-click entry that records the page without opening the popup. |
| `downloads` | Writes Markdown exports and history archive files into your Downloads folder. |
| `omnibox` (keyword `y`) | Records the current tab when you type `y` and press Enter in the address bar. |
| `commands` (`record-current-page`, `Alt+Shift+Y`) | Records the current tab from the keyboard without opening any window. |
| `content_scripts` (matches `<all_urls>`) | Watches visits on any site so automatic logging works everywhere you browse; full text is pulled only on domains you allow. |
| `host_permissions`: 16 local loopback entries | Reaches AI helpers and note tools running on your own computer, never anyone else's server. |
| `host_permissions`: required AI provider domains | Sends page text for summaries only to the AI service you picked. |
| `host_permissions`: `api.github.com` | Creates and updates backup gists only after you switch on Gist sync. |
| `optional_host_permissions` | Stays empty until you approve an extra AI service or list source, one prompt per addition. |

## Host permissions detail

- Local loopback (16 entries, always granted): `http`/`https` x `127.0.0.1`/`localhost` x 4 local ports. Used only for helpers and note tools on your own computer.
- Required AI provider domains (always granted, used only for the provider you select):
  - `generativelanguage.googleapis.com`
  - `api.openai.com`, `*.openai.com`
  - `api.anthropic.com`
  - `api.groq.com`
  - `mistral.ai`, `api.mistral.ai`
  - `deepseek.com`, `api.deepseek.com`
  - `voyageai.com`
  - `volcengine.com`
  - `z.ai`
  - `wandb.ai`
  - `api.ai.sakura.ad.jp`
- `api.github.com` (always granted): Gist backup only. Disabled until you turn on Gist sync and enter a personal token.
- `optional_host_permissions` (granted only after your approval): 20+ additional AI providers plus filter-list and metadata sources. Each new destination prompts you before it is added.

## Privacy summary

- Your history and settings live on your device by default. There is no developer server.
- Page body text is sent to your chosen AI provider for summarization. That is the single purpose stated above.
- The built-in browser AI option summarizes with no sending at all.
- Obsidian sync, Gist sync, and webhook export are optional and off by default.
- Gist sync sends only your token and the records you select to `api.github.com`.
- Webhook export sends only the masked title, masked summary, tags, and URL to the address you enter. Only https loopback destinations in the dedicated allowlist are saved and sent; anything else is rejected at save time and blocked before any network access. Page text is never included.
- The Report a Bug button only opens a GitHub issue tab with a preview you can review. Closing the preview sends nothing.
- Full text: https://armaniacs.github.io/yasumaro/PRIVACY.md

## Screenshots TODO (1280x800)

Capture each screen at 1280x800 before submitting:

- [ ] Popup recording screen (Record Now / Record Without AI buttons visible)
- [ ] Dashboard history (saved entries with summaries)
- [ ] Privacy tab (consent, retention, and export settings)
- [ ] AI provider settings (provider list and per-domain policy)

## Version history

- 6.9.75 (2026-11-11): Release packaging fix so the published package versions stay in sync. No behavior change.
