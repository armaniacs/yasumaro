# PBI: Release 42908187378 のストアアップロード失敗の復旧

- 状態: 未着手 (所有者による secrets / ストア側の確認待ち)
- 種別: 非機能追加 (リリース運用)
- 見積もり: 1 SP
- 起票日: 2026-11-16
- 対象ラン: https://github.com/armaniacs/yasumaro/actions/runs/42908187378 (Release, v6.9.75, attempt 2)

## 背景

Release ワークフローの「Upload to Chrome Web Store」と「Upload to Edge Add-ons」が失敗し、以降の AMO 提出がスキップされた。GitHub Release の作成と crates.io への CLI 公開は成功している。

リポジトリ側の調査結果 (2026-11-16):

- `scripts/publish/cws.mjs` と `scripts/publish/edge.mjs` は正常版 v6.9.72 (成功) と同一コード。回帰ではない
- `scripts/__tests__/publish-stores.test.ts` 42件緑、`npm run lint` エラー0
- バージョン配線 (`package.json` → `steps.version.outputs.version` → `dist/yasumaro-<VERSION>-chrome.crx` / `-edge.zip`) は一貫し、「List output archives」も緑
- `lib.mjs` のエラーハンドリングに握りつぶしはない (輸送エラー・欠落ファイル・API 拒否はそれぞれ異なるメッセージで fail-fast する)
- よって原因はコードではなく、認証情報またはストア側の検証にある

タイミングからの推定 (CI ログの原文確認が必要):

- Chrome (約2秒で失敗): OAuth トークンリフレッシュの即時拒否。`CHROME_CLIENT_ID` / `CHROME_CLIENT_SECRET` / `CHROME_REFRESH_TOKEN` のいずれかが無効の可能性が高い (GCP の OAuth 同意画面が Testing のままだとリフレッシュトークンは7日で失効する)
- Edge (約32秒で失敗): 認証は通過し、アップロード受理後の operation ポーリングで終端失敗した可能性が高い。CI ログの `Upload failed:` に続く status fields が原因を示す (パッケージ検証の可能性)

## 受け入れシナリオ

### S1: Chrome Web Store へのアップロードが成功する

Given 有効な `CHROME_CLIENT_ID` / `CHROME_CLIENT_SECRET` / `CHROME_REFRESH_TOKEN` が secrets に設定され
When Release ワークフロー (または失敗ジョブの再実行) が回り
Then 「Upload to Chrome Web Store」が緑になる

### S2: Edge Add-ons へのアップロードが成功する

Given CI ログの `Upload failed:` / `Publish failed:` の status fields を確認し、パッケージ起因なら修正して
When Release ワークフロー (または失敗ジョブの再実行) が回り
Then 「Upload to Edge Add-ons」が緑になる

## 所有者の確認手順

1. 当該 run の CI ログを開き、Chrome 側の `OAuth token refresh failed` の有無と Edge 側の `Upload failed:` / `Publish failed:` に続く status fields を読む
2. Chrome が認証失敗の場合: GCP コンソールで OAuth 同意画面が Production か確認し、refresh token を再発行して `CHROME_REFRESH_TOKEN` (必要なら client id/secret) を更新する
3. Edge がパッケージ検証失敗の場合: status fields の理由を直す (manifest / 権限 / バンドル内容)。API キー起因なら `EDGE_API_KEY` / `EDGE_CLIENT_ID` を更新する
4. 失敗したジョブだけ再実行 (Re-run failed jobs) する。全量再実行は不要

## 制約

- secrets の値自体はリポジトリに書かない (値は GitHub の secrets 画面でのみ扱う)
- ストア側の審査・検証ルールに合わせるためのコード変更が必要になった場合は別 PBI に切り出す

## 完了条件

- [ ] CI ログの原文で両失敗の原因が特定されている
- [ ] Release ワークフローの再実行で Chrome / Edge の両アップロードが緑になる
