# ADR: 履歴の診断行は欠測時も理由付きで常に表示する

## ステータス
採用

## 日付
2026-09-18

## コンテキスト
履歴パネルの診断行（トークン行・コンテンツ抽出行・Content Cleansing行・PIIマスキング行・
AI要約クレンジング行・削減率バー）は、計測値がない場合に行自体を非表示にしていた。
AIなし記録（Epson Setup Naviなど）や旧バージョン記録では数行がまとめて消え、正常な
エントリ（CNNなど）との差が「壊れている」という誤解を生んだ。

PBI 2026-09-18-01では抽出・クレンジング行の欠測時に理由ラベルを表示したが、トークン行は
「引き続き非表示」、プログレスバーは「対象外」とした。続くスクリーンショット報告で
Tech CNNのバー欠落（PBI 2026-09-18-20）とEpsonの3行欠落（PBI 2026-09-18-21）が残課題と
なり、診断行全体の一貫表示へ拡張した。

## 決定
診断行は欠測時も領域を維持し、既存3分類（`no-ai` / `unmeasured` / `empty`）の理由文言で
表示する。正常エントリの数値表示は変えない。

方針の要点：

1. 欠測理由の判定は `historyEntryPresentation.ts` に集約し、単一所有とする。
   View側に計算やfallback連鎖を複製しない。新規の行分類（`classifyTokensMissing`、
   `classifyMaskingMissing`）もここに置く。
2. 理由文言は既存localeキー（`historyMissingReasonNoAi` /
   `historyMissingReasonUnmeasured` / `historyMissingReasonEmpty`）を再利用し、
   新規キーを作らない。行タイトルも既存キーを使う。
3. 理由行のHTML構造は通常行と同じclassを使い、文字サイズ・コントラスト・
   スクリーンリーダーの読み上げを通常行と同等にする。
4. PBI 2026-09-18-01の「トークン行は引き続き非表示」決定は本ADRで覆す。
   送信データボタン（`content` null時の非表示）は対象外とする。
   ボタンはデータ自体が存在しないため理由表示のしようがない。

## 結果
- AIなし記録・旧記録・空ページの区別がつき、正常エントリとの表示差が解消される。
- 削減率の定義（fallback連鎖）は `historyEntryPresentation.ts` の単一所有を維持する。
- 理由文言は定数のみとし、数値とprovider名は従来通りescapeHtmlを通す。
- 表示層のみの変更のため、理由分岐をrevertすれば従来表示に戻せる。
- 再検討のトリガー：(1) 新規の診断行を追加するとき（本方針に従い理由表示を付けるか）。
  (2) 送信データボタンの欠測時表示が求められたとき（対象外の見直し）。
  いずれかが満たされたら本ADRを置換するADRを起票する。

## Implements
- `src/dashboard/panels/asyncData/historyEntryPresentation.ts` — 欠測理由の判定（単一所有）
- `src/dashboard/panels/asyncData/sqliteHistoryPanelView.ts` — 診断行のHTML化（理由行の描画）
- `entrypoints/options/dashboard.css` — 欠測バーのプレースホルダー表示

## 参照
- PBI: `pbi/2026-09-18-20-fix-history-progress-bar-consistency.md`
- PBI: `pbi/2026-09-18-21-fix-history-missing-rows-consistency.md`
- PBI: `dev-docs/archived/pbi/2026-09-18-01-fix-history-missing-reason.md`（トークン非表示・バー対象外の旧決定）
