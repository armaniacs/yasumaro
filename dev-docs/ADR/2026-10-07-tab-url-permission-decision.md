# ADR: tabs 権限なしで参照される tab.url の制約 — manifest 変更なしで nav trail を記録由来に再配線する裁定

## ステータス
採用

## 日付
2026-10-07

## コンテキスト
manifest（`wxt.config.ts:223-235`）は `permissions` に `tabs` を宣言しておらず、
`host_permissions`（`wxt.config.ts:240`）は localhost（Obsidian Local REST API）+
AI provider ドメインのみ。これは 2026-03-20 の host_permissions 最小化 ADR が
確立した最小権限・privacy posture（データは端末内・`public/PRIVACY.md`、
Firefox の `data_collection_permissions: { required: ['none'] }`）の帰結である。

一方、Chrome は `tabs` 権限またはその URL に対する host permission がない拡張に、
`chrome.tabs.get` / `tabs.query` の結果と `tabs.onUpdated` イベントの
`tab.url` / `tab.title` / `changeInfo.url` を渡さない。**エラーにはならず、
黙って `undefined` が返る**（.kilorules #5）。エラーが出ないため、参照箇所は
early return / 条件不成立という形で構造的に無効化され、ログも失敗も出ない。

例外として、`sender.tab.url`（`chrome.runtime.onMessage` の MessageSender）は
tabs 権限なしでも読める: コンテンツスクリプトが注入済みのタブでは receiver が
送信元フレームの URL を取得できる。本リポジトリはこれに依存している —
VALID_VISIT の trust gate `isTabPageSender`（`src/background/handlers/senderTrust.ts:48-54`）
が `sender.tab?.url` を要求し、VALID_VISIT 記録が全 http(s) ページで動作している。
コンテンツスクリプトは `<all_urls>` で注入される（`entrypoints/content/index.ts:7`）。

### 誰が tab.url / changeInfo.url を読み書きするか

**読める（制約の影響外）:**

| 経路 | URL の由来 | 通常サイトでの挙動 |
|---|---|---|
| VALID_VISIT 記録（`src/background/handlers/recordingHandlers.ts:122-132`） | `sender.tab.url`（MessageSender 由来） | 動く（全 http(s) ページ） |
| tabCache add/update（`src/background/tabCache.ts:44-46,104-106`） | `sender.tab`（VALID_VISIT の `cacheTab`） | 動く |
| MANUAL_RECORD / SAVE_RECORD（`recordingHandlers.ts:249-257,301-308`） | `payload.url`（popup が取得） | 動く（activeTab 発火時のみ） |
| popup statusPanel / whitelist（`src/popup/statusPanel.ts:254,283`） | `tab.url` | 動く（popup クリック = activeTab 発火） |
| context menu 手動記録（`src/background/handlers/contextMenuHandlers.ts:50-58`） | `tab.url` | 動く（context menu クリック = activeTab 発火） |
| sender trust gate（`senderTrust.ts:48-54`） | `sender.tab.url` | 動く |

**読めない（tabs 権限 / host permission の欠如で no-op になる経路）:**

| 経路 | 参照 | 通常サイトでの挙動 |
|---|---|---|
| nav trail writer（`src/background/service-worker.ts:268-281`） | `changeInfo.url` | **no-op**: `changeInfo.url` が配信されず、nav trail の session map が一度も書かれない |
| badge 更新・遷移完了（`src/background/handlers/tabEventHandlers.ts:70-75`） | `tab.url` | **no-op**: `!tab.url` で early return。遷移時の badge 更新（privacy / excluded / C{n} クリア）と `autoSavedBadgeTabs.delete` が走らず、記録済み badge が stale になりうる |
| badge 更新・アクティブ化（`src/background/handlers/tabEventHandlers.ts:42-44,52`） | `tab.url`（`tabs.get` 結果） | **劣化**: privacy / excluded / recording 状態が表示されず、recorded または clear のみ |

nav trail の構造的矛盾: 唯一の writer（`navTrailTracker.ts:69-93` `onTabUrlChanged`）は
`changeInfo.url` 依存で通常サイトで発火せず、reader（記録時の
`resolveNavTrailFields` → `getNavSource`）はその map を読む。結果、通常サイトでは
`navSourceUrl` / `searchQuery` は常に空。nav trail が機能するのは host permission
のある origin（localhost / AI provider — 実ブラウジングの対象にならない）だけなので、
**実質的に死んだ機能**である。

制約の文書化済み例は `src/background/regenerateContentFetcher.ts:11-13` のみ
（「manifest has no `tabs` permission, so `tab.url` is unreadable for most origins —
reuse lookup would silently fail anyway」）。

## 関連するADR
- [マニフェストhost_permissions最小化](./2026-03-20-manifest-host-permissions-minimization.md)
- [履歴の診断行は欠測時も理由付きで常に表示する](./2026-09-18-history-diagnostic-rows-always-visible.md)

## 選択肢の比較

### 案 A: manifest permissions に `tabs` を追加

- **影響（install ダイアログ）**: 権限文言に「閲覧履歴の読み取り」（Read your
  browsing history）が新規表示される。新規 install と update 時の再同意の両方に出る。
