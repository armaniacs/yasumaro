# PBI: Code Quality ハードニング一括 — 将来攻撃面6件

> 当初この PBI には orphan-key 機能バグ（pending パネルのホワイトリスト追加が無効）が含まれていたが、
> 実在のユーザー影響がある機能バグのため `2026-08-29-15-fix-pending-whitelist-orphan-key.md` に分離した
> （PR #71 で着地・`dev-docs/archived/pbi/` へ移動済み）。
> 本 PBI は防御深度のハードニング 6 件に絞る。

## ユーザーストーリー
開発者として、CSP/URL 許可の自己許可構造や旧 href パネルなど、現在不発でも将来の攻撃面になるハードニング指摘を一括で解消したい、なぜならハードニングは前提変化時に脆弱性へ昇格するから

## ビジネス価値
- 6 ハードニング: CSPValidator 自己許可（`src/utils/cspValidator.ts` の該当メソッド）、urlWhitelist 自己許可（`src/utils/storage/urlWhitelist.ts` の `buildAllowedUrls` / `src/utils/allowedUrls.ts` の `buildAllowedUrls`）、Gemini model path 生補間（`src/background/ai/providers/GeminiProvider.ts`）、TSV 数式無害化欠落（`src/dashboard/utils/auditLogTsv.ts` の `escapeTsvField`）、models-dev asset スキーマ検証（`src/dashboard/models-dev-dialog.ts`）、旧 a.href パネルの isSecureUrl 欠落（`src/dashboard/historyEntryRow.ts` / `src/dashboard/historyPendingPanel.ts`）
- 測定方法: 各ハードニングの検証テスト追加

## 優先度
- 順位: 14 / 15
- RICEスコア: 170（Reach=300 / Impact=0.1 / Confidence=85% / Effort=0.15人月）
  - Reach 300: ハードニングは将来前提
  - Impact 0.1: 防御深度（現行 exploitable ではない — VulnHunter Phase 2b の Code Quality 分類）
  - Confidence 85%: 各修正は小さいが、6 件の横断でハズレがないかの確認が必要
  - Effort 0.15: 6 件の小修正を束ねて 1 PBI
- 根拠: 個々は 1pt 未満だが束ねることで追跡コストを 1 件に圧縮。任意タイミングで着手

## BDD受け入れシナリオ

```gherkin
Scenario: CSP ドメインの自己許可が封じられる
  Given 設定由来の CSP ドメイン検証が走る
  When CSPValidator の該当メソッドが評価する
  Then 拡張自身のオリジン/任意オリジンを無条件許可する経路が存在しない

Scenario: allowedUrls は ublock origin を自己許可しない
  Given フィルタ URL の許可判定が走る
  When buildAllowedUrls が評価する
  Then ublock 系 origin が無条件に許可リストに入らない

Scenario: TSV エクスポートは数式トリガー文字を無害化する
  Given 監査ログのフィールドが "=" で始まる値を持つ
  When TSV エクスポートが実行される
  Then escapeTsvField が数式トリガー（`=` `+` `-` `@` 先頭）を無効化する

Scenario: Gemini model path はエンコードされる
  Given model 名に `/` や `..` を含む値が渡る
  When GeminiProvider が API URL を組む
  Then segment が encodeURIComponent / 検証を通り、パストラバーサルにならない

Scenario: 旧 href パネルは安全な URL のみ開く
  Given 履歴/pending パネルの行に javascript: スキームの URL がある
  When 行のリンクがクリックされる
  Then isSecureUrl ゲートで拒否され、tabs.create されない
```

