# PBI: ページ本文(content)を PII マスク済みで保存し、初回同意で 7 日保持

## ユーザーストーリー
プライバシーを重視するユーザーとして、閲覧ページの本文(content)が SQLite に保存される際に PII サニタイザを通過した状態でのみ保存され、かつ自分の同意を得た上で最大 7 日間だけ保持されることを望む。なぜなら生のページ全文（医療・金融・認証情報を含みうる）を無期限に平文保存する現状はデータ最小化原則に反し、マスキングを有効にしていても content には適用されていないから。

## ビジネス価値
- GDPR/CCPA のデータ最小化・透明性原則への準拠を強化し、プライバシーリスクを低減する
- 既存の summary と同じ PII マスキング品質を content にも適用し、一貫性を保つ
- 初回同意によって「何を保存するか」をユーザーが明示的に選択できる

## 既実装確認（Phase 0）
- `grep -rn "sanitizeRegex" src/background` → `processPrivacyPipelineStep.ts` / `recordingLogic.ts` で summary に適用済み。content への適用は未実施
- `src/background/pipeline/RecordingPipeline.ts:180` は `content: data.content || null` と生のまま格納（未サニタイズ）
- `src/background/dailyPurgeHandler.ts` は既に `CONTENT_RETENTION_DAYS` / `CONTENT_MAX_RECORDS` を見て `purgeContent()` を呼ぶ基盤が実装済み（デフォルト `null` = 無制限）
- 関連 PBI `2026-07-07-03-feat-sqlite-content-retention.md` が content 保持ポリシー（パージ機構・ダッシュボード UI）をカバー済み → **本 PBI はその上に「保存時サニタイズ＋同意ゲート＋7 日デフォルト」を追加する新スライス**。保持基盤の再実装は不要

## BDD受け入れシナリオ

```gherkin
Scenario: 同意済みでマスキング有効の場合、content は PII マスク済みで保存される
  Given ユーザーが初回セットアップで「本文をローカル保存（マスク済・7 日）」に同意している
  And 閲覧ページの本文にメールアドレス "user@example.com" が含まれている
  When 録画パイプラインが content を保存する
  Then browsing_logs の content に "user@example.com" は含まれず "[MASKED:email]" に置換されている
  And 本文そのものは 7 日後に NULL になる

Scenario: 同意していない場合、content は保存されない
  Given ユーザーが本文保存に同意していない
  When 録画パイプラインが content を保存しようとする
  Then browsing_logs の content は NULL のままである

Scenario: 7 日経過した content は自動で NULL になる
  Given ユーザーが同意済みで、8 日前の content を持つエントリが存在する
  And CONTENT_RETENTION_DAYS のデフォルトが 7 に設定されている
  When 日次パージ処理が実行される
  Then 8 日前のエントリの content が NULL になる
```

## 受け入れ基準
- [ ] `RecordingPipeline.ts` で `content` が `sanitizeRegex(data.content, { skipSizeLimit: true })` の結果（マスク済みテキスト）として保存される
- [ ] 本文保存は `CONTENT_STORAGE_ENABLED` が true（同意済み）の場合のみ行われ、それ以外は `null`
- [ ] `CONTENT_RETENTION_DAYS` のデフォルトが `7` に変更される（既存パージ基盤がそのまま適用）
- [ ] 初回セットアップ／プライバシーポリシー更新時に、本文保存の同意チェックボックスが表示され `CONTENT_STORAGE_ENABLED` とバインドされる
- [ ] サニタイズ失敗時（入力超過等）は content を `null` として保存（クラッシュしない）
- [ ] 既存の `sanitizeRegex` 単体テストがパスする

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 見送り（プライバシー同意モーダルの E2E fixture なし）

### 統合テスト
- `RecordingPipeline` が `sanitizeRegex` を呼び出し、マスク済み content を `saveMetadataStep` 経由で保存する一連の流れ
- `dailyPurgeHandler` が `CONTENT_RETENTION_DAYS=7` の下で 7 日超の content を NULL にする

### 単体テスト
- `RecordingPipeline`: `CONTENT_STORAGE_ENABLED=false` → content=null；`true` → マスク済みテキスト
- `sanitizeRegex` の content 入力（64KB 超 → `skipSizeLimit:true` で 512KB 上限）の境界値
- プライバシー同意モーダルのチェックボックスが `CONTENT_STORAGE_ENABLED` を正しく読み書きする

## 実装アプローチ
- **Outside-In**: 統合テスト（同意→マスク済み保存）を失敗させ、単体から実装してグリーン
- **依存**: PBI `2026-07-07-03` のパージ基盤を再利用。新規実装はサニタイズ適用＋同意ゲート＋デフォルト変更のみ

## 見積もり
5 pt（サニタイズ適用は既存関数再利用、同意 UI が主な工数）

## 技術的考慮事項
- 依存関係: PBI `2026-07-07-03-feat-sqlite-content-retention`（パージ基盤・ダッシュボード UI）が先行
- テスタビリティ: `sanitizeRegex` は async；パイプラインステップは既存のモック構成を流用
- 非機能要件: content 全文は 64KB を超える場合があり、`skipSizeLimit:true`（上限 512KB）を使用。それでも超える場合はマスク失敗として `null` 保存

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "content:" src/background/pipeline/RecordingPipeline.ts
# → 180: content: data.content || null  （生のまま）
grep -rn "CONTENT_RETENTION_DAYS\|CONTENT_STORAGE" src/utils/storage/
grep -rn "sanitizeRegex" src/background/pipeline/steps/processPrivacyPipelineStep.ts
# → summary に適用済み（参考実装）
grep -n "purgeContent" src/background/dailyPurgeHandler.ts
# → CONTENT_RETENTION_DAYS / CONTENT_MAX_RECORDS を見て呼び出し済み
```

### 実装手順
1. `src/utils/storage/types.ts` に `CONTENT_STORAGE_ENABLED: 'content_storage_enabled'` を追加（既存の `CONTENT_RETENTION_DAYS` 等は存在）
2. `src/utils/storage/defaults.ts` に `CONTENT_STORAGE_ENABLED: false` と `CONTENT_RETENTION_DAYS: 7`（既存 null を上書き）を追加
3. `RecordingPipeline.ts` で `import { sanitizeRegex } from '../../utils/piiSanitizer.js';` し、`content` を以下のように計算:
   ```ts
   content: contentStorageEnabled
     ? (await sanitizeRegex(data.content ?? '', { skipSizeLimit: true })).text || null
     : null,
   ```
4. プライバシー同意モーダル（`src/popup/privacyConsentController.ts` / `privacyConsent.ts`）に「本文をローカル保存（マスク済・7 日）」チェックボックスを追加し、`CONTENT_STORAGE_ENABLED` をバインド。初回表示と `isPolicyVersionChanged()` 時に表示
5. テスト追加

### 落とし穴
- `sanitizeRegex` は async かつ `text` を `SanitizeResult.text` に持つ。`content` には `.text` を格納すること（オブジェクトごと入れない）
- 入力超過時は `error` 付きで元 text が返る場合がある。`null` にフォールバックするか、許容するかは製品判断（推奨: null）
- デフォルト変更（`null`→`7`）は既存ユーザーの動作を変える。CHANGELOG に明記

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] 同意なしでは content が保存されない
- [ ] デフォルト 7 日で content がパージされる（既存基盤利用）
- [ ] コードレビュー完了
- [ ] CHANGELOG.md に記載
