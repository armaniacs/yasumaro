# PBI: LLMの縮退出力（繰り返し・非文）を検出して保存・表示を抑止する

## ユーザーストーリー

閲覧者として、LLMが「豚肉 | 豚肉 | 豚肉 ...」のような同一文字列の繰り返しや、日本語として成立していない縮提出力を出したときに、それが履歴に保存されたりダッシュボードに表示されたりしないようにしたい。なぜなら画像のように local LLM (ollama/gemma3:1b) が縮退すると、要約としての価値がゼロであるだけでなく、Obsidian ノートや履歴DBを汚染し、後続の検索・振り返りのノイズになるから。

## 優先度

- 順位: 15 / 15（ファイル名連番。安全装置のため実際の着手は前倒し推奨 — `2026-08-30-00-backlog-cleansing.md` の推奨実行順を参照。29系 Wave 1 と並行可）
- RICE: Reach 7 / Impact 3 / Confidence 0.8 / Effort 2日 = 8.4
- 根拠: 画像の事例は gemma3:1b という軽量モデルで発生。小モデルや低 temperature 設定、クレンジング後の短い入力(2014 bytes)で縮退は再現性がある。保存前の1箇所で抑止できれば全プロバイダで効果があり、Effort は純粋関数1つで小さい。

## 背景

### 現象

- 入力: `diamond.jp` 記事、AI へ送信 637 tokens / 受信 1000 tokens / 処理 20.6秒 (ollama/gemma3:1b)
- 前段パイプライン: コンテンツ抽出 18185→5263 (71.1%削減) → Content Cleansing 5263→3878 → AI要約クレンジング 3878→2014 (48.1%削減) → 合計 17.8KB→2.0KB (88.9%削減)
- 出力: `「最高の組み合わせ」「天才である」大戸屋の“やみつき限定メニュー”...` というタイトルに対し、本文要約が `料理 | 豚肉 | 豚しんこ | 期間限定 | ... | 豚肉 | 豚肉 |` の ` | ` 区切り・同一単語の大量繰り返し(200回超)で埋め尽くされる。日本語の文になっていない。

### 現行コードの gaps

- `src/background/privacyPipeline.ts:_processCloudResult` は `sanitizePromptContent` でプロンプトインジェクションのみを検査し、要約の言語的健全性は検査しない
- `src/background/ai/providers/ProviderStrategy.ts` / 各 Provider の `generateSummary` は `success: true` であれば `summary: string` をそのまま返す。空文字チェック `if (!localResult.summary)` はあるが、繰り返しは素通り
- `src/background/pipeline/RecordingPipeline.ts` / `BrowsingLogRecordMapper.ts` は `summary` を無検証で `BrowsingLogRecord` に保存し、ダッシュボード `historyEntryRow.ts` がそのまま描画する
- クレンジングが強力(88.9%削減)なため、入力が短くなり小モデルが縮退しやすい条件を作っている可能性もあるが、本PBIは「出力を止める」側に絞る（クレンジング側の調整は PBI-01/04/06 で扱う）

### なぜ起きるか（仮説）

- 小モデル (1B) の語彙・文脈窓が狭く、短い入力で `|` 区切りのキーワード列を「リストを続けよ」と誤解して自己強化ループに入る
- temperature / top_p が低い、またはプロンプトが「タグも出力せよ」を含む場合に `tagSummaryMode` の `|` 区切りが増幅される

## BDD 受け入れシナリオ

