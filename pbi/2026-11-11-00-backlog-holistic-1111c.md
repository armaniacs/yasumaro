# 台帳: 大局的改善ラウンド 2026-11-11 Round 3 (holistic-1111c)

出所: SoCテーマ3の残部 (sqliteHistoryModel肥大 + lifecycle ring迂回) の段階着手。
Round 1・2とは別バッチ (直列・最終)。NNは本日継続採番 (07)。
前台帳 (`2026-11-11-00-backlog-holistic-1111.md` / `2026-11-11-00-backlog-holistic-1111b.md`) は書き換えない。
検証コマンド: `npm run type-check` / `npm run lint` / `npm test` / `npm run build`。
最終ゲート (本ラウンド終了直前): フルテスト + ビルド。
アーカイブ先: `dev-docs/archived/pbi/`。

## RICE採点表

| 順 | ID | 候補 | 種別/規模 | R | I | C | E | RICE | 依存 |
|----|----|------|-----------|---|---|---|---|------|------|
| 1 | S3a | Model私設ガードの共有seam注入化 (ring寄せ第1段階) | refactor/S | 3 | 1 | 0.8 | 2 | 1.2 | - |

## 最終実行順 (NN)

`07`(S3a) 単独。フル分割は見送り、ring寄せの前提 (ガード注入) のみに限定。
残部 (問合せ核と購読/選択/書込み操作の責務分割) は台帳送りとして次回以降に再評価 (再検討トリガー: Model変更時)。

## 依存マップ

なし (sqliteHistoryModel.ts + reloadGuard周辺のみ。Round 2の05と同一ファイル群に触らないよう、Model本体のみに限定しPanelView側は触らない)。

## 台帳送り (今回対象外)

- Model責務分割の残部 (問合せ核/購読/選択/書込みの分離): 次回以降。
- DRYテーマ2・3の残部 (05・06で見送りが出た場合): 各PBIの報告に従い次回に再評価。
- `2026-11-08-18-backlog-default-doh.md`: 駐留継続。

## DoD反映漏れ棚卸し結果

- Round 1統合時点と同様。重複アーカイブなし。
