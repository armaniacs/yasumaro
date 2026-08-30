# PBI: 二次計算の入力上限（VULN-041/051/053, CWE-400）

> `2026-08-29-08-fix-resource-boundary-caps.md` から分離。PR #75 では書き込み境界の
> cap（payloadGuard / Cache-Control / pending 剪定）が着地した。本 PBI は
> 既に保存されたデータが O(n²) 計算に無制限に流入する経路を扱う。

## ユーザーストーリー
利用者として、大量のタグや文を持つ履歴が蓄積してもダッシュボードのタグ共起グラフ・要約抽出・タグクラスタ配置が固まらないようにしたい、なぜなら悪意ある/肥大化したページ内容由来のタグ・文が上限なく O(n²) 計算に入り、実測で「入力 4 倍 → 時間 29 倍、116GB エッジモデル」になるから

## 背景

### 対象の O(n²) 計算
| 経路 | ファイル | 爆発点 |
|---|---|---|
| VULN-041 タグ共起 | `src/dashboard/tagCooccurrence.ts` `computeTagCooccurrence` | エントリ毎の `for i { for j>i }` 二重ループ。1 レコード 500 タグ → 約 125k 反復/レコード。エッジ数は `C(n,2)` |
| VULN-051 要約抽出 | `src/utils/sentenceExtractor.ts` TextRank | `const n = nodes.length` の類似度行列 O(n²)。文数上限なし |
| VULN-053 タグクラスタ配置 | `src/dashboard/tagClusterLayout.ts` | 力学配置の反復 × ノード数²。`limitToTopNodes` はあるが呼び出し前に共起計算が走る |

### PR #75 で見送った理由
3 ファイル × 性能テスト（次数低下の実測）で範囲が広く、`tagClusterLayout` は
PBI 本文で「計算頻度の高い panel なので UX 劣化を計測」と要求されている。

## BDD受け入れシナリオ

```gherkin
Scenario: タグ共起はレコード毎のタグ数を cap する
  Given 1 レコードに 500 タグが保存されている
  When computeTagCooccurrence が実行される
  Then レコード毎のタグは MAX_TAGS_PER_RECORD（例: 50）に cap され、二重ループの反復が有界になる

Scenario: TextRank は入力文数を cap する
  Given 抽出対象に 5000 文がある
  When sentenceExtractor が TextRank を実行する
  Then 文は MAX_SENTENCES_FOR_TEXTRANK（例: 200、minLength 越えを優先）に cap され、類似度行列が有界になる

Scenario: タグクラスタ配置は共起計算前にノードを cap する
  Given 履歴に 2000 個のユニークタグがある
  When タグクラスタ panel がレンダリングされる
  Then 共起計算に渡すタグが上位 N（出現頻度順）に絞られてから計算される

Scenario: 通常規模のデータは結果が変わらない
  Given 数十タグ / 数十文の通常レコード
  When 各計算が実行される
  Then cap 未満のため現行と同一の結果を返す

Scenario: 計算時間の次数が下がる
  Given 入力 n を 1x → 2x → 4x に増やす
  When 各計算の実行時間を計測する
  Then cap 適用後は時間の増加が線形（cap で頭打ち）になる
```

## 受け入れ基準
- [ ] `src/dashboard/tagCooccurrence.ts` の `computeTagCooccurrence` が、エントリ毎の `uniqueTags` を `MAX_TAGS_PER_RECORD`（既存 precedent の 50 に合わせる）で cap してから二重ループに入る
- [ ] `src/utils/sentenceExtractor.ts` の TextRank 経路が、`minLength` フィルタ後の文を `MAX_SENTENCES_FOR_TEXTRANK`（200 程度）に cap する。cap は 64KB truncation の後段、minLength 越えの文を優先
- [ ] `src/dashboard/tagClusterLayout.ts`（または呼び出し元 `tagClusterPanel.ts`）が、共起計算に渡すエントリ/タグ集合を事前に絞る（頻度上位 N）
- [ ] `src/offscreen/sqliteMessageHandlers.ts` の SQLite 保存経路のタグ cap（50）が実装されている（書き込み側の防御。PR #75 で未着手なら本 PBI で）
- [ ] cap 値は既存 precedent（1024 文字 / 50 タグ）に合わせ、新規判断は最小化
- [ ] 性能テスト: 入力 n 倍 → 実行時間の次数が落ちること（1x/2x/4x で計測、cap で頭打ち）
- [ ] 各 cap の境界値テスト（cap ちょうど / cap+1 / top-N 末端）
- [ ] `tagClusterLayout` の UX 劣化計測（レンダリング時間が現行比で悪化しないこと、または改善すること）
- [ ] `npm run type-check` と `npm run validate` が成功する
- [ ] VulnHunter 再検証: VULN-041/051/053 の PoC が失敗する

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象なし（計算は純粋関数、UX 計測は DevTools 手動 or Playwright 補助）

