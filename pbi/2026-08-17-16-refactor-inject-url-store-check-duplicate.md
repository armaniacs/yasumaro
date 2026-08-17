# PBI: checkDuplicateStep に URL store を注入する

## ユーザーストーリー
開発者として、`checkDuplicateStep` が `getSavedUrlsWithTimestamps` を直接インポートして chrome.storage.local にアクセスしている状態を解消したい。なぜなら、ステップが直接 Chrome API を呼ぶため、テスト時に chrome.storage をモックする必要が生じ、テストが複雑になるから。

## ビジネス価値
- テスト時に InMemoryUrlStore を注入できるようになる
- ステップが pure になり、テストが簡単になる
- URL store のアダプタが正当化される: ChromeStorageUrlStore（本番）、InMemoryUrlStore（テスト）

## BDD受け入れシナリオ

```gherkin
Scenario: 重複 URL の検出
  Given URL store に同じ日の URL が存在する
  When checkDuplicateStep が実行される
  Then DuplicateError がスローされる

Scenario: 重複なし
  Given URL store に同じ日の URL が存在しない
  When checkDuplicateStep が実行される
  Then context がそのまま返される

Scenario: テストでのモック
  Given InMemoryUrlStore が注入されている
  When checkDuplicateStep をテストする
  Then chrome.storage のモックが不要になる
```

## 受け入れ基準
- [ ] checkDuplicateStep が `getSavedUrlsWithTimestamps` を直接インポートしない
- [ ] StepDeps に URL store が含まれている
- [ ] テストが InMemoryUrlStore を使用している
- [ ] `npm run validate` が通過している

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 既存のE2Eシナリオがパスすることを確認

### 統合テスト
- 重複検出の統合テストを追加

### 単体テスト
- InMemoryUrlStore を使用した checkDuplicateStep の単体テストを追加

## 実装アプローチ
- **Outside-In**: URL store を StepDeps に追加し、checkDuplicateStep を修正
- **Red-Green-Refactor**: 修正後に型エラーが発生する場合のみ修正

## 見積もり
1ポイント

## 技術的考慮事項
- 依存関係: PBI-09（DI統一）が前提
- テスタビリティ: InMemoryUrlStore により改善
- リスク: 低（アダプタの追加のみ）

## 実装者向け注記

### 現状コードの確認
```bash
# getSavedUrlsWithTimestamps の使用箇所を確認
grep -n "getSavedUrlsWithTimestamps" src/background/pipeline/steps/checkDuplicateStep.ts
```

### 実装手順
1. StepDeps に URL store を追加
2. checkDuplicateStep が StepDeps.urlStore を使用するよう修正
3. createBackgroundServices.ts で URL store を注入
4. テストを InMemoryUrlStore 使用に更新

### 落とし穴
- URL store は getSavedUrlsWithTimestamps の戻り値（Map<string, number>）を返すインターフェースを持つ。テスト用の InMemoryUrlStore でも同じインターフェースを実装すること

## Definition of Done
- [ ] checkDuplicateStep が getSavedUrlsWithTimestamps を直接インポートしない
- [ ] テストが InMemoryUrlStore を使用している
- [ ] 全テストがパスしている
- [ ] コードレビュー完了