## 受け入れ基準
- [ ] `src/utils/cspValidator.ts` の自己許可経路が削除または明示的なレビュー根拠付きに修正されている
- [ ] `src/utils/storage/urlWhitelist.ts` の `buildAllowedUrls`（および `src/utils/allowedUrls.ts` の同名関数）の ublock origin 自己許可が修正されている
- [ ] `src/background/ai/providers/GeminiProvider.ts` の model path に `encodeURIComponent`/segment 検証が追加されている
- [ ] `src/dashboard/utils/auditLogTsv.ts` の `escapeTsvField` に `escapeCsv`（`src/dashboard/exportLogsService.ts` の同等処理）相当の数式トリガー無害化が適用されている
- [ ] `src/dashboard/models-dev-dialog.ts` に `doc`/`api` の https: 検証＋読み込み時スキーマ検証が追加されている
- [ ] `src/dashboard/historyEntryRow.ts` / `src/dashboard/historyPendingPanel.ts` の a.href / tabs.create に `isSecureUrl` ゲートが適用されている
- [ ] `npm run type-check` と `npm run validate` が成功する

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象なし（各修正は単体テストで閉じる）

### 統合テスト
- `models-dev-dialog` × 不正 asset JSON: スキーマ検証で拒否されること

### 単体テスト
- 更新: `escapeTsvField` の境界値テスト（`=`/`+`/`-`/`@` 先頭）
- 新規: models-dev スキーマ検証のテスト（不正 doc/api の拒否）
- 更新: href パネルの isSecureUrl テスト（javascript: 拒否）
- 新規: `GeminiProvider` の model path エンコードテスト
- 新規: `buildAllowedUrls` の ublock origin 自己許可が入らないテスト

## 実装アプローチ
- **Outside-In**: 各ハードニングは単体テスト先行で各 1 コミット
- **Red-Green-Refactor**: 単純な 2 件（TSV 無害化 / Gemini path エンコード）→ models-dev / href パネル → CSP/allowedUrls の締め直し（既存設定の棚卸し後）

## 見積もり
1pt（要チームでの見積もり — 6 小修正）

## 技術的考慮事項
- 依存関係: なし（任意タイミング）。他 PBI とファイル触接なし
- テスタビリティ: 各修正が独立し、単体テストで閉じる
- 非機能要件: CSP/allowedUrls の締め直しが正当な設定利用を壊さないこと（既存設定の棚卸しを先に）
- 注意: models-dev JSON は bundled asset（`chrome.runtime.getURL`）であり、リモート取得に変わった場合のみ脅威が変わる — コメントで前提を明記
- 行番号は監査時点（2026-08-29）のもの。着手時に該当シンボルで再確認すること

## 実装者向け注記

### 現状コードの確認
```bash
rg -n "self|自己許可|extension.*origin|runtime\.id" src/utils/cspValidator.ts
rg -n "ublock|buildAllowedUrls" src/utils/storage/urlWhitelist.ts src/utils/allowedUrls.ts
rg -n "model|encodeURIComponent" src/background/ai/providers/GeminiProvider.ts
rg -n "escapeTsvField" src/dashboard/utils/auditLogTsv.ts
rg -n "isSecureUrl|tabs\.create|a\.href" src/dashboard/historyEntryRow.ts src/dashboard/historyPendingPanel.ts
```

### 実装手順
1. TSV 無害化＋Gemini path エンコード（単純な 2 件）
2. models-dev スキーマ検証、href パネル isSecureUrl
3. CSPValidator/urlWhitelist の自己許可締め直し（設定棚卸し後に着手）
4. テスト追加、`npm run validate`

### 落とし穴
- CSPValidator の締め直しは正当な AI provider カスタム baseUrl を壊す可能性 — `src/utils/cspDomains.ts` の LOCAL_PORTS/aiConnectSrc 経路を先に確認
- 旧 href パネルへの isSecureUrl 適用で、http:// ページの再オープン（tabs.create）が変わる可能性 — pendingPages の DESIGN-INTENT（自身の訪問 URL 再オープン）と衝突しないよう範囲を限定
- `escapeTsvField` は現状 `\t` `\n` `"` のみ処理。数式トリガー（先頭 `= + - @`）は別途プレフィックス（`'`）付与が必要

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] VulnHunter Code Quality 指摘の再スキャンで該当項目が解消されること
