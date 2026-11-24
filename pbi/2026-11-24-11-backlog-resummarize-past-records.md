# PBI: 過去の記録をまとめて要約し直す

## ユーザーストーリー
AI プロバイダーや要約プロンプトを変えた利用者として、過去の記録を新しい設定でまとめて要約し直したい、なぜなら設定を変えたあとも古い記録には以前の品質・書式の要約が残り、履歴の中で要約の質がばらばらになるから。

## 優先度
- 順位: 10/12
- RICE スコア: 0.8(Reach 5 × Impact 1 × Confidence 0.8 ÷ Effort 5 = 0.8)
  - Reach 5: プロバイダーやプロンプトを変えた利用者に限られるが、長く使うほど該当しやすい
  - Impact 1: 既存の要約が読めなくなるわけではなく、品質の揃えに留まる
  - Confidence 0.8: 記録 1 件の要約し直し(REGENERATE_SUMMARY)が既にあり、一括化の道筋は見えている
  - Effort 5: 対象の選択 UI、一括実行の進捗と中断、レート制限の扱い
- 根拠: 1 件ずつの要約し直しで当面は代替できる。一括化は AI 送信量が一度に増えるため、送信の方針と費用の見せ方を固めてから着手する

## 再検討トリガー
以下のすべてを満たしたら着手を検討する。
- 正式版のリリース後であること
- 既定のプロバイダーまたは既定プロンプトの変更を出荷し、既存の利用者の要約と新しい要約の差が問題になっている
- 1 件ずつの要約し直しを繰り返している、または一括化を求める要望が届いている

## ビジネス価値
- 設定を変えたあとの履歴で、要約の品質と書式が揃う
- 古いプロバイダー(退役したモデルなど)で作った要約を、手作業なしで更新できる
- 測定方法: 選んだ記録のうち、送信が許可されたものだけが新しい設定で要約され、許可されないものは理由付きで除外されること

## BDD受け入れシナリオ

```gherkin
Scenario: 選んだ記録が新しい設定で要約し直される
  Given 利用者が要約プロンプトを変更している
  And   履歴で 3 件の記録を選んでいる
  When  「選んだ記録を要約し直す」を実行する
  Then  3 件の要約が新しいプロンプトで作られた要約に置き換わる
  And   進捗が「3 件中 3 件完了」と表示される

Scenario: AI 送信を許可していないドメインの記録は送らない
  Given 「bank.example」のドメイン別 AI 送信政策が「送信しない」になっている
  And   選んだ記録に「https://bank.example/statement」が含まれる
  When  一括の要約し直しを実行する
  Then  その記録は AI に送られない
  And   結果一覧に「ドメインの送信政策により除外」と理由が表示される
  And   その記録の既存の要約は変更されない

Scenario: 送信前に PII がマスクされる
  Given 本文にメールアドレスを含む記録を選んでいる
  When  一括の要約し直しを実行する
  Then  AI に送られる本文ではメールアドレスがマスクされている
```

## 受け入れ基準
- [ ] 一括の要約し直しは、1 件ずつの要約し直しと同じ記録パイプラインを通る(プライバシー判定・ドメイン別 AI 送信政策・PII マスクを迂回しない)
- [ ] 送信政策で除外された記録は AI に送られず、既存の要約も変わらず、理由が結果に残る
- [ ] 実行前に対象件数と、AI に送る見込みの件数が表示される
- [ ] 実行中に中断でき、中断までに完了した分は保存される
- [ ] AI の失敗(`ai_failed`)は記録ごとに報告され、既存の要約を上書きしない
- [ ] プロバイダーのレート制限を超えない間隔で送る

## テスト戦略(t_wadaスタイル)

### E2Eテスト
- 履歴パネルで複数の記録を選び、一括の要約し直しを実行して要約が置き換わること(AI はスタブ)

### 統合テスト
- 送信政策が「送信しない」のドメインの記録が、AI クライアントに渡らないこと
- AI クライアントに渡る本文で PII がマスクされていること
- 中断したとき、未処理の記録が変更されないこと

