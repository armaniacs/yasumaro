# Design Specifications

This document outlines the critical design decisions and technical constraints for the Obsidian Smart History Chrome extension. These rules are derived from production issues and security requirements to prevent regressions.

## 1. Security & Network Policies

### 1.1 Content Security Policy (CSP)
The `manifest.json` CSP must accommodate the following needs:
- **Notifications**: `connect-src` and `img-src` must include `data:` to allow inline data URLs for notification icons.
- **Favicons**: `connect-src` and `img-src` must include `chrome-extension:` to allow the use of the Chrome Favicon API.
- **API Access**: `connect-src` must explicitly allow `localhost` (for Obsidian REST API) and configured AI provider domains.

### 1.2 SSRF Protection
All network requests to external sources (e.g., uBlock filter imports) must be validated:
- **Tool**: Use `src/utils/fetch.js:fetchWithTimeout`.
- **Validation**: Use `validateUrlForFilterImport()` to block private network addresses and `localhost` (specifically for imports).
- **Exception**: Direct communication with Obsidian on `localhost` is allowed but must be handled via the designated `ObsidianClient`.

## 2. Communication Architecture

### 2.1 Message Passing Validation
To prevent unauthorized or unexpected message processing in the Service Worker:
- **Sender Distinction**: Distinguish between `Content Script` (untrusted web page) and `Popup` (trusted extension UI).
- **Type Whitelisting**: Only process message types defined in `VALID_MESSAGE_TYPES`.
- **Origin Check**: Message types that affect system state based on the current page (e.g., `VALID_VISIT`) MUST verify that `sender.tab` is present to ensure they originate from a Content Script.

## 3. UI Implementation Standards

### 3.1 Favicon Retrieval
- **Standard**: Always use the Chrome Favicon API (`chrome-extension://_favicon/`) instead of relying on `tab.favIconUrl`.
- **Reasoning**: `tab.favIconUrl` is often unavailable or restricted by site CSPs, whereas the official API is more robust for Manifest V3.

### 3.2 Error Reporting
- **Standard**: Network errors must be detailed and user-friendly.
- **Implementation**: Catch fetch errors and map them to localized messages using `errorUtils.js`. Avoid exposing technical stacks or private URLs in error strings.

## 4. Accessibility (A11y)

### 4.1 Focus Management
- **Modals**: Must implement focus trapping (preventing Tab from leaving the modal) and ESC-to-close. Restore focus to the triggering element upon closing.
- **Navigation**: Tabbed interfaces must support keyboard navigation (Arrow keys, Home/End, Enter/Space) as per ARIA patterns.

## 5. Data Management & Storage

### 5.1 Storage Keys Structure
All settings are managed via `StorageKeys` defined in `src/utils/storage.js`:
- **Obsidian Configuration**: `OBSIDIAN_API_KEY`, `OBSIDIAN_PROTOCOL`, `OBSIDIAN_PORT`, `OBSIDIAN_DAILY_PATH`
- **AI Provider Configuration**: `GEMINI_API_KEY`, `GEMINI_MODEL`, `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_2_*`
- **Visit Detection**: `MIN_VISIT_DURATION` (default: 5 seconds), `MIN_SCROLL_DEPTH` (default: 50%)
- **Domain Filtering**: `DOMAIN_WHITELIST`, `DOMAIN_BLACKLIST`, `DOMAIN_FILTER_MODE`
- **Privacy**: `PRIVACY_MODE`, `PII_CONFIRMATION_UI`, `PII_SANITIZE_LOGS`
- **uBlock Format**: `UBLOCK_RULES`, `UBLOCK_SOURCES`, `UBLOCK_FORMAT_ENABLED`, `SIMPLE_FORMAT_ENABLED`

### 5.2 URL History Limits
- **Maximum URLs**: `MAX_URL_SET_SIZE = 10,000`
- **Warning Threshold**: `URL_WARNING_THRESHOLD = 8,000`
- When limit is exceeded, recording is rejected with user notification
- When approaching threshold (≥ 8,000), warning is logged

