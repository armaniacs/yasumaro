# API Endpoints

External API endpoints used by Yasumaro. Currently covers the Obsidian Local REST API integration in [src/background/obsidianClient.ts](../src/background/obsidianClient.ts).

## Internal message protocol versioning

Messages crossing the extension boundary carry a `protocolVersion` field. The policy lives in [src/background/handlers/envelopePolicy.ts](../src/background/handlers/envelopePolicy.ts):

- `CURRENT_PROTOCOL_VERSION` (in `messageTypes.ts`) is the required version.
- Version `N-1` is accepted with a `deprecated` flag on the response (graded migration window of `PROTOCOL_VERSION_WINDOW_SIZE`).
- Messages without a `protocolVersion` (legacy senders) are still accepted but are flagged `deprecated` and counted/logged; once the count stays at zero across releases, the `absent` path can be tightened to a rejection.
- Older versions and non-integer values are rejected with `Protocol version mismatch`.

New message types must set `protocolVersion: CURRENT_PROTOCOL_VERSION` in their senders.

## Obsidian Local REST API

`ObsidianClient` talks to the [Obsidian Local REST API](https://github.com/coddingtonbear/obsidian-local-rest-api) plugin running on the user's machine. The base URL is built from user settings (`OBSIDIAN_PROTOCOL`, `OBSIDIAN_HOST`, `OBSIDIAN_PORT`), defaulting to `https://127.0.0.1:27123`.

| Method | Path | Purpose | Called from |
|--------|------|---------|-------------|
| `GET` | `{baseUrl}/vault/{dailyPath}/{dailyNoteFileName}.md` | Read the existing daily note content before appending, so the new entry can be inserted into the correct section. Returns `''` on 404 (note doesn't exist yet). | `ObsidianClient._fetchExistingContent()` |
| `PUT` | `{baseUrl}/vault/{dailyPath}/{dailyNoteFileName}.md` | Write the full updated daily note content back (read-modify-write; the plugin doesn't support partial appends at a path). | `ObsidianClient._writeContent()` |
| `GET` | `{baseUrl}/` | Health check for the connection test button in settings. Also used to validate protocol/host/port/API key without performing a write. | `ObsidianClient.testConnection()` |

### Request details

- **Auth**: All requests send `Authorization: Bearer {apiKey}` where `apiKey` comes from `StorageKeys.OBSIDIAN_API_KEY` (decrypted via `getSettings()`).
- **Headers**: `Content-Type: text/markdown`, `Accept: application/json` (see `BASE_HEADERS` in `obsidianClient.ts`).
- **Timeout**: All requests use `FETCH_TIMEOUT_MS = 15000` (15s) via `fetchWithTimeout()`.
- **Concurrency**: Writes (`appendToDailyNote`) are serialized through a single `Mutex` (`globalWriteMutex`) to avoid concurrent read-modify-write races on the same daily note.
- **Path building**: `dailyPath` and the note filename are constructed by `buildDailyNotePath()` ([src/utils/dailyNotePathBuilder.ts](../src/utils/dailyNotePathBuilder.ts)) from the `OBSIDIAN_DAILY_PATH` setting.

### Error handling

`ObsidianClient._handleError()` maps low-level fetch failures to user-facing messages:

| Condition | User-facing message |
|-----------|---------------------|
| `Failed to fetch` + `https://` target | Prompts the user to accept the self-signed certificate in a browser tab first |
| Message contains `timed out` | Generic timeout message |
| HTTP 401/403 (in `testConnection`) | Authentication failed — check API key |
| HTTP 404 (in `testConnection`) | Endpoint not found — check Local REST API plugin is enabled |
| Other | Generic connection failure message |

## Updating this document

When `obsidianClient.ts` gains a new endpoint call (new HTTP method, new path pattern), add a row to the table above. This keeps the endpoint surface auditable without having to re-read the client implementation.
