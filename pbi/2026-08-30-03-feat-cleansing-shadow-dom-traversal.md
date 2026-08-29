# PBI: クレンジングの Shadow DOM / iframe 走査に対応する

## ユーザーストーリー

Web Components を多用するサイトの閲覧者として、Shadow DOM 内の広告も除去され、Shadow DOM 内の本文は保持されるクレンジングがほしい。なぜなら現行 `querySelectorAll` は Light DOM のみを走査し、Shadow 内のノイズは素通り・本文は保護対象外になるから。

## 優先度

- 順位: 03 / 14
- RICE: Reach 3 / Impact 3 / Confidence 0.5 / Effort 3日 = 1.5
- 根拠: 対象サイトは限定的だが、Notion / YouTube埋め込み / Figma など主要サービスで顕在化。技術的不確実性が高いためスパイク分離も検討。

## 背景

- 現行: `stripCore.ts` / `stripExtended.ts` / `bodyProtection.ts` / `readabilityScore.ts` はすべて `element.querySelectorAll(...)` で Light DOM のみ走査。
- 課題: ShadowRoot 内の要素は `querySelectorAll` で取得できない。`iframe` 内は別documentでアクセス不可。本文がShadow内にあると `markBodyElements` で保護されず誤削除リスク。
- 機会: `helpers.ts` に `querySelectorAllDeep` を新設し、 `shadowRoot` を再帰的に走査するヘルパで全strip関数を段階的に置換可能。

## BDD 受け入れシナリオ

```gherkin
Scenario: Shadow DOM内の広告が削除される
  Given host要素の shadowRoot 内に <div class="ad-banner">広告</div> がある
  When cleanseAISummaryContent(host) を実行する
  Then Shadow内の広告要素は削除される

Scenario: Shadow DOM内の本文が保護される
  Given shadowRoot 内に <article>長文本文(2000字)</article> がある
  And bodyProtectionEnabled=true である
  When cleanseAISummaryContent(host) を実行する
  Then 該当articleは削除されない

Scenario: 通常のLight DOMは従来通り動作する
  Given 通常の <div class="ad-banner">広告</div> がある
  When cleanseAISummaryContent(root) を実行する
  Then 従来通り削除される
```

## 受け入れ基準

- [ ] `helpers.ts` に `querySelectorAllDeep` / `collectElementsDeep` が追加され、ShadowRoot を再帰走査できる
- [ ] `stripDeepElements` または `stripAdElements` のいずれか1関数以上が Deep 走査に対応しテストで検証される
- [ ] `markBodyElements` が Shadow 内要素も保護対象にできる(または仕様として対象外を明記)
- [ ] `iframe` 内は same-origin のみ対象とし、cross-origin はスキップすることをコメントで明記
- [ ] `npm run validate` が通る

## テスト戦略

### E2E
- 手動: Chromeで `attachShadow` を使ったテストページでクレンジングを目視確認

### 統合
- `stripCore.test.ts` に `attachShadow` を使った統合テスト。jsdom の shadow DOM 対応状況を確認し、不可なら `happy-dom` 検討

### 単体
- `helpers.test.ts` に `querySelectorAllDeep` の単体テスト(ネストしたshadowRoot 2階層)
- 境界: shadowRootなし / closed shadowRoot / 空shadowRoot

## 実装アプローチ

- **スパイク分離**: jsdom が `attachShadow` / `shadowRoot` をどこまでサポートするか先に検証。不可なら代替案( `element.shadowRoot` のモック )を検討
- **Outside-In**: `helpers.test.ts` に RED テスト → `helpers.ts` にヘルパ実装 → 1つのstrip関数に適用 → グリーン → 横展開
- 最初は `stripDeepElements` の空要素除去など影響が小さい箇所から適用し、リスクを限定

## 見積もり

3pt (スパイク1 + 実装1 + テスト1)

## 技術的考慮事項

- 依存: jsdom の Shadow DOM サポート可否。不可ならテスト環境の差替が必要
- テスタビリティ: `attachShadow` は jsdom で `mode: 'open'` のみサポート。closed はテスト不可
- 非機能: 再帰走査による実行時間増。`querySelectorAll('*')` 1回 + フィルタの方が効率的な可能性
- セキュリティ: `iframe` の cross-origin アクセスは `SecurityError`。try-catch でスキップ

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "querySelectorAll" src/utils/aiSummaryCleaner/
grep -rn "shadowRoot\|attachShadow\|iframe" src/content/
```

### 実装手順
1. `helpers.ts` に `collectElementsDeep(root, selector)` を追加。`root.shadowRoot` を再帰的に探索
2. `stripCore.test.ts` に shadow DOM テストを追加しRED確認
3. `stripDeepElements` を Deep対応に置換
4. `bodyProtection.ts` の `markBodyElements` も Deep対応を検討(別PBIに分割可)

### 落とし穴
- `closed` shadowRoot は `element.shadowRoot` が null を返すため走査不可。仕様として諦める旨をコメントに明記
- `iframe.contentDocument` は cross-origin で null。try-catch で握りつぶす
- `cloneNode(true)` は Shadow DOM をクローンしない。`preparePageContent` の clone 戦略と整合を取る必要あり

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了
- [ ] ドキュメント更新済み