### 5.3 Cache Strategy
RecordingLogic implements multi-level caching with static `cacheState`:
- **Settings Cache**: 30-second TTL (`SETTINGS_CACHE_TTL`)
- **URL Cache**: 60-second TTL (`URL_CACHE_TTL`)
- Cache version tracking for invalidation
- Cache persists across Service Worker restarts

## 6. Domain Filtering Behavior

### 6.1 Default Blacklist
The following domains are blocked by default and persist unless explicitly removed by the user:
- amazon.co.jp, amazon.com
- yahoo.co.jp, yahoo.com
- facebook.com
- twitter.com, x.com
- instagram.com
- youtube.com
- google.com, google.co.jp

### 6.2 Filter Modes
- **Disabled**: No domain filtering applied
- **Whitelist**: Only allowed domains are recorded
- **Blacklist**: Blacklisted domains are blocked (default mode)

### 6.3 Force Recording
The `force` parameter in `record()` overrides domain filtering, but a warning is logged.

## 7. Privacy Pipeline Architecture

### 7.1 Privacy Modes
- **masked_cloud** (default): PII masking → Cloud AI summarization
- **full_pipeline**: Local AI → PII masking → Cloud AI
- **local_only**: Local AI only (fails if unavailable)
- **cloud_only**: Cloud AI only (no PII masking)

### 7.2 PII Confirmation UI
When enabled (`PII_CONFIRMATION_UI = true`):
- User must preview masked content before final confirmation
- Preview shows processed content with masked items count
- User can confirm or cancel before Cloud AI processing

### 7.3 Three-Layer Processing
- **L1: Local Summarization** (Optional): Uses Chrome Prompt API via offscreen document
- **L2: PII Masking** (Conditional): Regex-based PII detection and replacement
- **L3: Cloud Summarization** (Optional): External AI provider for final summary

## 8. Concurrency & Mutex

### 8.1 Global Write Lock
All Obsidian write operations are serialized via global mutex:
- **Max Queue Size**: 50 concurrent requests (`MAX_QUEUE_SIZE`)
- **Mutex Timeout**: 30 seconds per lock acquisition (`MUTEX_TIMEOUT_MS`)
- Queue uses Map for O(1) operations
- Lock transfers to next queued task (no unlock/lock gap)

### 8.2 Mutex Error Handling
- Release method never throws exceptions
- On release error, lock is forced unlocked and error is logged
- Prevents deadlocks from exceptions in release pathway

## 9. Obsidian REST API Integration

### 9.1 Connection Configuration
- **Default Protocol**: `http`
- **Default Port**: `27123`
- **Port Validation**: 1-65535, integer only
- **Required**: API key (Bearer token)

### 9.2 Daily Note Path Format
Uses placeholder substitution with `buildDailyNotePath()`:
- `YYYY`: 4-digit year
- `MM`: 2-digit month (01-12)
- `DD`: 2-digit day (01-31)
- `YYYY-MM-DD`: Full date string
- **Default Path**: `{YYYY}-{MM}-{DD}.md`
- **Default Folder**: `092.Daily`

### 9.3 Request Behavior
- **Timeout**: 15 seconds (`FETCH_TIMEOUT_MS`)
- **Read-Modify-Write**: Fetch existing content → insert into section → write back
- **Section Header**: Content inserted after `## Web History` section (or default header)
- **404 Handling**: Empty string returned for non-existent notes

## 10. Content Extraction

### 10.1 Content Script Behavior
- **Source**: `src/content/extractor.js`
- **Extraction Scope**: `document.body.innerText`
- **Length Limit**: Maximum 10,000 characters
- **Normalization**: Consecutive whitespace → single space
- **Trigger Conditions**:
  - Visit duration ≥ `MIN_VISIT_DURATION` (default: 5s)
  - Scroll depth ≥ `MIN_SCROLL_DEPTH` (default: 50%)
- **Frequency Check**: Every 1 second + on scroll events
- **Performance**: Stop periodic checking after conditions met

