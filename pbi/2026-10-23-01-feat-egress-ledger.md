# PBI: 送信の台帳化 ― egress ledgerとドメイン別政策

## ユーザーストーリー
使う人として、自分の本文がいつ・どこへ・何文字送られたかを見たい、なぜなら外部AI送信の本質的不安を可視化なしに預けられないから

## 優先度
- 順位: 01 / 5候補
- RICEスコア: 1066 (Reach=1000 / Impact=2 / Confidence=0.8 / Effort=1.5人週)
- 根拠: 信頼の土台。全利用者に影響し、H等の外部送信を伴う機能の前提になる。依存より先に置く
- 依存: なし。他候補(H)がこの作法に従う

## 背景・制約
- 送信先はAIプロバイダー・Obsidian Local REST API・Gistの3種(`PERMISSIONS.md`・`SECURITY.md`のScope)。新規送信先はPBI 2026-10-22-01のSSOT経由で追加する
- 未宣言originはfail-closed(CSPで遮断)。6.9.52のGist 3pinを規範にする
- 監査ログは現行7日固定・フォールバック環境では監査不可(`docs/STORAGE_MODES.md`)。本PBIでは最小形(送信時刻・送信先・文字数・政策判定)をフォールバックでも読める形にする。明細の長期化は含めない
- プロンプトインジェクション高リスク遮断の理由表示を含める。検出器自体の精度向上は含めない

## BDD受け入れシナリオ
Scenario: 送信が台帳に残る
  Given AI要約が有効な状態
  When 記録が1件保存された
  Then 送信時刻・送信先・文字数・政策判定が台帳に1行残り、ダッシュボードで確認できる

Scenario: 未宣言送信先は送らず理由が分かる
  Given 送信先が未宣言originである
  When 転送しようとした
  Then ネットワークに出さず遮断し、台帳と設定画面に理由が表示される

## 受け入れ基準
- [x] ドメイン別に送信許可・要約なし記録・マスク必須を選べる
- [x] 高リスク遮断時に理由が表示され、元記録は保持される
- [x] 未宣言originの遮断がe2e pinで固定される
- [x] フォールバック環境でも台帳の最小形が読める
- [x] ja/enの文言漏れがない

## テスト戦略
- E2E: 要約有効→保存→台帳表示、未宣言origin遮断の通し
- 統合: PIIマスキング適用後の文字数記録、再試行時の二重計上防止
- 単体: 政策判定・マスク適用・切り詰めのテーブルテスト

## 見積もり
1.5人週相当。チームで再見積もりすること

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み(PERMISSIONSの送信先章・SECURITYのScope・PRIVACYの監査章)

## 実装記録（2026-10-23）
- 政策エンジン: `AI_DOMAIN_POLICY` 設定に3種の政策を保存。リゾルバは `src/utils/storage/aiDomainPolicy.ts`（defaults.ts の外に配置し、defaults → domainUtils → SettingsRepository → settingsMigration → defaults の循環を回避）。privacyPipeline はマスク必須でプライバシーモード非依存のマスクを強制し、要約なしでAIを実行せず記録のみ。判定は送信に乗り監査台帳に記録（commit b97c4fc2）
- 設定UI: domainパネルに3種の政策を選べるエディタを追加。選択肢は `AI_DOMAIN_POLICIES` 集合から生成、行の正規化はfail-closed。ja/en i18n追加。aiDomainPolicy.ts を Layer 1 に登録（commit 2628d3a3）
- 監査台帳: char_count/policy列を追加し最小形を通す（commit 5a2b9d0b）。フォールバック環境でも最小形を読めるようにする（commit ef7e353a）。台帳は診断パネルのエクスポート（`auditLogTsv.ts`）で確認できる
- 未宣言originのe2e pin: 既存 `testDir/e2e/gist-egress.spec.ts`（PBI 2026-10-18-25／2026-10-21-11）が document CSP による未宣言origin遮断を固定済み
- ドキュメント: SECURITY.md Scope・PERMISSIONS.md Reviewer Notes・PRIVACY.md 監査章（docs/publicバイト同一）に追記（commit 1f38b447）
- 最終検証: `npm run validate` exit 0（1124 files / 16727 tests・docs chars 0 violations・test type errors 451 pinned 451）
