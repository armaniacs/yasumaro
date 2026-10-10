# PBI: `privacy_mode` を union 型にして未知値を fail-closed（`masked_cloud`）へ倒す

- 種別: fix
- RICE: 7.2（R4 × I3 × C0.9 / E1.5）
- 依存: なし（PBI-01 / PBI-03 とファイル非重複で並列可）
- バッチ: checking-team-1010
- 台帳: `pbi/2026-10-11-00-backlog-checking-team-1010.md`
- 出所: checking-team レビュー（`dev-docs/archived/plans/2026-10-10-2320-review-1007z.md`）Compliance & Privacy Guard Medium

## ユーザーストーリー

プライバシー重視のユーザーとして、設定バックアップの取り込みや破損・旧版の値で `privacy_mode` が壊れていても、PII マスクが無効化された状態でクラウド AI に本文が送られてほしくない。なぜなら現状は未知値で「マスク無効 + クラウド送信」に倒れる fail-open だから。

## 背景（現状・証拠）

- `src/background/privacyPipeline.ts:185-186` — `useMasking` は `full_pipeline | masked_cloud | local_only` の 3 値のみ true、`useCloudAi` は `mode !== 'local_only'`。
- 型は `src/utils/storage/types.ts:338` の `[StorageKeys.PRIVACY_MODE]: string`（union でない）。
- 設定インポートは構造検証のみで値域検証が無い（`src/utils/settingsExportImport.ts:455` の `validateExportData`、`src/dashboard/exportImport.ts:200-201`）。
- したがって `privacy_mode` が既知3値以外になると、UI 上は「Cloud Only」表示（`src/popup/statusPanel.ts:39` のフォールバック）になりつつ、PII マスクを一切せず生のページ本文がクラウド AI へ送られる。
- 本ブランチが修正した save 経路のマスク（`src/background/recordRequestBuilder.ts:73` から `alreadyProcessed: true` を削除）と同じゲートで、既定（`masked_cloud`）を外れた瞬間にサイレントに保護が落ちる構造。

## BDD 受け入れシナリオ

```gherkin
Scenario: 未知の privacy_mode は既定値へ fail-closed する
  Given 保存済み privacy_mode が既知3値のいずれでもない
  When PrivacyPipeline が設定を解決する
  Then useMasking が true になり、useCloudAi が既定の masked_cloud と同じ判定になる
  And 生のページ本文がクラウド AI へ送られない

Scenario: 既知の local_only は従来どおりクラウド送信しない
  Given privacy_mode が "local_only" である
  When PrivacyPipeline が設定を解決する
  Then useCloudAi が false である

Scenario: 不正な値の設定インポートを拒否する
  Given インポート JSON の privacy_mode が既知3値以外である
  When validateExportData を実行する
  Then インポートが検証エラーとして拒否される
```

## 受け入れ基準

- [ ] `PRIVACY_MODE` を union 型（`full_pipeline | masked_cloud | local_only`）にし、`src/utils/storage/types.ts` の宣言を更新する
- [ ] 読み出し時に既知値以外を `masked_cloud` へ倒す正規化関数を 1 箇所に置き、`privacyPipeline.ts` はそれを使う（各所で生の string 比較をしない）
- [ ] `src/utils/settingsExportImport.ts` の `validateExportData` に `privacy_mode` の値域検証を追加する
- [ ] `src/dashboard/exportImport.ts` の取り込み経路でも同じ検証を通す
- [ ] `src/popup/statusPanel.ts:39` のフォールバック表示が「正規化後の値」と一致する（未知値で実態と違う表示にならない）
- [ ] 未知値・壊れた値・旧版の値それぞれで「マスク有効 + クラウド判定が既定どおり」になることをテストで固定する
- [ ] 既知3値の挙動が変わっていないことをテストで固定する
- [ ] `src/background/privacyPipeline.ts:106,182,185` の `alreadyProcessed: true` マスク無効化スイッチについて、source policy から到達不能であることと「テスト専用」であることを明示する（削除するか doc コメントで明記）
- [ ] `npm run validate` が green

## テスト戦略

- unit: 正規化関数の境界値（3値・未知値・`undefined`・`null`・空文字・非文字列）
- unit: `PrivacyPipeline` が未知値で `useMasking=true` / `useCloudAi=true`（既定相当）になること、`local_only` で `useCloudAi=false` のままであること
- unit: `validateExportData` が不正な `privacy_mode` を拒否し、正当な 3 値を受け入れること
- 回帰: `privacyPipeline` / `privacyPipeline-pii-leak` / `exportImport` 系テストが green
- 統合: save 経路（`recordRequestBuilder`）で未知値でもマスクが適用されること

## 見積もり

1.5 SP（型 + 正規化 0.5 + インポート検証 0.5 + テスト 0.5）

## 技術的考慮事項

- fail-closed の方向は「より保護が強い側」＝ `masked_cloud`。`full_pipeline` は既定ではないため、未知値の既定は `masked_cloud` に合わせる
- 既存ユーザーの保存値は 3 値のいずれかである想定だが、壊れた値でも起動を止めない（throw せずに正規化する）
- 設定のスキーマバージョンは上げない（読み出し時の正規化で吸収する）

## 実装者向け注記

### 実装手順

1. 失敗するテストを先に書く（未知値で `useMasking` が false になることを pin する Red）
2. `types.ts` の union 化 + 正規化関数を追加
3. `privacyPipeline.ts` を正規化関数経由に変更
4. インポート検証を追加
5. `npm run validate`

### 落とし穴

- union 化すると `privacy_mode` を string として扱っている箇所が型エラーになる。`grep -rn "privacy_mode\|PRIVACY_MODE"` で呼び出し元を洗ってから直す
- `statusPanel.ts` のフォールバックを消すと表示が空になる。正規化後の値でラベルを選ぶようにする
- テストで実時間待ちを入れない

## Definition of Done

- [ ] 未知の `privacy_mode` でマスクが有効なままであることをテストで確認
- [ ] インポート経路で不正値が拒否されることをテストで確認
- [ ] `npm run validate` が green
- [ ] 検証結果（コマンドと結果）を PBI に記録し、アーカイブする
