# PBI: manualContentFetcher 任意タブ生成とrateLimit迂回

## ユーザーストーリー
悪意ある拡張機能利用者によるDoSを防ぎたい管理者として、manualContentFetcherのタブ生成とrateLimitが適切に制限されるようにしたい、なぜなら任意URLで裏タブを無制限に生成しrateLimitを迂回できると10秒保持の裏タブDoSが可能だから。

## 優先度
- 順位: 3 / 17
- RICEスコア: 320（Reach=40 / Impact=2 / Confidence=80% / Effort=0.2）
- 根拠: manualContentFetcher経由の手動記録利用者に影響 (Reach=40)。裏タブDoSとrateLimit迂回で中影響 (Impact=2)。`isSecureUrl` がhttp/httpsのみでドメイン制限が無く、`skipAi` 無しでrateLimit迂回できることは確信80%。2箇所修正でEffort 0.2。

## なぜなぜ分析
- なぜ任意タブDoSが可能か: `src/background/manualContentFetcher.ts:98` で `chrome.tabs.create({ url, active: false })` が `isSecureUrl` (http/httpsのみ) の検証しかなく、任意ドメインのURLで裏タブを生成でき、ユニークURL連打で10秒保持のタブが蓄積するため
- なぜrateLimit迂回が可能か: `src/background/handlers/recordingHandlers.ts:190-202` で `if (skipAi) { checkRateLimit }` と `skipAi` 時のみrateLimitがかかり、`skipAi=false` の通常manual記録ではrateLimitが素通りするため
- なぜ気づかなかったか: `isSecureUrl` がプロトコル検証として十分と誤認し、ドメイン制限の必要性が見落とされた。rateLimitはAI呼び出しコスト保護として `skipAi` 時のみ必要と誤解し、手動タブ生成自体のDoS面が考慮されなかった
- 解: `isSecureUrl` にドメイン制限を追加（許可ドメインリストまたは既存タブのURLのみ許可）、rateLimitを `skipAi` 外に移動し全manual記録で適用

## ビジネス価値
任意タブ生成による裏タブDoSとrateLimit迂回を同時に解消し、拡張機能の安定性とリソース枯渇耐性を確保する。悪意あるユーザーがユニークURLを連打してブラウザを重くする攻撃を防止。

## BDD受け入れシナリオ

```gherkin
Scenario: ハッピーパス — 既存タブのURLは正常にfetchできる
  Given ブラウザに "https://example.com/page" のタブが既に開かれている
  When manualContentFetcher.fetchContent("https://example.com/page") を呼ぶ
  Then 既存タブが再利用され、contentが正常に取得される
  And  新規タブは生成されない

Scenario: 攻撃 — 任意URL連打はrateLimitとドメイン制限でブロックされる
  Given 攻撃者が "https://evil.com/unique?id=1" … "https://evil.com/unique?id=100" のユニークURLで連打する
  When 各URLで MANUAL_RECORD (skipAi=false) を送信する
  Then rateLimitにより一定回数以降は { success: false, error: "Rate limit exceeded" } が返される
  And  存在しないドメインの裏タブは生成されない（または生成数が制限される）
```

## 受け入れ基準
- [ ] `src/utils/urlUtils.ts:33` の `isSecureUrl` または `manualContentFetcher.ts` 内のURL検証にドメイン制限が追加されている（例: 既存タブのURLのみ許可、または許可リスト検証）
- [ ] `src/background/handlers/recordingHandlers.ts:190-202` のrateLimitチェックが `skipAi` 条件の外に移動し、`skipAi=false` でもrateLimitが適用される
- [ ] ユニークURL連打時にrateLimitが発動し、裏タブの無制限生成が防止される
- [ ] 既存の正常系テスト (`manualContentFetcher.test.ts`, `messageHandlers-recordSecurity.test.ts`) がパスする
- [ ] `chrome.tabs.create` が呼ばれる条件が制限され、10秒保持の裏タブDoSが再現しない

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- Chrome拡張で手動記録を連打し、rateLimitエラーが返ることを手動確認

### 統合テスト
- `createManualRecordHandler` にモック `checkRateLimit` を注入し、`skipAi=false` でも `checkRateLimit` が呼ばれることを検証
- `ManualContentFetcher.fetchContent` で存在しないURLを渡した際に `chrome.tabs.create` が呼ばれない（または制限される）ことを検証

