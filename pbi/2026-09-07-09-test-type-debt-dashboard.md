# PBI: テスト型債務返済 2/5 — dashboard（585 errors / 61 ファイル）

## ユーザーストーリー

yasumaroの開発者として、`src/dashboard` 配下のテスト（設定・履歴 UI・CS セキュリティテスト群）に型チェックの生のゲートが効いてほしい。なぜなら、型債務の中には将来の実バグの予兆が含まれるから（シリーズ共通の背景は `pbi/00-INDEX.md` の「2026-09-07 テスト型債務返済シリーズ」参照）。

## 分析: 本バッチのスコープ（実測 2026-09-07、インベントリ = testDir/type-check-baseline.json）

- スコープ: **`src/dashboard/**` の baseline エントリ** — 585 errors / 61 files
- 上位ファイル: `settings/__tests__/customPromptManager.test.ts`(150・シリーズ最大)・`historyEntryRow.test.ts`(52)・`cspSettings.test.ts`(52)・`settings/ublockImport/__tests__/uiRenderer.test.ts`(41)
- エラー内訳（ディレクトリ傾向）: 暗黙 any（TS7006 — コールバックのパラメータ型漏れ）、リテラル型不一致（TS2322 — `CustomPrompt[]` 等の型注釈漏れ）、null 安全性
- 依存なし・他バッチと並行可

## ビジネス価値

- ダッシュボード UI（XSS・CS セキュリティテスト含む）に型レベルの実害検知を導入する
- シリーズ最大の単一ファイル（customPromptManager.test.ts・150 件）を含む

## BDD受け入れシナリオ

```gherkin
Scenario: dashboard 配下の型エラーが 0 になる
  Given src/dashboard 配下の baseline エントリが全て返済されている
  When npm run type-check:test:raw を実行する
  Then 出力に src/dashboard 配下の error が 0 件である
  And 全 vitest がグリーン（実行時挙動不変）
```

## 受け入れ基準

- [ ] `src/dashboard/**` が baseline から消滅
- [ ] baseline.json から返済済みエントリを削除
- [ ] 型レベル修正のみでテストの実行時挙動を変えない（全 vitest グリーン維持・1 コミット = 1〜3 ファイル）
- [ ] 実装側の実バグ発見は別 PBI に切り出す（発見 0 件でもメモに記録）
- [ ] `npm run validate` が exit 0

## テスト戦略

### 単体テスト
- なし（既存テストの期待値を変えない）

### E2Eテスト
- なし

## 実装アプローチ

1. `type-check:test:raw` の出力を `src/dashboard` でフィルタし、エラー数の多い順に返済
2. 返済パターンは 2026-09-07-08 と同一（シリーズ共通 — INDEX セクション参照）
3. `customPromptManager.test.ts`（150 件）は段階分割を推奨: describe ブロック単位で複数コミットに分けてもよい（1コミット = 1〜3ファイルの原則はあくまで目安。同ファイル内の分割は 1 コミット = 1 describe ブロック相当）

## 見積もり

2pt（要チームでの見積もり）

## 技術的考慮事項

- **依存関係**: 2026-09-07-04（ベースラインゲート稼働中）が前提。08〜11 は互いに独立・並行可
- **テスタビリティ**: 1 ファイル返済のたび vitest run で挙動不変を確認
- **非機能要件**: 実行時挙動を変えないこと

## 実装者向け注記

### 現状コードの確認
```bash
npm run type-check:test:raw 2>&1 | grep "src/dashboard" | cut -d'(' -f1 | sort | uniq -c | sort -rn | head -10
```

### 落とし穴
- **`CustomPrompt[]` へのリテラル代入（TS2322 ×複数）**: リテラル側に不足フィールド（`createdAt`/`updatedAt` 等）を足すのが正解。`as CustomPrompt[]` で握りつぶさない
- **コールバックの暗黙 any**: `(p) => ...` → `(p: CustomPrompt) => ...`。テスト内ローカル型でよい
- **jsdom の `.value` 系**: `as HTMLInputElement` 等の要素キャスト

## Definition of Done

- [ ] `src/dashboard/**` が baseline から消滅
- [ ] `npm run validate` exit 0
- [ ] コードレビュー完了
- [ ] 実装バグ発見の有無をメモに記録
