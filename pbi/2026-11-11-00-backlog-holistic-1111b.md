# 台帳: 大局的改善ラウンド 2026-11-11 Round 2 (holistic-1111b)

出所: holistic-code-review DRYスキャン3テーマ。Round 1 (SoC系01-03) とは別バッチ (直列)。
NNは本日継続採番 (04〜)。前台帳 `2026-11-11-00-backlog-holistic-1111.md` は書き換えない。
検証コマンド: `npm run type-check` / `npm run lint` / `npm test` / `npm run build`。
アーカイブ先: `dev-docs/archived/pbi/`。

## RICE採点表

| 順 | ID | 候補 | 種別/規模 | R | I | C | E | RICE | 依存 |
|----|----|------|-----------|---|---|---|---|------|------|
| 1 | D1 | collection-target selectビルダー重複解消 | refactor/S | 4 | 1 | 1.0 | 2 | 2.0 | R1-02の後 (ChromeWiring競合回避) |
| 2 | D2 | 日時フォーマット4系統の正規seam集約 | refactor/M | 8 | 1 | 0.8 | 5 | 1.28 | - |
| 3 | D3 | region render+wire骨格の共通化 | refactor/S | 3 | 1 | 0.8 | 3 | 0.8 | D1の後 (同view群に触るため) |

## 最終実行順 (NN)

`04`(D1)→`05`(D2)→`06`(D3)。D1→D3は同一view群のため直列。D2は単独でも可だが摩耗回避のためD1と同バッチには入れず順次実行。
R1-02とD1は `sqliteHistoryChromeWiring.ts` で重なるため Round 1 統合完了後に着手。

## 依存マップ

- 04 → R1-02完了後 (ファイル重複)。
- 06 → 04完了後 (ask/report view群の重複)。

## 台帳送り (今回対象外)

- sqliteHistoryModel肥大 + lifecycle ring迂回: Round 3で段階着手 (fetch側のring寄せに限定)。
- `2026-11-08-18-backlog-default-doh.md`: 駐留継続。

## DoD反映漏れ棚卸し結果

- Round 1統合時点と同様。重複アーカイブなし。

## 実装時の逸脱・送りの記録

- 04/06積み重ね: 同一view2件 (`askHistoryPanelView.ts` / `researchReportPanelView.ts`) に04と06が積み重なったため、04コミットは排他ファイルのみ、view2件は06コミットに同梱 (両者とも各時点で緑確認済み)。
- 05の見送り (台帳送り): `archiveSessionPanel.ts:69` のUTC表示はseam化すると表示時刻が変わるため無改変。localeソース正規化も同様。`sqliteHistoryPanelView.ts:72` はR1-02成果のため無改変。再検討トリガー: 日時表示の仕様変更時または次回holistic。
- 06の対象外: PBI記載の `tagsPanel.ts` は同名ファイル不存在のため対象外 (role=status残存なしを確認)。
