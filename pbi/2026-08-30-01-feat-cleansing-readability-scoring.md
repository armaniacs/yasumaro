# PBI: クレンジング本文保護スコアを Mozilla Readability ベースに置換する

## ユーザーストーリー

閲覧者として、短い記事やリスト中心のページでも本文が誤って削除されないようにしたい。なぜなら現行 `calculateReadabilityScore` は pタグ数・見出し数・文字数という約40行の粗いヒューリスティックで、閾値200は短文記事で保護失敗しやすいから。

## 優先度

- 順位: 01 / 15
- RICE: Reach 8 / Impact 3 / Confidence 0.6 / Effort 3日 = 4.8
- 根拠: Body Protection は全クレンジングの唯一の削除ガード。本文誤削除は要約品質に直結するが、現行スコアはテスト済みで安定しており置換はリスクも高い。PoCから段階移行。

## 背景

- 現行: `src/utils/aiSummaryCleaner/readabilityScore.ts`（約40行）が `text.length/10 + p*25 + h*50 + class補正 - link密度ペナルティ` でスコア化。200未満は保護されない。
- 課題: 短文(8p未満/4見出し未満/2000字未満)で保護漏れ。スコア自体が `querySelectorAll('p')` / `querySelectorAll('h*')` / `querySelectorAll('a')` でDOM走査を追加。
- 機会: Mozilla Readability.js は本文抽出で実績があり、リンク密度・テキスト密度・親要素スコア伝播を考慮。既存 `bodyProtection.ts` の `markBodyElements` を差し替える形で段階導入可能。
- 既実装確認: `grep -rn "readability\|Readability" src/` で自前実装のみ、外部ライブラリ導入なし。

## BDD 受け入れシナリオ

```gherkin
Scenario: 短文記事でも本文が保護される
  Given 3段落(計600字) + 見出し1つの記事DOMがある
  And bodyProtectionThreshold=200 である
  When markBodyElements(root, 200) を実行する
  Then 記事本文要素に data-ow-body-protected が付与される

Scenario: 広告要素は保護されない
  Given class="ad-banner" かつテキスト量が多い広告DOMがある
  When markBodyElements を実行する
  Then 該当要素は保護されない

Scenario: 既存テストの回帰なし
  Given 既存の readabilityScore.test.ts / bodyProtection.test.ts がある
  When 新スコアリングに置換する
  Then 既存テストは新期待値で更新されつつ、全テストがパスする

Scenario: フォールバック閾値は維持される
  Given 本文保護が新ロジックでも
  When cleanseAISummaryContent で全ルール実行後の bytes が fallbackRatio 未満になる
  Then Over-cleansed Fallback が従来通り発動する
```

## 受け入れ基準

- [ ] `calculateReadabilityScore` が Readability 相当のスコアリングに置換され、`readabilityScore.test.ts` が新ロジックでパスする
- [ ] 短文(300-800字) / リスト中心 / 見出しなし の3パターンで保護成功率が現行比で改善していることをテストで示す
- [ ] `bodyProtection.test.ts` の protection 有無テストが維持される
- [ ] パフォーマンス: 1000要素DOMでの `markBodyElements` 実行時間が現行比 2倍以内
- [ ] `npm run validate` が通る

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- ダッシュボードで本文保護ON/OFFを切り替え、短文記事の要約結果を目視(手動)確認

### 統合テスト
- `bodyProtection.test.ts`: article/div/section の保護マーキング統合テスト。新ロジックでも `isBodyProtected` が正しく判定される

### 単体テスト
- `readabilityScore.test.ts`: 短文/長文/リンク高密度/広告クラス/日本語混在 の境界値テスト。閾値境界(199/200/201)テスト
- `calculateReadabilityScore` のリンク密度ペナルティ(0.5倍)相当の新ロジック分岐テスト

## 実装アプローチ

- **Outside-In**: `readabilityScore.test.ts` に失敗する新期待値を先に書き → `readabilityScore.ts` を置換 → `bodyProtection.ts` はインターフェース不変 → グリーン → リファクタ
- **段階移行**: まず `calculateReadabilityScore` をラッパにし、内部で旧ロジックと新ロジックを feature flag で切替可能に。デフォルトは旧ロジック、テストで新ロジックを検証

## 見積もり

3pt (調査1 + 実装1 + テスト1)

## 技術的考慮事項

- 依存: なし。Mozilla Readability はゼロ依存で移植可能だが、バンドルサイズ増に注意(必要ならスコアリング部分のみ抜粋)
- テスタビリティ: `readabilityScore.ts` は純粋関数。jsdom でDOM構築してテスト可能
- 非機能: Content Scriptバンドルサイズ + Content Script実行時間

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "calculateReadabilityScore\|markBodyElements" src/
grep -rn "BODY_PROTECTION" src/
```

### 実装手順
1. `readabilityScore.test.ts` に新期待値(短文保護されるケース)を追加しRED確認
2. `readabilityScore.ts` を Readability スコアリングに置換(親要素へのスコア伝播、クラス重み付けを参考)
3. `bodyProtection.ts` は変更なし(呼び出し側は閾値200のまま)
4. 既存テストの期待値を新ロジックに合わせて更新

### 落とし穴
- `textContent` の正規化: Readability は `innerText` 的な可視テキストを使うが、現行は `textContent`。差異でスコアが変わる
- class/id の positive/negative パターンは Readability の `unlikelyCandidates` / `okMaybeItsACandidate` と重複する。両方を足すと二重補正になる

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了
- [ ] ドキュメント更新済み
