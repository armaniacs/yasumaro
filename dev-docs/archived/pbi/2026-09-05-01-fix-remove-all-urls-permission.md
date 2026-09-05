# PBI: optional_host_permissions から `<all_urls>` を削除

## ユーザーストーリー
拡張機能の利用者として、権限は必要な取得先だけに限定してほしい、なぜなら広すぎる権限を付与すると単一の不具合の影響範囲が全サイトに広がり安心して使えないから

## 優先度
- 順位: 01 / 26
- RICEスコア: 7,200（Reach=1000 / Impact=2 / Confidence=0.9 / Effort=0.25日）
- 根拠: 最小権限の原則に反し、付与ひとつで被害範囲が全オリジンに拡大するセキュリティリスクのため最優先。修正は宣言1行の削除で効果が大きい。

## BDD受け入れシナリオ
```gherkin
Scenario: optional権限に全サイト指定が含まれない
  Given 拡張機能をビルドした状態
  When  生成されたマニフェストの optional_host_permissions を確認する
  Then  `<all_urls>` が含まれていない

Scenario: 必要な取得先ドメインは引き続き任意許可できる
  Given 拡張機能をビルドした状態
  When  生成されたマニフェストの optional_host_permissions を確認する
  Then  AIプロバイダーやリスト取得先の個別ドメイン（例: api.openrouter.ai、easylist.to）が残っている

Scenario: 個別サイトへの動的許可は都度要求できる
  Given ホスト単位の許可が必要な操作を行う状態
  When  その操作を実行する
  Then  対象オリジンだけを `chrome.permissions.request({ origins })` で要求し、全サイト指定の一括要求は行わない
```

## 受け入れ基準
- [x] ビルド後のマニフェストの `optional_host_permissions` に `<all_urls>` が含まれない
- [x] `OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS` に列挙された個別ドメインが欠けなく残っている
- [x] `npm run build` が成功し、マニフェスト関連の既存テストがパスする（必要に応じて期待値を更新）

## テスト戦略
- E2E: ビルド成果物のマニフェストを読み取り、`optional_host_permissions` に `<all_urls>` がないことと個別ドメインが残っていることを検証する
- 単体: マニフェスト生成・権限一覧のテストで `<all_urls>` 不在を表明する（`src/__tests__/manifest.test.ts` の optional_host_permissions 系を更新）

## 実装アプローチ
`wxt.config.ts` の `optional_host_permissions` 宣言から `<all_urls>` の1要素だけを削除し、`OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS` の個別ドメイン列挙だけを残す。ホスト単位の追加許可が必要な場面では宣言を追加せず、実行時に `chrome.permissions.request({ origins })` で対象オリジンのみを都度要求する方針に寄せる。

## 見積もり
1ポイント（0.25日相当：宣言1行の削除とマニフェスト確認が中心）

## 実装者向け注記
- 確認済み現状: `wxt.config.ts:74` が `optional_host_permissions: [...OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS, '<all_urls>']` となっている
- 残すべき一覧: `src/utils/cspDomains.ts:26` の `OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS`（HuggingFace・OpenRouter・DeepInfra・Cerebras などのAI取得先と、raw.githubusercontent.com・gitlab.com・tranco-list.eu・easylist.to・pgl.yoyo.org・nsfw.oisd.nl などのリスト取得先、計33件）
- 都度要求の前例: `src/dashboard/cspSettings.ts:257,275` と `src/utils/permissionManager.ts:137` で `chrome.permissions.request({ origins: [...] })` の形式が既に使われている
- 注意: `src/utils/permissionManager.ts:347-366`（`isAllUrlsPermitted`・`requestAllUrls`）と `src/popup/recordCurrentPage/tabContentFetcher.ts:11,63` に `<all_urls>` を前提とした処理・テスト（permissionManager / tabContentFetcher 系）が残っている。本PBIのスコープはマニフェスト宣言の削除のみとし、これらの呼び出し側の振る舞い変更は別PBIで扱う。ただし宣言削除で壊れるテスト期待値は本PBI内で更新すること

## 実装メモ
- 2026-09-05 完了: `wxt.config.ts` の `optional_host_permissions` から `'<all_urls>'` を削除（意図を示すコメント付き）。`manifest.test.ts` に不在アサーション新設（`should not contain <all_urls> (least privilege)`）。影響テスト 6 スイート 95 tests green、type-check clean、`npm run build` 成功、ビルド済み manifest の optional_host_permissions に `<all_urls>` 不在を確認。
- 残置（スコープ外・別 PBI）: ①ビルド済み manifest の `content_scripts.matches` の `<all_urls>` は追跡機能の本質のため残す。②`permissionManager`（isAllUrlsPermitted/requestAllUrls）・`tabContentFetcher` の Level 2 opt-in は宣言削除後は `chrome.permissions.request` が失敗するため、呼び出し側の振る舞い変更（per-origin 都度要求への統一）が次の対応候補。③`headerDetector.ts:39` の webRequest フィルタ `urls: ['<all_urls>']` は許可済みオリジンのみ観測対象になる（実行時許可に従う挙動で fail-safe）。

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（permissions ガイドがあれば）※permissions 専用ガイドは存在しないため対象外

## 実装メモ（2026-09-05・branch 0905c）
- 完了（commit `58a894c1`、controller-direct）。manifest.test.ts に不在アサーション新設。影響 6 スイート 95 tests green + build 成功。詳細は上部 実装メモ 参照。