- **整合**: 2026-03-20 host_permissions 最小化 ADR が削った方向（過剰な権限要求 →
  審査リスク・ユーザー不信）に正面から逆行する。privacy posture（データは端末内、
  browsing data を読まない建前）の表示も後退する。
- **利得**: 上記 no-op 経路が全ページで動くようになる。コード変更は不要。
- **費用**: 2 つの副次機能（badge 補完、opt-in nav trail）のために全ユーザーに
  broad permission を要求する。manifest 権限変更は AGENTS.md の高リスク領域。

### 案 B: manifest 変更なし — nav trail を VALID_VISIT 由来に再配線

- **nav trail**: writer を VALID_VISIT 表面（記録成立時に `sender.tab.url` が読める
  唯一の経路）由来に再配線する。**語義変化**: `changeInfo.url` は遷移の即時点、
  VALID_VISIT は記録条件（同意・エンゲージメント閾値）成立後。ただし現行 writer は
  通常サイトで一度も発火していないため、no-op → 遅延化であり実質的な退化ではない。
- **badge URL 経路**: no-op を受容して文書化する。recorded 状態は VALID_VISIT の
  成功経路が書くため維持され、URL 由来の privacy / excluded 表示だけが通常サイトで
  欠ける。ユーザー起因の表面（popup / context menu）では引き続き URL が読める。
- **privacy の副次効果**: URL の ingestion が記録時のみの pull 型のままになり、
  全ページの `onUpdated` URL イベントが SW に入ることはない。

## 決定事項

**案 B を採用する。manifest に `tabs` を追加しない。**

1. **manifest 変更を行わない。** install ダイアログの権限文言と privacy posture を
   現状維持する。2026-03-20 最小化 ADR の方向を保つ。
2. **nav trail の writer を VALID_VISIT 由来に再配線する。** 実装は後続 fix PBI
   （`pbi/2026-10-07-18-fix-tab-url-nav-trail-rewire.md`）。語義変化（即時 → 記録時）
   を pin テストで固定すること。
3. **badge URL 経路の no-op は受容し、参照箇所に根拠コメントを残す。**
   `tabEventHandlers.ts` / `service-worker.ts` の参照箇所に、本 ADR を指す
   regenerate 経路と同等の根拠コメントを追加する（本 PBI で実施）。
4. **昇格条件**: badge の URL 由来情報が必須機能になった場合、案 A を再評価する
   （install 文言・審査への影響を含めて）。

## 却下した選択肢

### 案 A（`tabs` 権限追加）

- **install ダイアログの権限文言が変わる。**「閲覧履歴の読み取り」の新規表示は、
  browsing data を読まない建前で ships している本拡張（`public/PRIVACY.md`、
  Firefox `data_collection_permissions: { required: ['none'] }`）の disclosure と矛盾する。
- **2026-03-20 最小化 ADR との整合がない。** host_permissions を 2053 → 28 に削った
  同一プロジェクトが、副次機能のために broad permission を再導入するのは方針の逆行。
- **審査リスク。** Chrome Web Store は broad host / tabs 権限を過剰権限として
  扱うリスクがあり、update 時の再同意で既存ユーザーに影響する。
- **代替が存在する。** 案 B で死んだ nav trail は復活でき、badge の欠落部分は
  補助情報（バッジ表示は判定不能を「記録されない」と誤表示しない建前、
  `tabBadgeResolver.ts:29-32` 参照）として文書化で受容できる。

## 結果

### メリット

- install ダイアログの権限文言が変わらず、privacy posture を維持する。
- nav trail が通常サイトで実質動くようになる（後続 fix PBI）。
- URL ingestion が pull 型（記録時のみ）のままになり、全ページの URL イベントが
  SW に入る経路が消える。

### デメリット

- badge の URL 由来表示（privacy / excluded / recording / 遷移時クリア）は
  通常サイトで動かないまま。stale な recorded badge も起こりうる。no-op として
  文書化して受容する。
- nav trail の語義変化（遷移の即時点 → 記録条件成立後）が発生する。pin テストで
  固定する。
- URL 依存の新経路を追加した場合、黙って no-op になるリスクが残る。検出は
  参照箇所の根拠コメントとレビューに依存する（機械的検出は存在しない）。

### 影響範囲

- 本 PBI（調査・裁定）: ADR 本書、`tabEventHandlers.ts` / `service-worker.ts` の
  根拠コメント、後続 PBI 起票。挙動変更なし。
- 後続 fix PBI: `src/background/service-worker.ts`（writer 削除）、
  `src/background/handlers/recordingHandlers.ts` または `navTrailTracker.ts`
  （VALID_VISIT 由来の供給）、pin テスト。

### 実装計画

`pbi/2026-10-07-18-fix-tab-url-nav-trail-rewire.md`。挙動変更は fixture pin 付きで
そちらが実施する。

## 参照

- `pbi/2026-10-07-07-investigate-tab-url-permission-decision.md`
- `dev-docs/plans/2026-10-07-pbi07-tab-url-permission-decision-plan.md`
- `pbi/2026-10-07-18-fix-tab-url-nav-trail-rewire.md`
- `src/background/regenerateContentFetcher.ts:11-13`（制約の文書化済み例）
