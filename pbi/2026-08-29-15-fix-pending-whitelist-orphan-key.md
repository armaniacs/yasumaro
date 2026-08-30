# PBI: pending パネルのホワイトリスト追加が無効な機能バグを修正する（orphan key）

> `2026-08-29-14-fix-security-hardening-code-quality.md` から分離。実在のユーザー影響がある機能バグのため単独 PBI とし、Wave 1 で即着手する。

## ユーザーストーリー
利用者として、popup の pending パネルで「ホワイトリストへ追加」を押したドメイン/パスが実際に録画対象になるようにしたい、なぜなら現在は追加操作が何も起きていないのと同じで、意図したページが記録されないから

## ビジネス価値
- **機能バグ（実質のユーザー影響）**: `src/popup/pendingPages.ts` の `addDomainsOrPathsToWhitelist` が `chrome.storage.local` の **orphan キー `'domainWhitelist'`（キャメルケース）** に読み書きしている。コードベースの他の全消費者は `StorageKeys.DOMAIN_WHITELIST` = `'domain_whitelist'`（スネークケース）を読む。結果、pending パネルからのホワイトリスト追加は**どこからも参照されず、完全に無効**。
- 影響範囲: pending（ヘッダ/プライバシー保留）に入ったページを「今後は記録する」と指定する導線が機能しない。利用者は追加が効いていることを前提に操作している。
- 測定方法: pending パネルからの追加後、`chrome.storage.local` に `'domainWhitelist'` キーが作られず、`domain_whitelist` に反映されること。追加したドメインの再訪問で録画判定が「許可」になること。

## 優先度
- 順位: Wave 1（即着手）
- RICEスコア: 5700（Reach=300 / Impact=0.4 / Confidence=0.95 / Effort=0.05人月）
  - Reach 300: whitelist を使う利用者（pending 導線の利用者）
  - Impact 0.4: 機能が完全に沈黙（データ完全性ではなく機能不全）。利用者が誤認したまま運用する
  - Confidence 0.95: 原因（キー名の literal 直書き）と修正箇所が 1 関数に特定済み
  - Effort 0.05: 2 行の書き換え＋回帰テスト
- 根拠: 最小 Effort で実在のユーザー影響を解消。他 6 ハードニング（29-14）と束ねると埋没するため分離した

## BDD受け入れシナリオ

```gherkin
Scenario: pending パネルのドメイン追加が正キーに書かれる
  Given pending パネルに example.com のページがある
  When 「ホワイトリストへ追加（ドメイン）」を実行する
  Then StorageKeys.DOMAIN_WHITELIST（'domain_whitelist'）に "example.com" が追加される
  And orphan キー 'domainWhitelist' は作られない

Scenario: pending パネルのパス追加が正キーに書かれる
  Given pending パネルに https://example.com/private-path のページがある
  When 「ホワイトリストへ追加（パス）」を実行する
  Then 'domain_whitelist' に該当パスの正規表現エントリが追加される

Scenario: 追加後に録画判定で許可される
  Given pending パネルから example.com をホワイトリスト追加した
  When example.com を再訪問し録画判定が走る
  Then ドメインフィルタで「許可」となり記録される

Scenario: 既存の正キーの値は失われない
  Given 'domain_whitelist' に既存エントリ ["foo.example"] がある
  When pending パネルから "bar.example" を追加する
  Then 'domain_whitelist' が ["foo.example", "bar.example"] になる（既存値を読んでから追記）
```