### 単体テスト
- `isSecureUrl` または新設の `isAllowedManualFetchUrl` が任意ドメインを拒否し、既存タブドメインのみ許可することを検証
- `checkRateLimit` が `skipAi` の値に関わらず呼ばれることの境界値テスト
- rateLimit超過時のエラーレスポンスが正しいことを検証
- `TAB_LOAD_TIMEOUT_MS` (10s) のタイムアウトが適切に動作することを検証

## 実装アプローチ
- **Outside-In**: 統合テスト（handlerのrateLimit呼び出し検証）→ 単体テスト（URL検証）→ 実装
- **Red-Green-Refactor**: まず `skipAi=false` でrateLimitが呼ばれないことを示す失敗テストを書き、次に条件移動でグリーン化
- **リファクタリング**: グリーン後に `isSecureUrl` の責務を明確化（プロトコル検証 vs ドメイン許可は別関数に分離）

## 見積もり
0.2pt（2箇所修正、要チームでの見積もり）

## 技術的考慮事項
- 依存関係: `src/background/rateLimiter.ts`, `src/utils/urlUtils.ts`, `src/background/manualContentFetcher.ts`
- テスタビリティ: `ManualContentFetcher` は `chrome.tabs` をモックしてテスト可能。`createManualRecordHandler` はdeps注入でテスト可能
- 非機能要件: セキュリティ（DoS防止）、性能（裏タブ生成の抑制でメモリ・CPU保護）
- 影響範囲: `recordingHandlers.ts` のrateLimit分岐、`manualContentFetcher.ts` のタブ生成ロジック、`urlUtils.ts` の検証関数

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
grep -rn "isSecureUrl\|fetchContent\|checkRateLimit" src/background/manualContentFetcher.ts src/background/handlers/recordingHandlers.ts src/utils/urlUtils.ts
grep -rn "skipAi" src/background/handlers/recordingHandlers.ts
```

既実装の可能性がある場合はここに明記し、調査してから実装に進むこと。

### 実装手順
1. `src/background/handlers/recordingHandlers.ts:176-202` を読む。現状 `if (skipAi) { checkRateLimit }` であることを確認
2. rateLimitを `skipAi` 外に移動:
   ```typescript
   // Before:
   if (skipAi) {
     const rateLimitResult = await deps.checkRateLimit(senderLike, settings);
     ...
   }
   // After:
   const rateLimitResult = await deps.checkRateLimit(senderLike, settings);
   if (!rateLimitResult.allowed) {
     sendResponse({ success: false, error: rateLimitResult.error });
     return;
   }
   ```
   または `MANUAL_RECORD` 全体でrateLimitを必須化（`PREVIEW_RECORD` も同様に検討）
3. `src/background/manualContentFetcher.ts:96-99` の `chrome.tabs.create` 前にドメイン制限を追加:
   ```typescript
   // 案: 既存タブのURLドメインのみ許可、または許可リストチェック
   if (!isAllowedManualFetchUrl(url, existingTabs)) {
     throw new Error('URL not allowed for manual fetch');
   }
   ```
   `isAllowedManualFetchUrl` は `isSecureUrl` に加え、既存タブのドメインと一致するか検証
4. `src/utils/urlUtils.ts` に `isAllowedManualFetchUrl` を新設するか、`isSecureUrl` を拡張するか判断（単一責務原則からは新関数を推奨）
5. テストを追加し `npm run type-check && npm test` で検証

### 落とし穴
- rateLimitを全manual記録に適用すると、正常ユーザーの手動記録体験に影響する可能性。レート制限の閾値（`rateLimiter.ts` の設定）が適切か確認。過度に厳しいとUXを損なう
- ドメイン制限を厳しすぎると、ユーザーが新規URLを手動記録したい正当なケースをブロックする。既存タブが無い場合のフォールバック（例: ユーザーが明示的に入力したURLは許可）を検討
- `chrome.tabs.create` のエラーハンドリング (`manualContentFetcher.ts:101-108`) は既に存在するが、ドメイン制限でthrowした場合も同様に `logWarn` で適切にハンドリングされるか確認
- `TAB_LOAD_TIMEOUT_MS = 10000` の10秒保持はDoSの観点で長い。タイムアウト短縮や同時生成数制限（例: 最大3タブ）も併せて検討

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [ ] コードレビュー完了（GitHub PR での approve を必須とする。セキュリティに関わる変更は CLAUDE.md「For Security Review Agents」節の観点確認をPR説明に明記）
- [ ] リファクタリング完了（グリーン後）
- [ ] ロールバック手段の検討（rateLimit閾値変更は設定で調整可能、ドメイン制限はfeature flagまたはrevertで切り戻し）
- [ ] ドキュメント更新済み
