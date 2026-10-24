# PBI: ObsidianClient設定読みのseam化

## ユーザーストーリー

保守担当者として、設定の出所をseamに通したい。なぜならmutex/sleepは注入可なのに設定取得だけglobal直結で、テストと将来callerが差替えられないから。

## 優先度

- 順位: 08 / 全8件
- RICE スコア: 3.2（Reach = 4 / Impact = 1 / Confidence = 0.8 / Effort = 1.0人日）
- 根拠: NN07 と同点のため、mock削減の NN07 を先に置く。mutex自体は裁定済みで触れない。

## ビジネス価値

テストと将来callerが同じseamで設定を差替えられ、出所・写像変更がinterface背後に集まる。

## BDD受け入れシナリオ

```gherkin
Scenario: 設定がseam経由で読まれる
  Given 設定がある
  When 読む
  Then 変更前と同一に読める

Scenario: 差替えができる
  Given 差替え設定がある
  When 注入する
  Then それが使われる
```

## 受け入れ基準

- [x] 設定読みがconstructorのseam（reader注入、既定は現行読み）を通る
- [x] 失敗写像が共通知識に寄る
- [x] 既存テスト全緑

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし

### 統合テスト
- 接続フローテスト維持

### 単体テスト
- reader注入のtableテスト新規

## 実装アプローチ

- **Outside-In**: 注入の失敗テストを先に書き、赤を確認してから通す

## 見積もり

1pt（🟢低）

## 技術的考慮事項

- 依存関係: なし
- 非機能要件: 生産の振舞い不変。mutexは裁定済みのため触れない

## 変更点の概要

設定読みをseamに通し、失敗写像を共通知識に寄せる。

## 現状と問題（file:line 付き）

- `src/background/obsidianClient.ts:102-105` ― module級mutex共有既定値
- `src/background/obsidianClient.ts:187-197` ― mutex/sleep注入可・設定はglobal読み
- `src/background/compositionManifest.ts:91` ― 素構築の生産登録
- `src/background/obsidianClient.ts:138-175` ― 独自分岐の失敗写像
- `src/utils/httpFailureMessages.ts` ― 共通知識

## 変更の理由（depth・locality）

「設定の出所」だけseam外の未裁定点。通して集約する。

## 提案コード（骨子のみ）

```typescript
// constructorにreader注入（既定は現行global読み）。
// 失敗写像は共通知識に委譲する。
```

## 実装者向け注記

### 現状コードの確認

```bash
grep -n "getConfig\|mutex\|sleep" src/background/obsidianClient.ts | head -20
```

### 落とし穴

- mutexに触れない（裁定済み）
- 生産の振舞いを変えない（既定は現行読み）

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] 既存テスト全通過 + tableテスト新規通過
- [x] コードレビュー完了
- [x] `npm run validate` 通過
- [x] ドキュメント更新済み
