# PBI: 外部 API 信頼性ガイドラインの circuit breaker 記述を実装に同期する

種別: chore

上流: `dev-docs/archived/pbi/2026-09-27-03-fix-ai-provider-circuit-breaker.md`（実装済み）/ `dev-docs/archived/pbi/2026-09-27-04-feat-ai-provider-breaker-rollout-gate.md`（ゲート）

## ユーザーストーリー

このプロジェクトの API 連携の設計指針を読む開発者として、ガイドラインが「circuit breaker は未実装・将来課題だと言っている」状態を解消してほしい。実装済みの機能を「未実装」と書いたままでは、次に同じ機能を再設計してしまう。

## 優先度

- 順位: 3 / 3
- RICEスコア: 0.25（Reach=0.5 / Impact=0.25 / Confidence=100% / Effort=0.5 SP）
- 根拠: 文書 2 箇所の記述だけが実際のコードと食い違っている。ユーザー影響は無く、開発者の誤判断を防ぐだけなので Impact は最小。ただし PBI 27-04 の内容を説明しないと記述が古びるため、27-04 と同じラウンドで更新する
- 依存: PBI 27-04 の裁定内容（トグル名・既定値）に追随するため、実質的に 27-04 の後

## BDD受け入れシナリオ

```gherkin
Scenario: 実装状況の表が実装済みと記載している
  Given EXTERNAL_API_RELIABILITY_GUIDELINE.md の実装状況表に「サーキットブレーカー」の行がある
  Then 「未実装」ではなく、実装済みの status と参照先 file を記載している

Scenario: 適用基準の記述が現状の裁定と矛盾しない
  Given 同じガイドラインに「将来 AI Provider 追加時に検討する」という文面がある
  Then 既に AI provider に導入済みであることが分かる文面に更新されている
  And ユーザー設定による有効・無効の切替が説明されている
```

## 受け入れ基準

- [x] `docs/EXTERNAL_API_RELIABILITY_GUIDELINE.md` の実装状況表にある `| サーキットブレーカー | 未実装 | 将来の課題 |` を、実装済み・参照先 `src/background/ai/providerBreaker.ts`・既定 ON／ユーザー設定で無効化可能、へ更新する
- [x] 同ファイル §5 の「将来 AI Provider 追加時に検討すること」という文面を、既に AI プロバイダへ導入済みである旨へ更新する
- [x] 同じファイルが `public/` に複製されていないか確認する（存在する場合は byte-identical で同期する）
- [x] Breaker の閾値・cooldown 時間をこのドキュメントに二重定義しない（SSOT は policy 報告書）
- [x] コードを変更しない

## テスト戦略

- 単体: なし（文書のみ）
- ゲート: 既存の文書リンク検証（`scripts/lint-adr-links.mjs`）とリポジトリの markdown lint が green であること

## 技術的考慮事項

- このファイルは指針であり、実装の SSOT ではない。数値や遷移規則を追記せず、参照先リンクと決定だけを置く
- PBI 27-04 が未着手のうちは「既定 ON、トグル追加予定」と書くのでなく、PBI 27-04 と同時に確定させる

## 見積もり

0.5 SP

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] 文書が実装と矛盾しないことをレビューで確認する
- [x] `npm run validate` が green