### 単体テスト
- 対象の振り分け(送信可・政策で除外・URL 不正)
- 進捗の集計と結果の理由コード

## 実装アプローチ
- **Outside-In**: 「政策で除外された記録は AI に渡らない」統合テストを最初に書く。一括化でプライバシーの経路が抜けることが最大の危険なので、そこから固める
- **Red-Green-Refactor**: 1 件の要約し直しの処理を繰り返す形から始め、共通化は動いてから行う

## 見積もり
5 ストーリーポイント(要チームでの見積もり)

## 技術的考慮事項
- 依存関係: REGENERATE_SUMMARY の既存経路、レート制限
- テスタビリティ: 本文の取得(タブを開く)と AI 呼び出しは依存注入済みで、スタブに差し替えられる
- 非機能要件: 一度に多数のタブを開かない(同時実行数を絞る)。AI 送信の監査ログに一括実行の分も記録される

## 実装者向け注記

### 最初にやるスパイク
1. 本文の入手元を決める。調べた結果は次のとおり
   - SQLite の `browsing_logs` に `content` 列はあるが、保存されるのは本文保存の設定(`content_storage_enabled`)が有効な場合だけ。既定で本文が残っているとは限らない
   - 既存の 1 件の要約し直しは、保存済み本文を使わず、URL を裏のタブで開き直して本文を再抽出している(`RegenerateContentFetcher`)
   - したがって「本文が保存されていればそれを使い、無ければ URL を再取得する」か「常に再取得する」かを決める。再取得はページの変化・ログイン切れ・削除済みページの影響を受ける
2. 保存済み本文を使う場合、その本文がマスク前かマスク後かを確かめる。マスク前なら、送信前に PII マスクを必ずかける
3. 1 件の要約し直し(`createRegenerateSummaryHandler`)が `recordingPipeline.record` を通ることで、ドメイン別 AI 送信政策と PII マスクが適用されていることをテストで確認する。一括化はこの経路を再利用し、独自の送信経路を作らない
4. 一括実行を Service Worker の停止に耐えさせる方法(進捗の永続化、既存のキューの再利用)を決める

### 既存の関連コード
- `src/background/handlers/recordingHandlers.ts`: `createRegenerateSummaryHandler`(1 件の要約し直し、in-flight ガード、`ai_failed` の扱い)
- `src/background/regenerateContentFetcher.ts`: URL を裏のタブで開き直して本文を再抽出する
- `src/background/tabLifecycle.ts`: 補助タブの開閉
- `src/background/pipeline/mappers/regenerateUpdateFields.ts`: 要約し直しで更新してよい列
- `src/background/pipeline/steps/saveSqliteStep.ts`: 要約し直しの UPDATE
- `src/background/pipeline/steps/processPrivacyPipelineStep.ts`、`src/background/privacyPipeline.ts`: プライバシーの処理経路
- `src/utils/storage/aiDomainPolicy.ts`: ドメイン別 AI 送信政策(`resolveAiDomainPolicy`)
- `src/utils/piiSanitizer.ts`: PII マスク
- `src/offscreen/schema.ts`: `browsing_logs` の `content`・`ai_provider`・`ai_model` 列
- `src/background/pipeline/mappers/commonStorageFields.ts`: 本文保存の設定に応じた `content` の保存
- `src/dashboard/panels/asyncData/sqliteHistoryPanel.ts`: 履歴パネル(要約し直しの UI がある)

### 範囲
- 含める: 履歴で選んだ記録の一括の要約し直し
- 含めない: 全件の自動での要約し直し、要約の版の履歴(古い要約を残す機能)、Obsidian 側のノートの書き換え

## Definition of Done
- [ ] 全 BDD シナリオが自動テストで検証されている
- [ ] `npm run validate` が緑
- [ ] コードレビュー完了(プライバシー経路の迂回が無いことを確認)
- [ ] ドキュメント更新済み(一括の要約し直しで AI に送られる内容。送信内容が変わる場合は `public/PRIVACY.md` と `docs/PRIVACY.md` を同一に更新)

## 引き継ぎ
状態: 将来候補(未着手)
