# PBI: Code Quality ハードニング一括 — 機能バグ1件＋将来攻撃面6件

## ユーザーストーリー
開発者として、pending パネルのホワイトリスト追加が正しいストレージキーに書かれるようにし、CSP/URL 許可の自己許可構造や旧 href パネルなど、現在不発でも将来の攻撃面になるハードニング指摘を一括で解消したい、なぜなら沈黙した機能バグは信頼を損ない、ハードニングは前提変化時に脆弱性へ昇格するから

## ビジネス価値
- **機能バグ（実質のユーザー影響）**: popup pending パネルの「ホワイトリストへ追加」が orphan キー `'domainWhitelist'` に書かれ、正キー `domain_whitelist` の読み手がゼロ — 機能が沈黙して効いていない
- 7 ハードニング: CSPValidator 自己許可（cspValidator.ts:143-170）、urlWhitelist 自己許可（urlWhitelist.ts:134-144）、Gemini model path 生補間（GeminiProvider.ts:71-73）、TSV 数式無害化欠落（auditLogTsv.ts:21-26）、models-dev asset スキーマ検証（models-dev-dialog.ts:417-427,457-459）、旧 a.href パネルの isSecureUrl 欠落（historyEntryRow.ts:114, historyPendingPanel.ts:94/177）
- 測定方法: orphan キー書き込み 0 件、各ハードニングの検証テスト追加

## 優先度
- 順位: 14 / 14
- RICEスコア: 255（Reach=300 / Impact=0.15 / Confidence=85% / Effort=0.15人月）
  - Reach 300: orphan キーは whitelist 利用者に実害。ハードニングは将来前提
  - Impact 0.15: 機能不具合＋防御深度（現行 exploitable ではない — VulnHunter Phase 2b の Code Quality 分類）
  - Confidence 85%: 各修正は小さいが、7 件の横断でハズレがないかの確認が必要
  - Effort 0.15: 7 件の小修正を束ねて 1 PBI
- 根拠: 個々は 1pt 未満だが束ねることで追跡コストを 1 件に圧縮。orphan キーは機能バグとして最優先項目

## BDD受け入れシナリオ

```gherkin
Scenario: pending パネルのホワイトリスト追加が有効になる
  Given ユーザーが pending パネルでドメインをホワイトリストに追加する
  When 保存が実行される
  Then StorageKeys.DOMAIN_WHITELIST 経由で正キーに書かれ、録画判定で許可される

Scenario: CSP ドメインの自己許可が封じられる
  Given 設定由来の CSP ドメイン検証が走る
  When validateCspDomains が評価する
  Then 拡張自身のオリジン/任意オリジンを無条件許可する経路が存在しない

Scenario: allowedUrls は ublock origin を自己許可しない
  Given フィルタ URL の許可判定が走る
  When buildAllowedUrls が評価する
  Then ublock 系 origin が無条件に許可リストに入らない

Scenario: TSV エクスポートは数式トリガー文字を無害化する
  Given 監査ログのフィールドが "=" で始まる値を持つ
  When TSV エクスポートが実行される
  then escapeTsvField が数式トリガーを無効化する
```

## 受け入れ基準
- [ ] `src/popup/pendingPages.ts:59-75` が `StorageKeys.DOMAIN_WHITELIST`（`storage/types.ts:60`）経由で書き込み、SettingsRepository パターンに統一されている
- [ ] `src/background/cspValidator.ts:143-170` の自己許可経路が削除または明示的なレビュー根拠付きに修正されている
- [ ] `src/utils/urlWhitelist.ts:134-144` の ublock origin 自己許可が修正されている
- [ ] `src/background/ai/providers/GeminiProvider.ts:71-73` に `encodeURIComponent`/segment 検証が追加されている
- [ ] `src/utils/auditLogTsv.ts:21-26` に `escapeCsv`（exportLogsService.ts:84）相当の数式トリガー無害化が適用されている
- [ ] `src/dashboard/models-dev-dialog.ts:417-427,457-459` に `doc`/`api` の https: 検証＋読み込み時スキーマ検証が追加されている
- [ ] `historyEntryRow.ts:114`、`historyPendingPanel.ts:94/177` に `isSecureUrl` ゲートが適用されている
- [ ] `npm run type-check` と `npm run validate` が成功する

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- pending パネル → ホワイトリスト追加 → 同一ドメインの録画許可を popup 操作で確認（実機能の回帰）

### 統合テスト
- `domainFilter` × pending 追加: 正キーへの書き込みと反映

### 単体テスト
- 更新: `escapeTsvField` の境界値テスト（`=`/`+`/`-`/`@` 先頭）
- 新規: models-dev スキーマ検証のテスト（不正 doc/api の拒否）
- 更新: href パネルの isSecureUrl テスト（javascript: 拒否）

## 実装アプローチ
- **Outside-In**: orphan キー修正（ユーザー実害）を先に E2E で Red→Green。ハードニング 6 件は単体テスト先行で各 1 コミット
- **Red-Green-Refactor**: orphan キー修正後、`StorageKeys` 経由でない literal キー書き込みを grep で棚卸し（将来の再発防止）

## 見積もり
1pt（要チームでの見積もり — 7 小修正＋orphan キー E2E）

## 技術的考慮事項
- 依存関係: なし（任意タイミング）。他 PBI とファイル触接なし
- テスタビリティ: 各修正が独立し、単体テストで閉じる
- 非機能要件: CSP/allowedUrls の締め直しが正当な設定利用を壊さないこと（既存設定の棚卸しを先に）
- 注意: models-dev JSON は bundled asset（`chrome.runtime.getURL`）であり、リモート取得に変わった場合のみ脅威が変わる — コメントで前提を明記

## 実装者向け注記

### 現状コードの確認
```bash
sed -n '55,78p' src/popup/pendingPages.ts
rg -n "'domainWhitelist'|domain_whitelist" src --type ts
sed -n '140,172p' src/background/cspValidator.ts
sed -n '130,148p' src/utils/urlWhitelist.ts
sed -n '68,76p' src/background/ai/providers/GeminiProvider.ts
sed -n '18,28p' src/utils/auditLogTsv.ts
```

### 実装手順
1. orphan キー修正＋E2E（最優先）
2. TSV 無害化＋Gemini path エンコード（単純な 2 件）
3. models-dev スキーマ検証、href パネル isSecureUrl
4. CSPValidator/urlWhitelist の自己許可締め直し（設定棚卸し後に着手）
5. テスト追加、`npm run validate`

### 落とし穴
- orphan キー修正で「既に orphan キーに書かれたデータ」の救済（移行 or 廃棄）を決めること — 利用者は追加が効いていない認識なので廃棄でよい（要コメント）
- CSPValidator の締め直しは正当な AI provider カスタム baseUrl を壊す可能性 — cspDomains.ts の LOCAL_PORTS/aiConnectSrc 経路を先に確認
- 旧 href パネルへの isSecureUrl 適用で、http:// ページの再オープン（tabs.create）が変わる可能性 — pendingPages の DESIGN-INTENT（自身の訪問 URL 再オープン）と衝突しないよう範囲を限定

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] VulnHunter Code Quality 指摘の再スキャンで該当項目が解消されること
