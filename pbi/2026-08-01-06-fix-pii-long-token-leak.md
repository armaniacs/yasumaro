# PBI: 長いトークン内部の PII がマスク漏れしないようにする

## ユーザーストーリー
ユーザーとして、長い URL や minified コンテンツ、base64 文字列の中に含まれるメールアドレスや電話番号が AI に送信されないようにしたい。

## ビジネス価値
- 個人情報保護の実効性を確保
- 長いクエリパラメータや JWT 内の PII 漏洩を防ぐ
- プライバシー機能の信頼性向上

## BDD受け入れシナリオ

```gherkin
Scenario: 長い空白なしトークン中央のメールをマスクする
  Given 100文字の 'a' + "user@example.com" + 100文字の 'b' からなる入力
  When piiSanitizer が実行される
  Then "user@example.com" がマスクされる

Scenario: 長い URL 内のクエリパラメータもマスクする
  Given "https://example.com/x...?email=user@example.com&next=..." という長い URL
  When sanitizeText が実行される
  Then email クエリ値がマスクされる
```

## 受け入れ基準
- [ ] 200文字を超える空白なしトークンの中央部も PII 検出の対象になる
- [ ] 性能要件（ReDoS 対策）を維持する
- [ ] マスク後のテキスト長が極端に増加しない
- [ ] 既存の PII 検出テストがすべてパスする

## テスト戦略（t_wadaスタイル）

### 単体テスト
- 長いトークン中央に埋め込まれた email/phone/credit-card のマスクテスト
- 境界値（200文字丁度、201文字、先頭・中央・末尾）
- 誤検知テスト（長い乱数文字列）

## 実装アプローチ
- **Outside-In**: `privacyPipeline` から `piiSanitizer` の契約を変更
- **Red-Green-Refactor**: 漏洩ケースのテストを Red から作成

## 見積もり
2pt

## 技術的考慮事項
- ReDoS 対策とのトレードオフ
- マスク後のテキストで LLM への影響

## 実装者向け注記

### 現状コードの確認
```bash
grep -n "neutralizeLongNonWhitespaceRuns\|scanText" src/utils/piiSanitizer.ts
```

### 実装手順
1. `scanText` 生成時に中央部も検出可能な方法を検討（例: トークンを分割してスキャン）
2. または `text` に対しても別パスで検出
3. 性能テストを追加

### 落とし穴
- 中央部の検出を有効にすると ReDoS リスクが増す
- 長い JWT 全体をマスクすると要約品質が低下する

## 関連情報（graphify 調査結果）
- **関連ファイル**: `src/utils/piiSanitizer.ts`, `src/background/privacyPipeline.ts`, `src/utils/piiStripper.ts`
- **関連する過去PBI**:
  - `2026-07-25-14-fix-pii-regex-redos-hardening`（PII ReDoS 対策強化）
  - `2026-07-20-22-fix-local-ai-pii-masking-order`（Local AI での PII マスキング順序）
- **補足**: `neutralizeLongNonWhitespaceRuns` は `scanText` のみを置換し、実際の出力 `text` は変更しない。中央部検出を有効にする際は `scanText` と `text` の整合性を維持する必要がある。

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] リファクタリング完了
