# PBI: クレンジングの多言語パターンを拡充する

## ユーザーストーリー

多言語サイトの閲覧者として、フランス語・中国語・韓国語等のCookie同意バナーや法的テキストも正しく除去されてほしい。なぜなら現行 `COOKIE_TEXT_PATTERNS` / `LEGAL_TEXT_PATTERNS` は日英のみで、欧州GDPR文言( "Accepter les cookies" / "Alle Cookies akzeptieren" )等は素通りするから。

## 優先度

- 順位: 12 / 14
- RICE: Reach 6 / Impact 2 / Confidence 0.8 / Effort 1日 = 12.0
- 根拠: 海外サイトを閲覧するユーザーの要約品質に直結。Effortは小さい(パターン追加のみ)が、言語ごとのテスト追加が必要。

## 背景

- 現行: `src/utils/aiSummaryCleaner/patterns.ts` の `COOKIE_TEXT_PATTERNS` は日本語4件 + 英語4件、`LEGAL_TEXT_PATTERNS` は日英6件のみ。
- 課題: 欧州サイトのGDPRバナー、中国語のCookie同意、韓国語の法的テキストは除去されない。EC/QA/Videoパターンも日本ドメイン想定が強い。
- 機会: 主要言語(仏/独/西/中/韓)のCookie同意・法的テキストパターンを追加。`SOCIAL_CLASS_PATTERNS` の `x-` 等の誤爆対策と併せて、多言語対応を体系的に行う。
- 追加見落とし: 本PBIは当初の11案には含まれていなかったが、パターン網羅性の観点で見落とされていた。`patterns.ts` のコメントにも「日本サイト」表記が多く、国際化の視点が不足。

## BDD 受け入れシナリオ

```gherkin
Scenario: フランス語のCookie同意バナーが除去される
  Given <div>Accepter tous les cookies</div> がある
  When stripCookieConsentElements(root) を実行する
  Then 該当要素は削除される

Scenario: ドイツ語の法的テキストが除去される
  Given <div>Alle Rechte vorbehalten</div> がある
  When stripLegalTextNodes(root) を実行する
  Then 該当要素は削除される

Scenario: 日本語・英語の既存パターンは維持される
  Given <div>Cookieの管理</div> がある
  When stripCookieConsentElements(root) を実行する
  Then 従来通り削除される

Scenario: 多言語でも本文は保護される
  Given <article>フランス語の長文本文(2000字)</article> がある
  When cleanseAISummaryContent(root) を実行する
  Then 本文は削除されない
```

## 受け入れ基準

- [ ] `COOKIE_TEXT_PATTERNS` に仏/独/西/中/韓のCookie同意パターンが各1件以上追加される
- [ ] `LEGAL_TEXT_PATTERNS` に仏/独/中/韓の法的テキストパターンが各1件以上追加される
- [ ] 各言語のパターンが `stripCookieConsentElements` / `stripLegalTextNodes` で正しくマッチすることをテストで保証
- [ ] 日本語・英語の既存パターンが壊れていないことを回帰テストで保証
- [ ] `npm run validate` が通る

## テスト戦略

### E2E
- なし

### 統合
- `stripCore.test.ts` に多言語パターンの統合テスト。各言語のHTMLスニペットで削除されることを検証

### 単体
- `patterns.test.ts` に多言語パターンの単体テスト。各 `RegExp` が該当言語のテキストにマッチすることを検証
- 誤爆テスト: 多言語パターンが本文(例: "Accepter" を含む本文)に誤ヒットしないことを検証

## 実装アプローチ

- **Outside-In**: 多言語パターンのREDテストを先に書く → `patterns.ts` にパターン追加 → グリーン
- パターンは `RegExp` で追加。`i` フラグや `u` フラグの要否を言語ごとに検討

## 見積もり

1pt (パターン追加0.5 + テスト0.5)

## 技術的考慮事項

- 依存: なし
- テスタビリティ: `RegExp.test` の単体テストで検証可能
- 非機能: パターン追加による実行時間増は微小( `COOKIE_TEXT_PATTERNS` はテキストマッチで `querySelectorAll` 後のループ)
- i18n: パターン自体は `messages.json` とは無関係。 `patterns.ts` のみ変更

## 実装者向け注記

### 現状コードの確認
```bash
grep -n "COOKIE_TEXT_PATTERNS\|LEGAL_TEXT_PATTERNS" src/utils/aiSummaryCleaner/patterns.ts
cat src/utils/aiSummaryCleaner/patterns.ts | grep -A20 "COOKIE_TEXT"
```

### 実装手順
1. 各言語のCookie同意バナーの実例を収集(例: CookieYes / OneTrust の多言語版)
2. `patterns.ts` の `COOKIE_TEXT_PATTERNS` / `LEGAL_TEXT_PATTERNS` に正規表現を追加
3. `stripCore.test.ts` に多言語の統合テストを追加しRED→GREEN
4. 既存テストの回帰を確認

### 落とし穴
- 中国語の正規表現は `u` フラグが必要な場合あり。`/[\\u4e00-\\u9fa5]/` 等の範囲指定に注意
- フランス語の `Accepter` は本文に含まれる可能性。短すぎるパターンは誤爆するため、 `Accepter.*cookies` のように文脈を含める
- `LEGAL_TEXT_PATTERNS` は `stripLegalTextNodes` で500字以下かつ `p/article/section` 子要素2未満の要素のみを対象とするガードがある。多言語でも同様のガードが有効か確認

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了
- [ ] ドキュメント更新済み