```gherkin
Scenario: 同一トークンの高頻度繰り返しを検出する
  Given LLM出力が「豚肉 | 豚肉 | 豚肉 ...」を200回含む
  When isDegenerateOutput(summary) を呼ぶ
  Then isDegenerate=true が返る
  And reason='repetition' が返る

Scenario: 正常な要約は素通りする
  Given LLM出力が「大戸屋の期間限定メニューは、豚肉の生姜焼きと...。ご飯が進む味付けで...」という3文の自然な日本語である
  When isDegenerateOutput(summary) を呼ぶ
  Then isDegenerate=false が返る

Scenario: 縮退出力は保存・表示されない
  Given privacyPipeline.process が縮退出力を返した
  When RecordingPipeline が結果を保存しようとする
  Then BrowsingLogRecord.summary は「要約に失敗しました」等のフォールバックに置換される
  And ダッシュボードでは縮退テキストではなくフォールバックが表示される
  And 縮退の詳細(reason, repetitionRate)はログに記録される

Scenario: 英語の繰り返しも検出する
  Given LLM出力が「apple | apple | apple ...」を100回含む
  When isDegenerateOutput(summary) を呼ぶ
  Then isDegenerate=true が返る

Scenario: 短い正常出力は誤検出しない
  Given LLM出力が「了解。」のように10文字以内の短い正常応答である
  When isDegenerateOutput(summary) を呼ぶ
  Then isDegenerate=false が返る（短すぎるため判定対象外）

Scenario: フォールバック時は再試行できる（将来拡張）
  Given 縮退が検出されフォールバックした
  And 優先度リストに次のプロバイダがある
  When 自動再試行が有効である
  Then 次のプロバイダで generateSummary が再試行される
```

## 受け入れ基準

- [ ] `src/utils/llmOutputGuard.ts` (新設) に `isDegenerateOutput(summary: string): { isDegenerate: boolean; reason?: string; metrics?: object }` が実装される
- [ ] 検出は少なくとも以下を満たす
  - [ ] 同一 n-gram(例: `豚肉`)の出現率が閾値超(例: 全トークンの30%超が同一単語)で `repetition` と判定
  - [ ] `|` 区切り等のデリミタで分割した要素のユニーク率が閾値未満(例: 10%未満)で `lowDiversity` と判定
  - [ ] 圧縮率(例: `lz-string` や簡易 RLE)で高圧縮可能(例: 10:1超)なら `highlyCompressible` と判定 — いずれか1つで縮退とみなす
  - [ ] 日本語の文としての最低要件(例: 句点 `。` または `です/ます/だ` 等の述語を含む)を満たさない場合は `notSentence` として補助的に判定（単独では縮退としない）
- [ ] `privacyPipeline.ts:_processCloudResult` または `RecordingPipeline` の保存直前でガードが呼ばれ、縮退時は `summary` をフォールバック文字列に置換する
- [ ] フォールバック時は `addLog(LogType.WARN, 'Degenerate LLM output detected', { reason, repetitionRate, providerName })` で観測可能にする
- [ ] ダッシュボード `historyEntryRow.ts` では縮退テキストを表示せず、フォールバックを表示する（既に保存済みの縮退データは表示時にマスクしてもよい）
- [ ] `npm run validate` が通る

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- ダッシュボードで `diamond.jp` 相当の短い入力を gemma3:1b に与え、縮退時にフォールバックが表示されることを手動確認（モック不要の実機確認）

### 統合テスト
- `privacyPipeline.test.ts` に縮退出力を返す `aiService` モックを注入し、`process()` の戻り `summary` がフォールバックに置換されることを検証
- `RecordingPipeline.test.ts` に縮退出力を含む `PrivacyPipelineResult` を与え、 `BrowsingLogRecord.summary` が汚染されないことを検証

### 単体テスト
- `llmOutputGuard.test.ts` (新設) に多数:
  - 画像の実例「豚肉 | 豚肉 ... 200回」で `isDegenerate=true`
  - 正常な3文要約で `false`
  - 英語 `apple | apple` 繰り返しで `true`
  - 短文「了解。」で `false`（長さ閾値で除外）
  - 境界: 繰り返し率 29%→false / 31%→true、ユニーク率 9%→true / 11%→false
  - 句点なしだが述語ありの正常文は `false`
  - 空文字・null・undefined は `false`（呼び出し側で別扱い）

