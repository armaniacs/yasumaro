# PBI 16: aiSummaryCleaner のオプション二重定義と Blob バイト単位の統一

優先度: 6 位 / RICE 8 = (3 × 0.5 × 80%) / 0.15w / Strength: Worth exploring
backlog: [2026-09-04-00-backlog-arch2.md](2026-09-04-00-backlog-arch2.md)
依存: PBI 12 に続いて同一ファイル群へ着手

## ユーザーストーリー
クレンジング経路を保守する開発者として、AiSummaryCleanseOptions の形状が types.ts に完結し、バイト計測の単位（outerHTML vs textContent）が 1 箇所で決まってほしい。なぜなら declare module による graft は型読解を 2 ファイルに分散させ、extractor 経路では cleaner 側の Blob 直列化 2 回が捨てられているから。

## BDD受け入れシナリオ

```gherkin
Scenario: extractor 経路で Blob 直列化が発生しない
  Given contentExtractor の runAiSummaryCleanse が measureBytes: false を渡す
  When  cleanseAISummaryContent が実行される
  Then  new Blob(...) の呼び出しが 0 回になる
  And   bytesBefore/bytesAfter は 0（呼び出し側が再計算する）

Scenario: 単独呼び出しでは bytes が Blob 基準で入る
  Given 直接 cleanseAISummaryContent(el, { measureBytes: true })
  When  実行される
  Then  bytesBefore/bytesAfter が outerHTML バイトで埋まる
```

## 受け入れ基準
- [x] `measureBytes?: boolean` の定義が types.ts に移動し declare module が削除される
- [x] extractor 経路（runAiSummaryCleanse）で Blob 直列化が 0 回になる
- [x] bodyProtectionThreshold の既定値二重記載（120 vs 200）が 1 定数に統一される
- [x] 単独呼び出し（measureBytes: true）の bytes が従来どおり
- [x] contentExtractor / aiSummaryCleaner suite 全绿

## テスト戦略（t_wadaスタイル）
### 単体テスト
- Blob constructor spy: measureBytes false → 0 call / true → 2 call
### 統合テスト
- extractMainContent（extractor 経路）で Blob spy 0 call・fallback 判定が変わらないこと

## 実装アプローチ
- **Outside-In**: extractor 経路の Blob 0 回を統合テストで固定 → 実装

## 見積もり
0.15w

## 技術的考慮事項
- 依存関係: PBI 12 の後に着手（同ファイル）
- テスタビリティ: Blob spy で検証
- 非機能要件: ホットパスのマイクロ改善（outerHTML 直列化 2 回/クレンジング除去）

## 実装者向け注記

### 現状コードの確認
```bash
rg -n "measureBytes|declare module|new Blob|bodyProtectionThreshold" src/utils/aiSummaryCleaner/index.ts src/utils/aiSummaryCleaner/types.ts src/utils/contentExtractor/index.ts src/utils/aiSummaryCleaner/bodyProtection.ts
```
2026-09-04 時点: declare module :24-33、Blob :84/:118、bodyProtectionThreshold 既定 200（index）vs DEFAULT_BODY_SCORE_THRESHOLD 120（bodyProtection.ts — 6.7.89 30-01 で 200→120 に変更済みのため index の 200 は stale）。

### 実装手順
1. measureBytes を types.ts の AiSummaryCleanseOptions に移動、declare module 削除
2. runAiSummaryCleanse（contentExtractor/index.ts）が `measureBytes: false` を明示渡し（extractor は bytesBefore/After を自分で計算するため）
3. index.ts の bodyProtectionThreshold 既定を `DEFAULT_BODY_SCORE_THRESHOLD` import に統一（値 120 に変わるが、extractor 経路は明示 200 を渡している? — 呼び出し側の実値を確認してから。明示渡しがなければ 120 が新既定になり挙動が変わるため、既定値統一は「index.ts の既定を import 定数にする」のみで値は現状維持を選択可）
4. 単体 + 統合テスト更新

### 落とし穴
- **bodyProtectionThreshold 既定の変更は挙動変更になる**: 30-01 で 120 が正と実測されているため、index.ts:78 の 200 は呼び出し側が上書きしない場合の stale 値。実値を確認（rg で呼び出し側の渡し値を列挙）してから統一。安全策: 既定値は import 定数（120）に寄せ、影響テストを先に確認
- bytesBefore/After が 0 のとき Dashboard 診断が 0 表示になる — extractor 経路は自分で再計算して返すため影響なし（確認）

## Definition of Done
- [x] 単体/統合テスト green（Blob spy 含む）
- [x] declare module 削除 + types.ts 完結
- [x] コードレビュー完了
- [x] ドキュメント更新（不要: 内部リファクタリング）
