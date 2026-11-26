# PBI: Obsidian 書き込み失敗の表面化(regenerate の無音失敗と競合の誤分類を直す)

## ユーザーストーリー
Obsidian に記録を保存している利用者として、再生成した記録の保存に失敗したときも通知や保留一覧で知りたいし、競合の通知が「保留一覧から再実行してください」と言うときは本当に保留一覧にあるようにしてほしい、なぜなら現状は成功に見えたまま Obsidian だけ失われたり、無いものを探させられたりするから。

## 優先度
- 順位: 06/12 の監査 run-3 の confirmed C-3/C-4 に対応
- RICE: 要チームでの見積もり
- 根拠と依存: なし。後続は 2026-11-24-08(実機スモーク)

## ビジネス価値
- 再生成の保存失敗が利用者に伝わり、記録の欠落に気づける
- 競合の通知と保留一覧の内容が一致し、誤った案内がなくなる
- 測定方法: BDD の 3 シナリオが単体・統合テストで緑であること

## BDD受け入れシナリオ

```gherkin
Scenario: regenerate の Obsidian 書き込み失敗は成功に見えない
  Given regenerate の記録で Obsidian の PUT が 500 を返す
  When  記録が完了する
  Then  結果は成功ではなく、通知か保留一覧のいずれかに失敗が残る

Scenario: regenerate の競合通知は保留一覧と一致する
  Given regenerate の記録で 412 が再書き込み後も続く
  When  競合の通知が出る
  Then  通知の文面は保留一覧に無いものを再実行させない(保留に登録するか、文面を変える)

Scenario: offline 経由の 412 は競合の分類を保つ
  Given 412 で枯渇した offline 再試行が handover する
  When  保留一覧に登録される
  Then  理由は `obsidian-write-conflict` のまま(汎用の書き込み失敗に変わらない)
```

## 受け入れ基準
- [ ] regenerate の非 412 失敗が、通知・保留のいずれかに残る
- [ ] regenerate の競合通知の文面と保留一覧の有無が一致する
- [ ] handover が競合の理由を保つ
- [ ] 非 regenerate の現行動作(通知なしの保留登録など)を変えない

## テスト戦略(t_wadaスタイル)

### E2Eテスト
- 追加しない(Obsidian Local REST API の 412 を実ブラウザで再現する仕組みがない。08 の実機スモークで確認)

### 統合テスト
- `RecordingPipeline.test.ts`: regenerate + 500 で失敗が表面化すること
- offline handover の理由が競合のままであること

### 単体テスト
- `recordingOutcome.test.ts`: regenerate 非 412 の表面化、通知文面と保留有無の一致
- 発火デモ(修正前に赤、修正後に緑)を必須にする

## 実装アプローチ
- **Outside-In**: 統合テストの発火デモから書き、赤を確認してから実装
- **Red-Green-Refactor**: TDD サイクルで進める

## 見積もり
3 ストーリーポイント(要チームでの見積もり)

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: `OutcomeAdapters` が注入可能で chrome API なしでテストできる
- 非機能要件: 通知は `NotificationHelper.show` の単一の書き込み点を通す。文言は i18n キーで両言語
- ロールバック手段: 表面化の追加差し戻しで現行動作に戻せる

## 実装者向け注記

### 現状コードの確認
着手前に必ず実行すること。

```bash
git -C /Users/yaar/Playground/yasumaro grep -n "decideRecoveryOwner\|obsidian-write-conflict" src/background/pipeline/recordingOutcome.ts
git -C /Users/yaar/Playground/yasumaro grep -n "obsidian-write-failed" src/background/offlineQueueProcessor.ts
```

確認結果(run-3 時点):
- `decideRecoveryOwner` が regenerate を `'none'` にする
- handover は理由を `obsidian-write-failed` に固定する

### 実装手順
1. 発火デモ(無音の成功)を先に書く
2. regenerate 失敗の表面化を入れる
3. 通知文面と handover の理由を直す
4. `npm run validate` で全体を確認

### 落とし穴
- `MAX_CONFLICT_REWRITES = 1` の挙動を変えないこと
- 非 regenerate の通知なし仕様を変えないこと
- 秘密情報(ノート本文・ETag・API キー)を通知・保留に出さないこと

## Definition of DoD
- [ ] 全 BDD シナリオがテストで検証されている
- [ ] `npm run validate` が緑
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
- [ ] CHANGELOG の `[Unreleased]` に利用者向けの変更として記載

## 引き継ぎ
状態: 実装済み。`1124a` に取込済み。進捗は [handoff/2026-11-24-07-release-ga-security-audit-run3.md](handoff/2026-11-24-07-release-ga-security-audit-run3.md) に記録した。
