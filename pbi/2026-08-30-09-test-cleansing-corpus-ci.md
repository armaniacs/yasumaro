# PBI: クレンジングパターン衝突をコーパスでCI検出する

## ユーザーストーリー

開発者として、パターン追加時に既存サイトの本文を誤削除しないことをCIで保証したい。なぜなら `AD_CLASS_PATTERNS` の `ad-` が `address` にヒットする等の誤爆は、単体テストの小規模DOMでは検出できず、実サイトのコーパスで初めて顕在化するから。

## 優先度

- 順位: 09 / 14
- RICE: Reach 5 / Impact 3 / Confidence 0.7 / Effort 3日 = 3.5
- 根拠: パターン追加のたびに手動で実サイト確認するのはコスト高。CIで自動検出できれば回帰を早期に止められる。コーパス収集のEffortは中程度。

## 背景

- 現行: `patterns.test.ts` で `address-book` 等の小規模な誤爆テストは追加済み。だが実サイトのHTMLは数千要素・多様なクラス名を持ち、単体テストでは網羅できない。
- 課題: 新パターン追加時に「実サイトで本文が0件になる」事故を検出する手段がない。`countAISummaryTargets` が `totalRemoved` を返すが、CIでは呼ばれていない。
- 機会: Alexa Top 1k または手動選定した100サイトの静的HTMLコーパスを `test/corpus/` に保存し、夜間CIで `countAISummaryTargets` と `bodyProtection` なしでの本文消失を検出する。

## BDD 受け入れシナリオ

```gherkin
Scenario: コーパスで誤削除が検出される
  Given コーパスに100サイトのHTMLがある
  And 新パターン「promo-box」を追加した
  When CIでコーパスに対して countAISummaryTargets を実行する
  Then 本文が0件になったサイトがレポートされる
  And CIが失敗する

Scenario: 正常なパターン追加はCIをパスする
  Given コーパスに100サイトのHTMLがある
  And 既存パターンで本文が保持されている
  When CIでコーパスに対して countAISummaryTargets を実行する
  Then 全サイトで本文が1件以上残り、CIがパスする

Scenario: Body Protectionなしでも本文が残る
  Given bodyProtectionEnabled=false の設定がある
  When コーパスでクレンジングを実行する
  Then 本文要素が削除されず、フォールバックが発動しない

Scenario: コーパスは手動更新可能である
  Given 新しいサイトで誤削除が報告された
  When 該当HTMLをコーパスに追加する
  Then 次回CIから該当サイトも検証対象になる
```

## 受け入れ基準

- [ ] `test/corpus/` または `scripts/corpus/` にコーパスHTML(10サイト以上)が保存される(初期は手動選定)
- [ ] `scripts/check-cleansing-corpus.mjs` または `__tests__/corpus.test.ts` がコーパスに対して `countAISummaryTargets` を実行し、本文消失を検出する
- [ ] 本文消失( `totalRemoved` が `candidateBytes` の90%以上 )が検出された場合にCIが失敗する
- [ ] コーパス追加の手順が `CONTRIBUTING.md` または `test/corpus/README.md` に文書化される
- [ ] `npm run validate` が通る(コーパステストは `validate` には含めず、夜間CIまたは `test:corpus` で実行)

## テスト戦略

### E2E
- なし

### 統合
- コーパステスト自体が統合テスト。100サイト × 32ルール の組み合わせで実行

### 単体
- コーパステストのヘルパ: 本文消失判定ロジックの単体テスト
- コーパスHTMLのパーステスト: `DOMParser` で正しくDOM構築できること

## 実装アプローチ

- **Outside-In**: コーパス収集スクリプトを先に作成 → 10サイトで手動検証 → CI統合 → 100サイトに拡大
- **段階移行**: Phase 1は10サイトの手動選定コーパスでPoC。Phase 2で100サイトに拡大。Phase 3でAlexa Top 1kの自動収集(将来)
- コーパスHTMLは `fetch` で取得し、 `public/` には含めず `test/corpus/` に隔離。ライセンス上、HTMLの再配布に注意(テスト専用と明記)

## 見積もり

3pt (コーパス収集1 + スクリプト1 + CI統合1)

## 技術的考慮事項

- 依存: なし
- テスタビリティ: jsdom または `happy-dom` でHTMLをパース。`DOMParser` はブラウザ専用のためNodeでは `jsdom` 必須
- 非機能: 100サイト × 32ルール の実行時間。並列化で数秒以内に収める
- CI: `test:corpus` は `validate` には含めず、 `validate:full` または夜間CIで実行。毎回のPRで100サイト走査すると遅い
- ライセンス: コーパスHTMLはテスト専用。リポジトリに含める場合は各サイトの利用規約を確認

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "countAISummaryTargets\|countCleanseTargets" src/
ls test/corpus/ 2>&1 | head -n 20
cat package.json | grep -A5 '"scripts"'
```

### 実装手順
1. `scripts/fetch-corpus.mjs` を作成。対象サイトのHTMLを `fetch` で取得し `test/corpus/*.html` に保存(10サイト)
2. `scripts/check-cleansing-corpus.mjs` を作成。各HTMLを `jsdom` でパース→ `countAISummaryTargets` 実行→本文消失を判定→レポート出力
3. `package.json` に `test:corpus` スクリプトを追加
4. `.github/workflows/` に夜間CIジョブを追加(任意)
5. `test/corpus/README.md` にコーパス追加手順を文書化

### 落とし穴
- `fetch` で取得したHTMLは動的コンテンツ(広告のランダムID)を含むため、毎回異なる結果になる。静的スナップショットとして保存すること
- `jsdom` は `window.location` を持たないため、 `whitelistAdapters.ts` のドメイン判定はスキップされる。コーパステストでは `whitelistExtractionEnabled: false` にすること
- HTMLサイズが大きいサイト(1MB以上)は `jsdom` のパースでメモリを消費。100サイト同時実行時は逐次処理にすること

## Definition of Done

- [ ] 全BDDシナリオが自動テスト/スクリプトとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了
- [ ] ドキュメント更新済み