## 実装アプローチ

- **Outside-In**: `llmOutputGuard.test.ts` に画像の実例で RED テストを先に書く → `llmOutputGuard.ts` を実装して GREEN → `privacyPipeline.ts` に組み込み → 統合テストで GREEN
- **Red-Green-Refactor**: ガードは純粋関数。閾値はテストで固定し、将来的に `StorageKeys.LLM_GUARD_*` で可変化する余地を残すが本PBIでは定数でよい
- **リファクタリング**: 圧縮率判定は依存を増やさない簡易実装(例: `summary.length / new Set(tokens).size`)から始め、必要なら `pako` 等に置換

## 見積もり

2pt（ガード実装1 + パイプライン組込0.5 + テスト0.5）

## 技術的考慮事項

- 依存: なし。新規 `src/utils/llmOutputGuard.ts` は `utils` レイヤ。`privacyPipeline.ts` / `RecordingPipeline.ts` から import するが循環なし
- テスタビリティ: 純粋関数。jsdom 不要。`vitest` のみで完結
- 非機能: 1要約あたり O(n) のトークン分割。1000 tokens で数ms。パフォーマンス影響なし
- 後方互換: 既に保存済みの縮退データは本PBIでは DB マイグレーションしない。表示時マスクは任意。将来 `scripts/migrate-degenerate-summaries.mjs` で置換する余地を残す

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "generateSummary\|_processCloudResult" src/background/ --include="*.ts" | head -n 20
grep -rn "historyEntryRow\|BrowsingLogRecord" src/ --include="*.ts" | head -n 20
cat src/background/privacyPipeline.ts | grep -n "_processCloudResult" -A 30
```

### 実装手順
1. `src/utils/llmOutputGuard.ts` を新設:
   ```ts
   export function isDegenerateOutput(summary: string): { isDegenerate: boolean; reason?: string; metrics?: { repetitionRate: number; uniqueRate: number } }
   // 1) summary.trim().length < 20 は判定対象外(false)
// 2) summary.split(/[\s|、,]+/) でトークン化
   // 3) 最頻出トークンの出現率 > 0.3 → repetition
   // 4) uniqueTokens / totalTokens < 0.1 → lowDiversity
   // 5) summary.length / uniqueTokens.length > 50 → highlyCompressible 的な簡易判定
   // いずれかで true
   ```
2. `src/background/privacyPipeline.ts:_processCloudResult` の冒頭でガードを呼ぶ。縮退なら `return { summary: '要約に失敗しました（AI出力が不自然なため）', ... }`
3. 代替案: `RecordingPipeline` の `save` 直前でガードを呼ぶ方が全経路をカバーできる。どちらか一方に集約し、二重チェックしないこと
4. `src/utils/__tests__/llmOutputGuard.test.ts` に画像の実例を含むテストを追加し RED→GREEN
5. `privacyPipeline.test.ts` に統合テストを追加

### 落とし穴

- **短い正常出力の誤検出**: 「はい。」「了解。」はトークン数1でユニーク率100%だが長さが短いため、長さ閾値(<20文字)で判定除外すること
- **タグ出力との混同**: `tagSummaryMode` では `tag1 | tag2 | tag3` の `|` 区切りが正当。タグ部分と要約本文を分離してから判定すること（`parseTagsFromSummary` 後の `summary` のみを対象にする）
- **閾値のチューニング**: 画像の「豚肉200回」は極端だが、10回程度の軽度な繰り返しは正常な箇所もある。閾値はテストで固定し、将来的に `pbi/2026-08-30-08` のフィードバックループで調整可能にする
- **再試行の是非**: 本PBIでは再試行はスコープ外とする。再試行を入れると `FallbackAIService` のループと相互作用し、無限リトライのリスクがある。再試行は別PBIで `isDegenerate` を `success: false` として扱う形で検討する

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了
- [ ] ドキュメント更新済み