### 統合テスト
- `tagClusterPanel` × 大量タグ fixture: レンダリングが有界時間で完了
- `extractSentencesStep` × 5000 文入力: cap 経由で TextRank が完了

### 単体テスト
- 新規: `src/dashboard/__tests__/tagCooccurrenceCap.test.ts`（タグ数 cap、エッジ数の上限）
- 新規: `src/utils/__tests__/sentenceExtractorCap.test.ts`（文数 cap、minLength 優先）
- 更新: `tagClusterLayout` の既存テストに大量ノードケース
- 性能: `n` を変えて実行時間の次数を assert（緩い上限で）

## 実装アプローチ
- **Outside-In**: 性能テスト（RED: 入力 4 倍で時間 29 倍）→ 各経路に cap（GREEN: 時間が頭打ち）
- **Red-Green-Refactor**: cap 定数を 1 モジュール（`src/utils/computeLimits.ts` 仮称）に集約

## 見積もり
2pt（要チームでの見積もり — 3 経路の cap 1.5 + 性能/境界テスト 0.5）

## 技術的考慮事項
- 依存関係: なし（PR #75 とは別ファイル。`sqliteMessageHandlers.ts` のタグ cap のみ #75 と近いが未着手部分）
- `tagCooccurrence` のエッジ数自体も `C(cap, 2)` で有界化されるので、`limitToTopNodes` の前段が軽くなる
- 文数 cap は「要約品質」とのトレードオフ — 200 文で十分か、記事の長さ分布を確認
- 行番号は監査時点（2026-08-29）のもの。着手時に該当シンボルで再確認すること

## 実装者向け注記

### 現状コードの確認
```bash
rg -n "computeTagCooccurrence|for .*i.*<.*for .*j|limitToTopNodes" src/dashboard/tagCooccurrence.ts
rg -n "const n = |TextRank|similarity|minLength|topK" src/utils/sentenceExtractor.ts
rg -n "tagClusterLayout|computeTagCooccurrence" src/dashboard/tagClusterLayout.ts src/dashboard/panels/asyncData/tagClusterPanel.ts
rg -n "tags.*cap|MAX_TAGS|slice.*50" src/offscreen/sqliteMessageHandlers.ts
```

### 実装手順
1. `computeLimits.ts` に `MAX_TAGS_PER_RECORD` / `MAX_SENTENCES_FOR_TEXTRANK` / タグクラスタの top-N を定義
2. `tagCooccurrence` のループ前に `uniqueTags.slice(0, MAX_TAGS_PER_RECORD)`
3. `sentenceExtractor` の TextRank 前に文数 cap（minLength 越え優先ソート → slice）
4. `tagClusterPanel` が共起計算前にエントリ/タグを絞る
5. `sqliteMessageHandlers` のタグ cap（未着手なら）
6. 性能テスト + 境界テスト、`npm run validate`

### 落とし穴
- タグ cap は「どのタグを残すか」の順序が問題 — 出現頻度順 or 元の順序。要約の代表性を損なわない選択を
- TextRank の文数 cap で「記事後半の重要文が落ちる」可能性 — スコアリング前の cap なので位置バイアスに注意
- `tagClusterLayout` の力学配置は反復回数もパラメータ — ノード cap と反復 cap の両方を検討

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] VulnHunter 再スキャンで VULN-041/051/053 が解消されること
