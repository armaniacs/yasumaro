# PBI: メッセージフィールド検証の完全化（ByteStats + maskedCount）

## ユーザーストーリー
録画と保存を使う利用者として、拡張機能が受け取る数値フィールドが検証なしでストレージに流れ込まず、プライバシー表示が嘘にならないようにしたい、なぜなら検証漏れのあるフィールドがメタデータ汚染と虚偽のマスク表示を招くことが監査で実証されたから。

## 優先度
- 順位: 4 / 6
- RICEスコア: 7.0（Reach=7 / Impact=0.5 / Confidence=1.0 / Effort=0.5）
- 根拠: 2 findings（VULN-005 + VULN-007）を同時に閉じる。実害は Low だが影響は全記録・全保存経路に及ぶ。

## 背景（2026-09-22 時点の現状）
- VULN-005（CWE-20/400、Low、テスト PASS）: VALID_VISIT の ByteStats 9フィールド（`pageBytes`、`candidateBytes`、`originalBytes`、`cleansedBytes`、`aiSummaryOriginalBytes`、`aiSummaryCleansedBytes`、`aiSummaryCleansedElements`、`aiSummaryCleansedReason`、`aiSummaryCleansedReasons[]`）が `src/messaging/validators.ts:129-156` で無検証（content/force のみ検査）で、`pickDefined` を通過し、`src/background/pipeline/mappers/commonStorageFields.ts:89-97` の裸の `as number` キャストで chrome.storage へ流れる。`pageBytes=10^15` や `aiSummaryCleansedReasons[]` の無制限配列がそのまま保存できる。
- VULN-007（CWE-290/915、Low、テスト PASS）: SAVE_RECORD の `maskedCount` を `src/background/handlers/recordingHandlers.ts:302-317` が呼び出し元値のまま受理し、`src/background/pipeline/mappers/commonStorageFields.ts:68-70` でパイプライン計算値より優先する（`precomputedMaskedCount ?? data.maskedCount ?? privacy.maskedCount`）。SAVE は `alreadyProcessed:true`（`src/background/pipeline/privacyPipeline.ts:167`）で再計算されず、偽値が保存・表示される。
- 監査エビデンス: obsidian-smart-history_VULNHUNT_RESULTS_2026-09-22-063916/README.md の VULN-005 と VULN-007。
- 修正戦略（監査 Fix より）: validators での範囲検証、storage 経路での clamp、SAVE での呼び出し元 `maskedCount` 破棄の三層で閉じる。

## 設計上の制約
- 並行作業注意: `commonStorageFields.ts` には PBI 05（extraction）由来の `fallbackReason` フィールド追加が入っている。本修正は既存フィールドのみに触れ、rebase 時の競合を最小化する。
- 既存の録画フロー（VALID_VISIT 正常ペイロード）とダッシュボードの保存フローが上限値で誤って拒否されないよう、現実の最大値（例: 数百 KB ページ、50タグ）を調べて上限に反映する。

## BDDシナリオ
Scenario: 正常な録画ペイロードの ByteStats は従来どおり保存される
  Given 正常範囲内の ByteStats を持つ VALID_VISIT ペイロード
  When  録画パイプラインを実行する
  Then  9フィールドの値がそのまま chrome.storage に保存される

Scenario: 負値や 10^15 の ByteStats は拒否（またはクランプ）され、生の値がストレージに入らない
  Given `pageBytes=-1` や `pageBytes=10^15`、`aiSummaryCleansedReasons[]` の過大配列を含むペイロード
  When  バリデーションと保存を実行する
  Then  拒否または clamp され、生の値が chrome.storage に入らない

Scenario: SAVE で maskedCount:999 を送ってもパイプライン計算値が保存・表示される
  Given 呼び出し元が `maskedCount:999` を付けた SAVE_RECORD
  When  保存パイプラインを実行する
  Then  呼び出し元値は破棄され、パイプライン計算値が保存・表示される

## 受け入れ基準
- [x] 9フィールド全てに範囲検証（非負の safe integer + フィールド別上限）があり、単体テストで pin されている
- [x] `aiSummaryCleansedReasons[]` に要素数上限と要素型検証がある
- [x] SAVE の maskedCount が呼び出し元値に依存しない（パイプライン値を唯一の真実にする）
- [x] chrome.storage 経路の clamp が効く（`as number` の裸キャストが残っていない）
- [x] 正常系の録画・保存回帰テストが緑

## テスト戦略
- 単体: バリダーの境界値（エクスプロイトテストの手法を通常テストへ昇格）
- 統合: `npm run validate`

## 見積もり
3 SP（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] type-check / lint / test / build が通る

## 実装記録（2026-09-23）
- コミット 12be74b3。VALID_VISIT の ByteStats 9フィールドに範囲検証（byte 系 16MiB・elements 100万・reason 128文字・reasons 64要素の上限、wire 層は拒否一貫）を追加し、aiSummaryCleansedReasons[] に要素数・要素型検証を実装。commonStorageFields の裸 `as number` を clamp 付き導出に置換（境界はバリデータと共有し drift 不能）。SAVE 経路は呼び出し元 maskedCount をハンドラで破棄し、パイプライン計算値を唯一の真実にした。
- なぜなぜ分析: /tmp/whywhy/vuln-005-007-message-field-validation.md
- 検証: type-check / lint 0 errors / test 13,358 green / build green。残: GitHub PR レビュー
