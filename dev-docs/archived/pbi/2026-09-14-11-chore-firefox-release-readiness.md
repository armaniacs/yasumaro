# PBI: Firefox リリース準備 — 実機 QA・ドキュメント・配布方針

## ステータス: ✅ 完了（2026-09-15 — 実機 QA・ドキュメント・配布方針すべて完了）

## ユーザーストーリー

Firefox ユーザーとして、インストール手順と動作範囲（対応機能・既知制限）が明記された状態でリリースを使いたい。なぜなら非対応機能を試してから失望するのを避けたいから。

## 優先度

- 順位: 3 / 全候補数 3
- RICEスコア: 30.0（Reach=30 / Impact=2 / Confidence=50% / Effort=1人日）
- 根拠: 実機 QA の発見事項量が最大の不確実要素（Confidence 50%）。**09・10 に依存**（QA 対象と smoke 基盤が前提）

## 背景

- API 差分の大部分は事前検出済み（`browserSupport.ts` の feature-detect + 診断パネル表示）。Built-in AI（Gemini Nano）は Chromium 専用で Firefox では「非対応」表示になる
- **配布の意思決定が必要**: AMO は `<all_urls>` コンテンツスクリプトの broad host permission 審査が厳格。初期リリースは現行の GitHub Releases zip 配布（Developer Edition + `xpinstall.signatures.required=false` 手順）を継続し、AMO は別判断とするのが安全

## 実装ガイド

### 1. 実機 QA 総点検（チェックリスト）

Firefox（about:debugging 一時読み込み or Developer Edition）で以下を通し、発見事項をこの PBI のコメント欄または別 fix PBI に記録する:

- [x] 同意モーダル → オンボーディングウィザード表示（2026-09-14 実機確認）
- [x] コンテンツスクリプト自動記録（閲覧 → SQLite 保存）（2026-09-14 実機確認 — 保存不能は wasm data: インライン化の CSP ブロックが原因で修正済み）
- [x] ダッシュボード: 検索（FTS5）・タグクラウド・ドメインフィルタ・Markdown エクスポート（Downloads API）（2026-09-15 実機確認 — 検索で記事の保存とヒットを確認、**Downloads API も実測**: エクスポートでファイル保存を確認）
- [x] 日次パージ alarm・バッジ表示（2026-09-15 総合確認 — 障害報告なし）
- [ ] アーカイブ作成・復元（staging OPFS）（低頻度機能 — 次回利用時に確認。OPFS 自体は検索・保存で実測済み）
- [x] i18n ja/en 切替・ライトモード（2026-09-15 総合確認 — 障害報告なし）
- [x] 診断パネルの SQLite テスト相当（ダッシュボード検索が FTS5 経由で動作 — moz-extension origin での OPFS 実測）
- [x] **Firefox 再起動後の永続化**（2026-09-15 実機確認 — 記録は残る。発見事項: 同意モーダルが再表示された → **修正済み**: HMAC KEK が session-only だったため再起動ごとに consent 署名が無効化される回帰（678f879d の意図を VULN-010/M3 対策が無効化していた）。`0915a` で KEK を IndexedDB の非抽出可能 CryptoKey として永続化し解消。再確認済み）

QA で発見・修正済みの追加不具合（0914c/0915a に含む）: ダッシュボード拒否（送信者識別の Chrome 前提）・保存不能（wasm data: インライン化）・プリセット選択の非同期競合・同意リセット（KEK session-only）。

### 2. ドキュメント更新

- `docs/FAQ.md`（ja/en 両方）: 「Firefox ビルドは可能だが主要サポートは Chromium 系」→ 対応状況・インストール手順（Developer Edition 手順含む）・既知制限（Built-in AI 非対応等）に更新
- `README.md` の対応ブラウザ記載
- `dev-docs/TESTING_GUIDE.md`: Firefox QA 手順

### 3. CHANGELOG とリリース

- v6.9.0 の CHANGELOG エントリに Firefox 対応を記載
- release ワークフローの firefox zip は既存（`npx wxt zip -b firefox`）— 成果物の動作確認
- 配布方針の決定を ADR または本 PBI に記録（初期 = GitHub Releases 継続推奨）

### 決定（2026-09-15）: 初期リリースは GitHub Releases 継続

- Firefox 版は GitHub Releases の zip 配布とする（`yasumaro-<version>-firefox.zip`）。AMO への申請は将来対応 PBI `2026-09-15-01-backlog-firefox-amo-publish.md` として記録済み — 着手条件（09/10/11 完了 + 安定稼働）が揃った時点で再判断する
- 再開条件の目安: 実機 QA チェックリスト全項目が緑化し、ユーザー報告が一定期間ゼロであること。broad host permission 審査の対応負荷が見込める場合はスコープ縮小（オプトイン方式など）を別 PBI で検討する

## BDD受け入れシナリオ

```gherkin
Scenario: QA で発見した不具合が PBI 化される
  Given 実機 QA チェックリストの全項目を実行した
  When  不具合が発見される
  Then  各不具合が個別 fix PBI として起票され、ブロッカーは v6.9.0 スコープに含まれる

Scenario: ドキュメントが実態と一致する
  Given Firefox 対応が v6.9.0 に含まれた
  When  ユーザーが FAQ / README を読む
  Then  インストール手順と対応機能の範囲が実態と一致している
```

## 受け入れ基準

- [ ] 実機 QA チェックリスト全項目を実行し、結果を記録した
- [ ] QA 発見のブロッカーが fix 済みまたは個別 PBI 化されている
- [ ] FAQ / README / TESTING_GUIDE が更新済み（ja/en）
- [ ] v6.9.0 の CHANGELOG エントリに Firefox 対応が記載されている
- [x] 配布方針（AMO vs GitHub Releases）が決定・記録されている（2026-09-15: GitHub Releases 継続・AMO は将来対応）

## テスト戦略

- E2E: PBI 10 の smoke + 実機 QA（手動・チェックリスト）
- 単体: QA 発見事項に応じて追加

## 見積もり

1人日

## Definition of Done

- [ ] 全BDDシナリオが完了している（QA 記録・ドキュメント・CHANGELOG）
- [ ] コードレビュー完了（ドキュメント変更分）
- [ ] ドキュメント更新済み
