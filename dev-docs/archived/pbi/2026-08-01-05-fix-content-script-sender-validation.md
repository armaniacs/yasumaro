# PBI: コンテンツスクリプトからの VALID_VISIT メッセージ検証を強化する

## ユーザーストーリー
ユーザーとして、攻撃者ページが勝手に自動記録をトリガーして AI コストを消費したり、Obsidian に不要なコンテンツを書き込んだりできないようにしたい。

## ビジネス価値
- 不意な AI 要約コストを防ぐ
- 攻撃者制御コンテンツのボールト書込を防ぐ
- 自動記録の信頼性を向上

## BDD受け入れシナリオ

```gherkin
Scenario: VALID_VISIT の送信元を厳密に検証する
  Given コンテンツスクリプトから VALID_VISIT が届く
  When service-worker がメッセージを処理する
  Then sender.url が http(s) スキームであることを検証する
  And sender.tab.url と整合することを確認する

Scenario: 同一 URL への連続 VALID_VISIT をレート制限する
  Given 攻撃者ページが短時間に多数の VALID_VISIT を送信する
  When 2件目以降が届く
  Then レート制限により無視またはブロックされる

Scenario: プログラムスクロールだけで記録されない
  Given ページが自動スクロールする
  When スクロール深度が 50% を超えても
  Then 人間の閲覧と判断できるまで記録は保留される
```

## 受け入れ基準
- [ ] `CONTENT_SCRIPT_ONLY_TYPES` の検証に `sender.url` スキームチェックを追加
- [ ] `VALID_VISIT` にレート制限を追加
- [ ] 自動スクロールのみでのトリガーを抑制する仕組み（オプション：スクロールイベントの `isTrusted` 判定等）
- [ ] `sender.tab.title`/`url` は信頼済み情報として扱うが、content は引き続きサニタイズ対象

## テスト戦略（t_wadaスタイル）

### 統合テスト
- `createValidVisitHandler` が異常な sender を拒否すること
- レート制限が機能すること

### 単体テスト
- sender 検証ロジックの境界値テスト
- レート制限カウンタのテスト

## 実装アプローチ
- **Outside-In**: `service-worker.ts` のメッセージゲートから強化
- **Red-Green-Refactor**: 異常 sender のテストを先に書く

## 見積もり
2pt

## 技術的考慮事項
- `sender.url` はコンテンツスクリプトのファイル URL になる場合がある
- `isTrusted` はブラウザ API のみ設定可能

## 実装者向け注記

### 現状コードの確認
```bash
grep -n "CONTENT_SCRIPT_ONLY_TYPES\|createValidVisitHandler" src/background/ -r
```

### 実装手順
1. `service-worker.ts:496-501` に `sender.url` スキーム検証を追加
2. `createValidVisitHandler` にレート制限を追加
3. `extractor.ts` でスクロールイベントの信頼性を考慮

### 落とし穴
- 厳密にしすぎると正常なコンテンツスクリプトまで拒否する
- `sender.tab.url` と `sender.url` の整合性は常に成立するとは限らない

## 関連情報（graphify 調査結果）
- **関連ファイル**: `src/background/service-worker.ts`, `src/background/handlers/messageHandlers.ts`, `src/background/messageTypes.ts`, `src/content/extractor.ts`, `src/background/recordingLogic.ts`, `src/background/pipeline/RecordingPipeline.ts`
- **関連する過去PBI**:
  - `2026-07-25-21-fix-ai-call-deduplication`（AI 要約 in-flight 重複排除）
  - `2026-07-25-22-fix-duplicate-check-race-condition`（RecordingPipeline URL Mutex 追加）
- **補足**: `extractor.ts:633-653` の `scheduleNextCheck`/`updateMaxScroll` 経由でプログラムスクロールが条件を満たす。人間の閲覧判定強化は本PBIのオプション要件。

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] リファクタリング完了