### 10.2 Content Format
Timestamp in Japanese locale (HH:MM format):
```markdown
- HH:MM [Page Title](URL)
  - AI要約: Summary text
```

## 11. Local AI (Chrome Prompt API)

### 11.1 Offscreen Document Architecture
- **Purpose**: Access `window.ai` Prompt API (not available in Service Worker)
- **Document Path**: `src/offscreen/offscreen.html`
- **Reason**: `chrome.offscreen.Reason.WORKERS`

### 11.2 Session Management
- **System Prompt**: Japanese instructions for web summarization
- **Content Limit**: 10,000 characters per prompt
- **Message Timeout**: 30 seconds
- **Status Checks**: `readily`, `after-download`, `no`, `unsupported`
- **Session Reuse**: Session cached for multiple prompts

## 12. uBlock Origin Format Support

### 12.1 Strict Conformance
The implementation MUST strictly conform to uBlock Origin filter format:
- Support list-style domain filtering (`||example.com^`)
- Exception domains (`@@||example.com^`)
- Multi-source import capability
- Source metadata tracking (import timestamp, rule count)

### 12.2 Format Toggle
- **uBlock Format**: Full uBlock-compatible domain filtering
- **Simple Format**: Plain domain list (fallback method)
- Both formats can be enabled/disabled independently

## 13. Private Page Confirmation

### 13.1 Purpose
The Private Page Confirmation feature allows users to review and manage pages that were marked as private before saving. This prevents accidental saving of sensitive content while giving users control over what gets recorded.

### 13.2 Pending Pages Storage
- **Storage Key**: `PENDING_PAGES`
- **Structure**: Map of page IDs to pending page data
- **Data Fields**:
  - `id`: Unique identifier (timestamp-based)
  - `url`: Page URL
  - `title`: Page title
  - `message`: Privacy warning message
  - `timestamp`: Detection timestamp
- **Operations**:
  - `addPendingPage()`: Add page to pending list
  - `getPendingPages()`: Retrieve all pending pages
  - `removePendingPage()`: Remove specific pending page
  - `clearPendingPages()`: Clear all pending pages

### 13.3 Recording Data Extension
- **RecordingData interface**:
  - `requireConfirmation`: Boolean flag to indicate confirmation is required
- **RecordingResult interface**:
  - `confirmationRequired`: Boolean flag indicating if user confirmation was required

### 13.4 Whitelist Addition
Users can add domains/paths to the whitelist from the confirmation dialog:
- **Source**: Confirmation dialog provides "Add to Whitelist" button
- **Pattern Support**: Supports wildcard patterns (e.g., `*.example.com`)
- **PII Masking**: Always applied even for whitelisted domains
- **Privacy Bypass**: Whitelisted domains skip private page detection warning

### 13.5 UI Components
- **Confirmation Dialog**:
  - Shows privacy warning message
  - Options: Cancel, Force Save, Add to Whitelist
  - Requires user action before proceeding

- **Pending Pages Panel**:
  - Lists all pages awaiting confirmation
  - Bulk actions: Save All, Clear All, Save Selected
  - Individual actions: Save single page, Remove from pending list

## 14. Message Passing Protocol

### 14.1 Valid Message Types (`VALID_MESSAGE_TYPES`)
- `VALID_VISIT`: Content Script → Service Worker (automatic visit recording)
- `GET_CONTENT`: Popup ↔ Content Script (manual content fetch)
- `FETCH_URL`: Popup → Service Worker (CORS bypass fetch)
- `MANUAL_RECORD`: Popup → Service Worker (manual record)
- `PREVIEW_RECORD`: Popup → Service Worker (preview with PII masking)
- `SAVE_RECORD`: Popup → Service Worker (save confirmed preview)

### 14.2 Message Payload Structure
```javascript
{
  type: string,           // Must be in VALID_MESSAGE_TYPES
  payload: {              // Required object
    // type-specific fields
  },
  target?: string         // Optional: 'offscreen' for offscreen messages
}
```

---
*Refer to [CHANGELOG.md](../CHANGELOG.md) for the version history that established these rules (v2.4.1 - v2.4.4).*
