# PBI: public/PRIVACY.md をdocs/PRIVACY.mdの最新内容に同期する

**作成日**: 2026-07-26
**完了日**: 2026-07-26
**優先度**: High
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟢なし（ドキュメント同期のみ、コード変更なし）

## 実装メモ（2026-07-26）

`docs/PRIVACY.md`（v6.0.1、2026年6月20日更新）の内容をそのまま`public/PRIVACY.md`に反映し、両ファイルを
完全に同期させた（`diff`差分ゼロを確認）。

同期前に権限記述の差異（`public`版「全Webサイトへのアクセス権限 (`<all_urls>`)」 vs `docs`版
「コンテンツスクリプトによるページアクセス権限」）に気づき、`wxt.config.ts`の実際の設定
（`host_permissions`に`<all_urls>`は含まれておらず、`content_scripts`の`matches: ['http://*/*',
'https://*/*']`がページアクセスの実体）と照合した。`docs`版の記述の方が実態に忠実であることを確認し、
`docs`側を正として採用した。

`AGENTS.md`のDocumentation Update Checklistに「PRIVACY.md sync」項目を追記し、今後どちらかを更新した
場合はもう一方にも同じ変更を反映するというルールを明記した。

ドキュメントのみの変更のため新規テストは追加していない。型チェックで他への影響がないことを確認済み。

---

## 背景

Checking Team レビュー（`plans/2026-07-23-1038-review-fix-0723.md`）の Compliance & Privacy Guard からの High指摘。Chrome Web Store 版のプライバシーポリシー（`public/PRIVACY.md`）が `docs/PRIVACY.md` の最新更新に追従しておらず、PII サニタイゼーションの詳細、OPFS SQLite 主体の保存、PBKDF2 反復回数（600,000回）の説明が欠落している。Store 審査で虚偽の説明とみなされるリスクがある。

**2026-07-26時点の再調査で、乖離が拡大していることを確認した。** `diff public/PRIVACY.md docs/PRIVACY.md` の結果:
- 最終更新日: `public`は2026年6月18日のまま、`docs`は2026年6月20日（GDPR準拠修正、v6.0.1）に更新済み
- `docs`側にのみ記載: データ保持ポリシーの自動削除の仕組み詳細、PIIサニタイゼーションの詳細（メール・クレジットカード・電話番号・マイナンバー・SSNのマスキング）、旧バージョンからの移行に関する説明
- `public`側は「閲覧履歴はOPFS上のSQLite DBとObsidian Vault両方に保存」という古い表現のまま、`docs`側は保存先の説明が整理されている

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
diff public/PRIVACY.md docs/PRIVACY.md
```

単純に `docs/PRIVACY.md` の内容で `public/PRIVACY.md` を上書きするのではなく、`public`版が意図的に簡略化されている箇所（Chrome Web Store向けの文字数制限等）がないか確認する。両者を統合する運用ルール（今後どちらを正とし、どう同期を維持するか）も合わせて検討する。

## 受け入れ基準（BDD）

```gherkin
Scenario: public/PRIVACY.mdの内容がdocs/PRIVACY.mdと整合する
  Given docs/PRIVACY.md に最新のプライバシー慣行（PIIサニタイズ、OPFS SQLite、PBKDF2反復回数）が記載されている
  When public/PRIVACY.md を確認する
  Then 同じ内容が反映されている（Chrome Web Store向けに要約が必要な箇所は要約されているが、事実関係の欠落はない）

Scenario: 今後の乖離を防ぐ運用が明文化される
  Given 2つのプライバシーポリシーファイルが存在する
  When ドキュメント更新のガイドラインを確認する
  Then どちらを更新した場合にもう一方を同期すべきというルールがCONTRIBUTING.mdまたはAGENTS.mdに明記されている
```

## 受け入れ基準
- [ ] `public/PRIVACY.md` の最終更新日・変更履歴を `docs/PRIVACY.md` の最新版（2026年6月20日、v6.0.1）に同期する
- [ ] データ保持ポリシー、PIIサニタイゼーションの詳細、OPFS SQLite移行の説明を `public/PRIVACY.md` に反映する
- [ ] 今後の同期漏れを防ぐため、`AGENTS.md` の Documentation Update Checklist に「PRIVACY.md変更時はpublic/docs両方を同期する」旨を追記する

## テスト戦略

ドキュメントのみの変更のため自動テスト対象外。差分確認（`diff public/PRIVACY.md docs/PRIVACY.md`）で内容が整合していることをレビューで確認する。

## 実装アプローチ

1. `diff public/PRIVACY.md docs/PRIVACY.md` で全差分を洗い出す
2. `docs/PRIVACY.md` の内容を基準に `public/PRIVACY.md` を更新する
3. `AGENTS.md` のDocumentation Update Checklistに同期ルールを追記する

## 見積もり

2pt

## 技術的考慮事項
- 依存関係: なし
- 非機能要件: コンプライアンス（Chrome Web Store審査対応）

## Definition of Done
- [ ] `public/PRIVACY.md` が `docs/PRIVACY.md` と整合している
- [ ] `AGENTS.md` に同期ルールが追記されている
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-23-1038-review-fix-0723.md`（Compliance & Privacy Guard指摘、High）
- 対象コード: `public/PRIVACY.md`, `docs/PRIVACY.md`
