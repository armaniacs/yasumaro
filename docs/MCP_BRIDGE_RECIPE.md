# MCP ブリッジレシピ / MCP Bridge Recipe

[日本語](#日本語) | [English](#english)

---

## 日本語

### 概要

端末内の MCP クライアント（エージェントや MCP 対応アプリ）から Yasumaro の記録に問い合わせるためのローカルブリッジのレシピです。拡張機能側のコード追加は不要で、既存の **Webhook エクスポート**（6.9.63 で出荷・opt-in・既定 OFF）を経由します。

- MCP サーバー実装そのもの（ネイティブメッセージングホスト等）はこのレシピのスコープ外です。リポジトリには MCP サーバーを実装せず、「ローカルで動く小さなブリッジをユーザーが用意する」形に限定します
- 既定では外部送信は発生しません（Webhook エクスポートは既定 OFF の opt-in 機能です）

### 仕組み（既存の Webhook エクスポートの経路）

記録の保存時に、転送条件を満たす非公開でない記録が、利用者が設定した https の宛先へ POST されます。

- **送信ペイロード**: マスク済みタイトル・マスク済み要約・タグ・URL のみ（JSON）。ページ本文は送りません
  ```json
  {
    "text": "マスク済みタイトル\nhttps://example.com/page\nマスク済み要約\n#tag1 #tag2",
    "title": "マスク済みタイトル",
    "url": "https://example.com/page",
    "summary": "マスク済み要約",
    "tags": ["tag1", "tag2"]
  }
  ```
- **送信直前 PII マスキング**: タイトルと要約の両方を、送信の直前にプライバシー処理のマスクを通します。マスクできない記録は送りません
- **プライバシー判定ゲート**: 判定が取得できない記録（「それでも記録」での強制保存、ホワイトリスト回避、判定キャッシュの失効など）と、非公開判定の記録は送りません（fail-closed）
- **URL ゲート**: https の宛先のみ。http や空の URL はネットワークに出す前で遮断されます
- **宣言済み host_permissions ゲート**: マニフェストに宣言されていない origin はネットワークに出さず遮断します（fail-closed）。宣言済みの宛先は、AI プロバイダー、api.github.com、および 4 つのループバックポートです
- **再送制御**: ヘッダ `Idempotency-Key`（`yasumaro-<記録のURL>-<ペイロードのFNV-1aハッシュ>`）付きで POST されます。同じ内容の再記録は重複抑制され、ダッシュボードの「再送」ボタンで明示的に再送できます
- **リダイレクト追従なし**: 30x 応答は転送失敗扱いです（ゲートで確認していない Location への本文転送を防ぐため）
- **履歴と通知**: 送信結果は転送履歴と OS 通知に残ります。表示は origin のみで、トークンを含みうる URL 全体は表示しません

### 前提（ブリッジの用意）

1. **ポート**: ブリッジは宣言済み 4 ポート（`27123` / `27124` / `11434` / `1234`）のいずれかの**空きポート**にバインドします。これらは Obsidian Local REST API（27123/27124）、Ollama（11434）、LM Studio（1234）と共有されるため、稼働中のサービスと重ならないポートを選んでください
2. **証明書**: 宛先は https のみが許可されます。`mkcert` などで **OS 信頼のローカル CA** を用意し、ブリッジの HTTPS エンドポイントに適用してください。Chrome の fetch は通常の TLS 検証に従うため、自己署名のままでは送信が失敗します
   ```bash
   mkcert -install
   mkcert 127.0.0.1 localhost
   ```
3. **ホスト名**: `127.0.0.1` または `localhost`（宣言済みパターンが対応するホストです）
4. **ブリッジの責務**: ブリッジは次の 3 点を行う小さなローカルプロセスです
   - https の POST エンドポイントで上記の JSON を受け取る（`Content-Type: application/json` と `Idempotency-Key` ヘッダ付き。HTTP 200 を返す）
   - 受け取った記録を端末内に保存する（JSON ファイルや SQLite など、好きな形式で）
   - MCP サーバーとして、保存した記録を問い合わせるツール（タグやキーワードでの検索など）を公開する。MCP SDK は公式の TypeScript / Python SDK など、利用者が選んだものを使います

### 設定方法（拡張機能側・既存 UI のみ）

1. 上記のとおり `mkcert` のローカル CA を OS 信頼ストアにインストールし、ブリッジ用の証明書を発行します
2. ブリッジを空いている宣言済みポート（例: `27124` が空いていれば `27124`）で HTTPS として起動します
3. ツールバー右上の「⚙」アイコンをクリックしてダッシュボードを開き、左サイドバーの「**Webhook エクスポート**」パネルを選択します
4. 「**Webhook エクスポートを有効にする**」を ON にします（既定は OFF です。ON にしない限り外部送信は発生しません）
5. 「**Webhook URL（https のみ）**」にブリッジの URL（例: `https://127.0.0.1:27124/records`）を入力します
6. 必要に応じて転送条件を設定します。「**タグ（任意）**」（このタグを持つ記録のみ転送）、「**最小スクロール深度（%）**」、「**最小滞在秒数**」。MCP クライアントに流す記録を絞りたい場合はタグを指定するのが有効です
7. 「**保存**」をクリックします
8. 以後、記録が保存されるたびに、条件を満たした非公開でない記録がブリッジに POST されます。「**転送履歴**」パネルで origin と状態（`sent` / `blocked` / `failed`）と文字数を確認できます

### セキュリティ前提

- **opt-in・既定 OFF**: 設定しない限り外部送信は発生しません
- **送信直前 PII マスキング**: タイトルと要約は、保存時の状態を信用せず、送信直前にもう一度マスクされます。マスクに失敗した記録は送られません
- **ペイロードは 4 項目のみ**: マスク済みタイトル・マスク済み要約・タグ・URL。ページ本文は送られません
- **プライバシー判定のない記録は送らない**: 判定が取得できない記録（強制保存・ホワイトリスト回避・キャッシュ失効）と非公開判定の記録は対象外です
- **https 宛先のみ・未宣言 origin は遮断**: 宣言済み 4 ポートの外の宛先や http は、ネットワークに出す前で遮断され、転送履歴に `blocked` が残ります
- **マスク必須の per-domain 送信政策との組み合わせ（推奨）**: ダッシュボードの「AI送信政策（ドメイン別）」は、要約を生成するための本文送信の扱いをドメインごとに決めます（送信を許可 / 要約なしで記録 / マスク必須）。外部 AI に本文を送るドメインでは「**マスク必須**」を選ぶことを推奨します。ブリッジ（Webhook エクスポート）には、政策の判定結果に関係なく、送信直前にマスクを適用したタイトルと要約のみが流れます
- **監査**: 送信時刻・送信先 origin・文字数・状態が端末内の転送履歴に残ります

### 動作確認

1. ブリッジのログで POST の到達を確認します
2. 転送履歴パネルで `sent` と文字数を確認します。OS 通知にも「転送しました <origin> (<理由>)」が表示されます
3. MCP クライアントからブリッジの MCP サーバーに問い合わせし、記録が返ることを確認します
4. fail-closed の確認: 宣言されていないポート（例: `https://127.0.0.1:8787/`）や `http://` を設定した場合、転送は行われず、転送履歴に `blocked`（未宣言 origin / https 以外の宛先）が残ることを確認します

### トラブルシューティング

- **転送されない**: 転送条件（タグ・スクロール深度・滞在秒）が記録と一致しているか確認してください。記録が非公開判定の場合や、プライバシー判定が存在しない場合（「それでも記録」での保存など）は対象外です
- **証明書エラーで失敗する**: `mkcert -install` のローカル CA が OS 信頼ストアに入っているか確認してください。自己署名のみでは Chrome の fetch が失敗します
- **ポートが競合する**: Obsidian Local REST API（27123/27124）、Ollama（11434）、LM Studio（1234）が稼働中の場合、空いている宣言済みポートを選んでください
- **転送履歴に `blocked (undeclared-origin)` が出る**: 宣言済み 4 ポート以外の URL に設定していないか確認してください。宣言済みループバック宛先のポート照合修正（PBI 2026-10-31-10）を含まない古いビルドでも同じ表示になります。その場合は修正を含むビルドに更新してください
- **同じ記録が転送されない**: 同じ URL で同じ内容の再記録は重複抑制されます。転送し直す場合は転送履歴の「再送」ボタンを使ってください

## English

### Overview

A recipe for querying Yasumaro's records from MCP clients (agents and MCP-aware apps) on the same device. No extension code changes are required: it rides the existing **Webhook Export** (shipped in 6.9.63, opt-in, OFF by default).

- The MCP server implementation itself (native messaging hosts, etc.) is out of scope for this recipe. The repository does not ship an MCP server; you provide a small bridge that runs locally
- No data leaves the device by default (Webhook Export is an opt-in feature, OFF by default)

### How it works (the existing Webhook Export path)

When a record is saved, records that match the transfer condition and are not private are POSTed to a user-configured https destination.

- **Payload**: masked title, masked summary, tags, and URL only (JSON). Page bodies are never sent
  ```json
  {
    "text": "Masked title\nhttps://example.com/page\nMasked summary\n#tag1 #tag2",
    "title": "Masked title",
    "url": "https://example.com/page",
    "summary": "Masked summary",
    "tags": ["tag1", "tag2"]
  }
  ```
- **PII masking right before send**: both the title and the summary pass the privacy masking pass immediately before the send. Records that cannot be masked are not sent
- **Privacy verdict gate**: records without a verdict (forced saves via "Record Anyway", whitelist bypass, expired verdict cache) and records judged private are not sent (fail-closed)
- **URL gate**: https destinations only. http and empty URLs are blocked before any network access
- **Declared host_permissions gate**: origins not declared in the manifest are blocked before any network access (fail-closed). Declared destinations are the AI providers, api.github.com, and the four loopback ports
- **Resend control**: the POST carries an `Idempotency-Key` header (`yasumaro-<record URL>-<FNV-1a hash of the payload>`). Re-recording the same content is duplicate-suppressed, and the dashboard "Resend" button re-POSTs explicitly
- **No redirect following**: a 30x response is treated as a transfer failure (so the body is never forwarded to a Location no gate checked)
- **History and notification**: outcomes are recorded in the transfer history and the OS notification. Only the origin is displayed; the full URL (which may carry a token) is never shown

### Prerequisites (preparing the bridge)

1. **Port**: bind the bridge to a **free port** among the four declared loopback ports (`27123` / `27124` / `11434` / `1234`). They are shared with Obsidian Local REST API (27123/27124), Ollama (11434), and LM Studio (1234), so pick one that is not in use
2. **Certificate**: only https destinations are allowed. Prepare an **OS-trusted local CA** with `mkcert` (or an equivalent) and serve the bridge's HTTPS endpoint with it. Chrome's fetch follows normal TLS validation, so a self-signed-only certificate fails the send
   ```bash
   mkcert -install
   mkcert 127.0.0.1 localhost
   ```
3. **Hostname**: `127.0.0.1` or `localhost` (the hosts covered by the declared patterns)
4. **Bridge responsibilities**: the bridge is a small local process that does three things
   - Accepts the JSON above on an https POST endpoint (with `Content-Type: application/json` and the `Idempotency-Key` header; responds with HTTP 200)
   - Stores the received records on the device (JSON file, SQLite, whichever you prefer)
   - Exposes an MCP server with a tool that queries the stored records (search by tag or keyword, for example). Use the official TypeScript / Python MCP SDK or whichever you choose

### Configuration (extension side, existing UI only)

1. Install the `mkcert` local CA into the OS trust store and issue a certificate for the bridge as above
2. Start the bridge on a free declared port (for example `27124` if it is free) over HTTPS
3. Open the dashboard from the toolbar gear icon and select the "**Webhook Export**" panel in the left sidebar
4. Turn on "**Enable webhook export**" (OFF by default; no data leaves the device unless you enable it)
5. Enter the bridge URL in "**Webhook URL (https only)**" (for example `https://127.0.0.1:27124/records`)
6. Set the transfer condition as needed: "**Tag (optional)**" (only records carrying this tag are forwarded), "**Minimum scroll depth (%)**", and "**Minimum stay seconds**". A tag is the most useful filter when you want to feed only selected records to the MCP client
7. Click "**Save**"
8. From then on, every saved record that matches the condition and is not private is POSTed to the bridge. The "**Transfer History**" panel shows the origin, the state (`sent` / `blocked` / `failed`), and the character count

### Security notes

- **Opt-in, OFF by default**: nothing is sent unless you enable the export
- **PII masking right before send**: the title and the summary are masked again at send time, without trusting storage state. Records that cannot be masked are not sent
- **Four fields only**: masked title, masked summary, tags, URL. Page bodies are never transmitted
- **No record without a privacy verdict**: records without a verdict (forced saves, whitelist bypass, cache expiry) and private records are excluded
- **https only, undeclared origins blocked**: destinations outside the four declared loopback ports and http URLs are blocked before any network access and leave `blocked` in the transfer history
- **Combination with the mask-required per-domain send policy (recommended)**: the dashboard's per-domain AI send policy decides how page bodies are treated when generating summaries (allow sending / record without summary / mask required). For domains whose bodies go to an external AI, prefer "**Mask required**". The bridge (Webhook Export) receives only the title and the summary, masked immediately before the send, regardless of the policy verdict
- **Audit**: the send time, the destination origin, the character count, and the state are recorded in the on-device transfer history

### Verification

1. Confirm the POST arrives in the bridge's log
2. Confirm `sent` and the character count in the Transfer History panel; the OS notification shows "Transferred to <origin> (<reason>)" as well
3. Query the bridge's MCP server from an MCP client and confirm records come back
4. Fail-closed check: with an undeclared port (for example `https://127.0.0.1:8787/`) or `http://`, no transfer happens and the history shows `blocked` (undeclared origin / non-https destination)

### Troubleshooting

- **Nothing is forwarded**: check that the transfer condition (tag, scroll depth, stay seconds) matches the record. Private records and records without a privacy verdict (for example forced saves) are excluded
- **Certificate errors**: confirm the `mkcert -install` local CA is in the OS trust store. A self-signed-only certificate fails Chrome's fetch
- **Port conflicts**: when Obsidian Local REST API (27123/27124), Ollama (11434), or LM Studio (1234) is running, pick a free declared port
- **`blocked (undeclared-origin)` in the history**: check that the URL uses one of the four declared loopback ports. The same message appears on builds that predate the port-matching fix for declared loopback destinations (PBI 2026-10-31-10); update to a build that includes the fix in that case
- **The same record is not forwarded**: re-recording the same URL with the same content is duplicate-suppressed. Use the "Resend" button in the transfer history to forward it again
