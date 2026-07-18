# PBI: ログID生成のMath.randomフォールバックをCSPRNGに置き換え

## ユーザーストーリー
開発チームとして、ログエントリID生成のフォールバック処理が暗号論的に安全な乱数を使ってほしい、なぜなら現状の `Math.random()` フォールバックはCSPRNGではなく、予測可能性のリスクがあるから

## ビジネス価値
- ログエントリIDの予測可能性を排除し、セキュリティのベストプラクティスに準拠
- `crypto.randomUUID()` が利用不可な稀なケース（環境制約）でも安全性を維持

## 実装者向け注記（フェーズ0の既実装確認結果）

Read で確認済み:
- `src/utils/logger.ts:425` 付近: `id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : Math.random().toString(36).substring(2)`
- ID形式に依存する他コードは存在しない（side-effects.md M2判定で確認済み: 「二次的フォールバックパスのみ」）ため、ID形式（文字列長・文字種）を変更しても後方互換の問題は生じない

```bash
# 実装前の再確認コマンド
grep -n "Math.random" src/utils/logger.ts
grep -rn "\.id\b.*logEntry\|LogEntry.*id" src/ --include="*.ts" | grep -v __tests__
```

## BDD受け入れシナリオ

```gherkin
Scenario: crypto.randomUUIDが利用可能な環境では従来通り動作する
  Given crypto.randomUUID関数が利用可能な環境
  When ログエントリを作成する
  Then crypto.randomUUID()で生成されたUUID形式のIDが付与される

Scenario: crypto.randomUUIDが利用不可な環境でもCSPRNGベースのIDが生成される
  Given crypto.randomUUIDが利用不可だがcrypto.getRandomValuesは利用可能な環境
  When ログエントリを作成する
  Then crypto.getRandomValues()を用いた予測不可能なIDが生成される
  And 生成されたIDはMath.random()を経由しない
```

## 受け入れ基準
- [ ] `src/utils/logger.ts:425` のフォールバックを `crypto.getRandomValues()` ベースの実装に置き換え
- [ ] 実装例（親レポートより）:
  ```ts
  const arr = new Uint32Array(2);
  crypto.getRandomValues(arr);
  return arr[0].toString(36) + arr[1].toString(36);
  ```
- [ ] 既存のログ機能（フラッシュ、フィルタリング等）が引き続き正常動作する

## テスト戦略（t_wadaスタイル）

### E2E（最小限）
- 不要

### 統合テスト
- 既存の logger 関連テストがあればそのままパスすることを確認

### 単体テスト
- フォールバック関数を切り出せる場合、`crypto.randomUUID` が `undefined` の状況をモックし、`Math.random` が呼ばれないこと・生成されたIDが期待形式（文字列、非空）であることを検証
- 通常経路（`crypto.randomUUID` 利用可能時）が従来通り動作することを確認

## 実装アプローチ
- **Red**: `crypto.randomUUID` 未定義時に `Math.random` が呼ばれないことを検証する単体テストを先に書き、現状の実装でRedになることを確認
- **Green**: `crypto.getRandomValues()` ベースの実装に置き換え

## 見積もり
1pt（30分〜1時間）

## 技術的考慮事項
- 依存関係: なし（Web Crypto APIは既存のjest.setup.tsで `@peculiar/webcrypto` ポリフィル済み）
- テスタビリティ: `crypto.randomUUID` を一時的に `undefined` にするモックで容易に再現可能
- 非機能要件: セキュリティ（CSPRNG使用）

## 落とし穴
- テスト環境（jsdom + `@peculiar/webcrypto`）で `crypto.getRandomValues` が正しく動作するか確認すること（`jest.setup.ts` の `Object.defineProperty(global, 'crypto', ...)` 設定に依存）

## Definition of Done
- [ ] `Math.random()` フォールバックが `crypto.getRandomValues()` ベースに置き換わっている
- [ ] 単体テストが追加されパスする
- [ ] `npm run type-check` / `npm test` が成功
- [ ] コードレビュー完了
