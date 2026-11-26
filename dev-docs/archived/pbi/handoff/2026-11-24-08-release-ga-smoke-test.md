# handoff: 08 正式版前の実機スモークテスト

## 状態
チェックリスト作成済み。Chrome E2E 全量は実施済み(製品の赤なし、下記)。実機は未着手(owner が実施する)。

## 作業記録(2026-11-24)

- `dev-docs/manual-tests/release-ga-smoke.md` を作成した(準備・必須 10 フロー・結果記録表・自動テスト対応表・実施ログ)。形式は `docs/MANUAL_TEST_ARCHIVE.md` に合わせ、絵文字なし
- `dev-docs/TESTING_GUIDE.md` の Manual Testing Required からリンクした
- 04 は 6.9.77 に採番済み(owner 指定で先行実施)。PBI 04 の「07・08 の完了後にのみ採番」は owner の明示の指示で先行した。08 で修正が入った場合は 6.9.78 以降に再度採番する

## Chrome E2E 全量の結果(2026-11-24、owner の指示で実施)

- 全量 174 件: 149 passed、14 skipped、11 failed。失敗 11 件はすべて content-script の probe 初期化 30 秒タイムアウトで、再実行ではすべて緑(マシン負荷によるもの)
- 本物の問題 1 件を修正した: 類似クラスタの見出し表明が英語決め打ちで日本語 UI 環境で落ちていた。日英両対応の正規表現に直して緑を確認(`d6045f41b`)
- capture-late-rescan の A(5 秒の flood-guard 待ち)は負荷時に不安定。再実行では緑。待ち方の改善は PBI 20 を起票済み
- PBI 20(probe 初期化の切り分けと重い spec の分離)は実装済み(`42fd9774f`)。高速 165 件と heavy 12 件に分離し、CI の起動形状は維持

## 作業記録(2026-11-25: 実機スモーク自動化 + 発見バグ 2 件の修正)

- 自動スモークランナー `npm run smoke:ga`(`scripts/ga-smoke/`)を実装した。`OW_E2E_PROBE=0` の配布用 ZIP 3 本を自動ビルド・衛生検証し、実機 Chrome 158 / Edge 158 / Firefox Developer Edition 159 で主要 10 フロー + 日英 UI 確認 + Shift-JIS レポート生成を実行できる
- 初回実機スモークで発見した 2 件の実機不具合について修正 PBI を起票・実装完了した:
  - [2026-11-25-01-fix-firefox-header-detector-extraheaders.md](../2026-11-25-01-fix-firefox-header-detector-extraheaders.md): Firefox で `webRequest.onHeadersReceived` が `'extraHeaders'` 例外により未登録となり `Cache-Control: private` 検出と Webhook が全件 `blocked (privacy-verdict-absent)` になる不具合をフォールバックで修正
  - [2026-11-25-02-fix-post-delete-all-encryption-key-cache.md](../2026-11-25-02-fix-post-delete-all-encryption-key-cache.md): 全データ削除後に他コンテキスト(SW)の暗号化キーキャッシュが残留する不具合を `chrome.storage.onChanged` 無効化と `clearAllLocalData()` 即時破棄で修正
- 修正後の再ビルド配布 ZIP(`OW_E2E_PROBE=0`)で `npm run validate`(1,366 ファイル / 19,224 テスト緑)および Chrome 158 / Edge 158 / Firefox 159 実機スモークを通過確認(Firefox 項目 10 Webhook も 886ms で PASS 確認済み)

## 残りの手順(owner が実施)

1. コード修正が入ったため、6.9.78(または最終決定の GA 版)へ再採番し、`npm run smoke:ga -- --live --write-log` で最終確認(ブラウザ UI 3 経路の対話ガイド約 30 秒/ブラウザ + 任意の実 Obsidian / 実 AI 疎通)を実施する
2. `dev-docs/manual-tests/release-ga-smoke.md` の実施ログを確認し、タグ push とストア提出に進む

## 要確認
- なし。実施そのものが owner の作業