## 受け入れ基準
- [ ] `src/popup/pendingPages.ts` の `addDomainsOrPathsToWhitelist` が、読み込み・書き込みとも `StorageKeys.DOMAIN_WHITELIST`（`src/utils/storage/types.ts` 参照）経由になっている（literal `'domainWhitelist'` を廃止）
- [ ] 可能なら `getSettings()` / `saveSettings()`（`src/utils/storage.ts`）または SettingsRepository パターンに合わせ、生の `chrome.storage.local` 直参照を避ける
- [ ] 既存の `domain_whitelist` の値を読んでから追記する（上書きしない）
- [ ] 既に orphan キー `'domainWhitelist'` に書かれたデータは廃棄でよい（利用者は追加が効いていない認識）。移行はしない旨をコード near にコメント
- [ ] 回帰テストで「正キーに書かれる」「orphan キーが作られない」「既存値が保持される」が検証されている（`src/popup/__tests__/main.test.ts` の該当テストが `domainWhitelist` を期待しているため、期待値を `domain_whitelist` に修正）
- [ ] `npm run type-check` と `npm run validate` が成功する

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- popup の pending パネル → ホワイトリスト追加 → 同一ドメインの再訪問で録画が許可されることを popup 操作で確認（実機能の回帰）

### 統合テスト
- `pendingPages` × storage モック: 追加操作で `domain_whitelist` に反映され、`domainFilter` の判定が変わること

### 単体テスト
- 更新: `src/popup/__tests__/main.test.ts:1714,1727` 付近（`domainWhitelist: []` / `domainWhitelist: expect.arrayContaining(['example.com'])`）を `domain_whitelist` に修正
- 新規: `addDomainsOrPathsToWhitelist` の直接テスト
  - ドメイン追加 / パス追加（正規表現エントリ生成）/ 既存値ありの追記 / 空配列の扱い

## 実装アプローチ
- **Outside-In**: 既存テストの期待値を正キーに変更して RED（現行実装は orphan キーに書くため落ちる）→ 実装修正で GREEN
- **Red-Green-Refactor**: 修正後、`StorageKeys` 経由でない literal キー書き込みを `rg "chrome\.storage\.local\.(get|set)\(['\"]" src/` で棚卸し（将来の再発防止）

## 見積もり
0.5pt（要チームでの見積もり — 2 行の書き換え＋テスト期待値の修正＋直接テスト）

## 技術的考慮事項
- 依存関係: なし（Wave 1、他 PBI とファイル触接なし）
- テスタビリティ: `chrome.storage.local` のモックで完結
- 非機能要件: なし
- 注意: `src/dashboard/domainFilterTagUI.ts:65` の `getMessage('domainWhitelistDesc')` は i18n メッセージキーであって storage キーではない。混同しないこと

## 実装者向け注記

### 現状コードの確認
```bash
rg -n "domainWhitelist|domain_whitelist" src/popup/pendingPages.ts
rg -n "DOMAIN_WHITELIST" src/utils/storage/types.ts
rg -n "domainWhitelist" src/popup/__tests__/main.test.ts
```

現行の該当箇所（`src/popup/pendingPages.ts`）:
```ts
async function addDomainsOrPathsToWhitelist(urls: string[], type: 'domain' | 'path'): Promise<void> {
  const { domainWhitelist = [] } = await chrome.storage.local.get('domainWhitelist') as { domainWhitelist?: string[] };
  // ...
  await chrome.storage.local.set({ domainWhitelist: updatedList });
}
```

### 実装手順
1. `chrome.storage.local.get('domainWhitelist')` → `StorageKeys.DOMAIN_WHITELIST` 経由の読み込みに変更
2. `chrome.storage.local.set({ domainWhitelist: ... })` → `StorageKeys.DOMAIN_WHITELIST` キーへの書き込みに変更
3. `src/popup/__tests__/main.test.ts` の期待値を `domain_whitelist` に修正
4. `addDomainsOrPathsToWhitelist` の直接テストを追加
5. `npm run validate`

### 落とし穴
- `getSettings()` は API キー復号などを行うため、`domain_whitelist` の読み書きだけなら `StorageKeys` 経由の生 `chrome.storage.local` でも許容。ただし他の pending 系処理と整合を取ること
- `type: 'path'` は `^${escapeRegex(origin + pathname)}$` の正規表現文字列を生成する。この形式は既存の domain filter が解釈できる形か確認（`src/dashboard/settings/domainFilter.ts` の保存形式と一致させる）

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] pending パネルからのホワイトリスト追加が実機で有効になることを確認
