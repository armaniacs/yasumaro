# PBI: 重複テストファイルと共通モックを整理する

**作成日**: 2026-08-07
**優先度**: 中
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟢なし（テスト構成変更。プロダクションコード・機能に影響なし）
**種別**: 🔧非機能追加（refactor）

---

## 背景

コードレビューで、同一モジュールを対象とするテストファイルが重複し、共通モックが繰り返し宣言されていることが発見された。

### 重複の詳細

**A. 同一モジュールを対象とする重複テストファイル**

| 対象モジュール | 重複ファイル | 行数 | 重複量 |
|---------------|-------------|------|--------|
| `ai/providers/GeminiProvider.ts` | `background/__tests__/GeminiProvider.test.ts` | 424 | ~120行重複 |
| 同上 | `ai/providers/__tests__/GeminiProvider.test.ts` | 198 | |
| `ai/providers/OpenAIProvider.ts` | `background/__tests__/OpenAIProvider.test.ts` | 376 | ~100行重複 |
| 同上 | `ai/providers/__tests__/OpenAIProvider.test.ts` | 168 | |
| `popup/settings/fieldValidation.ts` | `popup/__tests__/fieldValidation.test.ts` | 188 | ~180行重複（短い方は長い方のサブセット） |
| 同上 | `popup/settings/__tests__/fieldValidation.test.ts` | 889 | |

**B. 同一モジュールを対象とする複数ファイルテスト家族（共通モックの繰り返し）**

- `aiClient.test.ts` + `aiClient-timeout.test.ts` + `aiClient-priority-fallback.test.ts`
- `sqliteClient.test.ts` + 5変種
- `obsidianClient.test.ts` + 7変種
- `recordingLogic.test.ts` + 7変種

各変種が `vi.mock(...)` で `utils/fetch`, `utils/logger`, `utils/storage` 等を再宣言（~30-50行/家族）。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
ls -la src/background/__tests__/GeminiProvider.test.ts src/background/ai/providers/__tests__/GeminiProvider.test.ts
ls -la src/background/__tests__/OpenAIProvider.test.ts src/background/ai/providers/__tests__/OpenAIProvider.test.ts
ls -la src/popup/__tests__/fieldValidation.test.ts src/popup/settings/__tests__/fieldValidation.test.ts
grep -rn "vi.mock" src/background/__tests__/aiClient*.test.ts src/background/__tests__/sqliteClient*.test.ts | head
```

## 受け入れ基準（BDD）

```gherkin
Scenario: 各モジュールにテストファイルが1つだけ存在する
  Given GeminiProvider, OpenAIProvider, fieldValidation に複数テストがある状態
  When テストを実行する
  Then 各モジュールの正規テスト1ファイルが全ケースをカバーする

Scenario: 共通モックが共有フィクスチャから利用される
  Given 複数テストファイルが同一モックを繰り返す状態
  When テストセットアップを実行する
  Then 共有フィクスチャ/セットアップヘルパーからモックが注入される

Scenario: テスト削除後もカバレッジが維持される
  Given 重複テストファイルを削除した状態
  When テストカバレッジを測定する
  Then 正規テストで同等以上のカバレッジが確保される
```

## 受け入れ基準
- [ ] `GeminiProvider`, `OpenAIProvider`, `fieldValidation` の重複テストファイルを統合し、正規テスト1ファイルに集約（冗長ファイルを削除）
- [ ] 短い方が長い方のサブセットの場合は、長い方を正として残し短い方を削除（`fieldValidation`）
- [ ] 共通モック（`utils/fetch`, `utils/logger`, `utils/storage` 等）を `__tests__/__fixtures__/` または `setupFiles` ヘルパーに抽出
- [ ] `npm run test:coverage` でカバレッジ低下がないことを確認
- [ ] `npm run validate` が成功する

## テスト戦略

### 単体テスト
- 統合後の正規テストファイルの全ケース（スキーマ検証、成功/異常系）がパスすることを確認

### 回帰テスト
- `npm run test:coverage` で重複統合前後でカバレッジが同等であることを確認

## 実装アプローチ
- まず正規テストを特定 → 重複ファイルの独自ケースを正規にマージ → 重複ファイル削除 → 共通モックを抽出 → カバレッジ検証

## 見積もり
2pt（テスト統合 + 共通モック抽出 + カバレッジ検証）

## 技術的考慮事項
- 依存: 多数のテストファイル（プロダクションコード変更なし）
- テスト家族（`aiClient`, `sqliteClient`, `obsidianClient`, `recordingLogic`）は意図的な defense-in-depth の場合がある。完全統合せず、共通モック抽出のみを優先する判断も可
- `fieldValidation` は長い方（889行）が正。短い方（188行）はサブセットのため削除が安全

## 関連
- コードレビューレポート: 本セッションの重複レビュー（重複テストファイル）
- 対象ファイル: `src/background/__tests__/GeminiProvider.test.ts`, `src/background/__tests__/OpenAIProvider.test.ts`, `src/popup/__tests__/fieldValidation.test.ts` ほか
