# PBI: settings  backed repository seam の契約整備

## ユーザーストーリー

保守担当者として、新設3モジュールの storage 結合を差替可能にし、破損読込を可視化したい。なぜなら singleton 直 import では永続化テストが書けず、3様式の黙殺 catch では破損と空状態の区別が運用でつかないから。

## 優先度

- 順位: 09 / 全12件
- RICE スコア: 9.6（Reach = 6 / Impact = 2 / Confidence = 0.8 / Effort = 1.0人日）
- 根拠: NN02 と同ファイルに触れるため NN02 の後に実施する。NN08 と同点だが、NN08 が対象外 O1 の fix を待たせるため NN08 を先に置く。

## BDD 受け入れシナリオ

```gherkin
Scenario: 保存・読込が変更前と同一
  Given 正常な store がある
  When 差替可能な seam 経由で読む・書く
  Then 変更前と同一の結果が返る

Scenario: 破損読込の可視化
  Given store の読込が失敗する
  When 読む
  Then 既定値に縮退し、失敗がログに残る（画面は止めない）
```

## 受け入れ基準

- [x] 3モジュールが singleton 直 import でなく注入・factory 経由で repository を得る
- [x] 破損読込の catch に `logError`（または同等の seam）が入る
- [x] 永続化・破損のテストが新規追加される

## テスト戦略（t_wada スタイル）

- E2E: なし
- 統合: `InMemoryStorageAdapter`/`InMemoryStoragePort` 注入での保存・読込・破損テスト（3モジュール分）
- 単体: 既存 pure テストを維持

## 見積もり

1.5pt（🟡中）

## 技術的考慮事項

- 依存関係: NN02 の後に実施（同ファイルの型と seam を同時変更しない）
- テスタビリティ: `SettingsRepository.ts:67-70` の注入経路を使う
- 非機能要件: 本番の既定動作不変（singleton 解決を factory の既定にする）

## 変更点の概要

3モジュールの `settingsRepository` 直 import を注入可能にし、黙殺 catch にログを足す。

## 現状と問題（file:line 付き）

- `src/utils/storage/savedCollectionsRepository.ts:14,26-28` ― singleton 直 import + `catch{}` → `{}`
- `src/utils/storage/domainIntelRepository.ts:16,25-30` ― singleton 直 import + `catch{}` → `[]`/defaults
- `src/dashboard/onboardingBanner.ts:16,32-36` ― singleton 直 import + `catch{}` → `false`
- 呼び出し元実数: 3モジュール + 間接（`MessageRouter.ts:31`・panel 経路）
- テスト: `onboardingBanner.test.ts` は pure のみ。repository 系統合テストなし。破損読込テストは3件ともなし
- 前回 PBI 2026-10-20-19（テスト容易性）と同一主題の残差（10-23 新設分）

## 変更の理由（副作用の分離・エラーハンドリング）

差替性の欠如は永続化テストの欠落（現状3件ともなし）を招き、黙殺 catch は破損の不可視化を招く。同一 seam・同一ファイルの整理であり、束ねても変更理由（seam の契約）は同一。

## 提案コード（骨子のみ）

```typescript
// 案: factory 既定 + 任意注入（既存の SettingsReader 受けと同形）
export async function getSavedCollections(repo: SettingsReader = settingsRepository): Promise<...>;
// catch 内: void logError('[Repository] read failed', { error: errorMessage(e) }, ErrorCode.STORAGE_ERROR, '...');
// onboardingBanner 側も同形（既存 tagsPanel.ts:29 の SettingsReader 既定値パターンを参照）
```

## 実装者向け注記

```bash
grep -rn "from './SettingsRepository.js'\|from '../utils/storage/SettingsRepository.js'" src/ --include='*.ts' | grep -v __tests__
```

- `logError` の ErrorCode は既存の STORAGE 系コードを確認して選ぶ（新設しない）
- onboarding 側の dismiss 失敗時も画面を止めない（現行の縮退を維持）

## Definition of Done

- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] 既存テスト全通過 + 注入・破損テスト新規通過
- [ ] `npm run validate` 通過
- [x] ドキュメント更新済み
