# PBI: Release 42908187378 のストアアップロード失敗の復旧

- 状態: 実装中 (ストアアップロードの無効化で赤を消す方針に変更)
- 種別: 非機能追加 (リリース運用)
- 見積もり: 1 SP
- 起票日: 2026-11-16
- 対象ラン: https://github.com/armaniacs/yasumaro/actions/runs/42908187378 (Release, v6.9.75, attempt 2)

## 方針転換 (2026-11-16)

CLI (crates.io) は正常にリリースできているため、失敗しているストアアップロード2件は無効化する。認証情報の復旧 (下記「所有者の確認手順」) は任意の後続作業とし、本 PBI の完了条件には含めない。再開時はリポジトリ変数 `ENABLE_STORE_UPLOAD` を `'true'` に戻すだけで復活する (スクリプト本体・しきい値・成果物名は不変)。

- `Upload to Chrome Web Store`: `vars.ENABLE_STORE_UPLOAD == 'true'` のときのみ実行 (未設定ならスキップ)
- `Upload to Edge Add-ons`: 既存の `always() && hashFiles(...)` に同変数の条件を追加
- AMO 提出は従来どおり `AMO_AUTO_SUBMIT` が gating する (変更なし)

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

### S1: ストアアップロードがスキップされ、Release が緑になる

Given リポジトリ変数 `ENABLE_STORE_UPLOAD` が未設定 (または `'true'` 以外) の状態で
When Release ワークフローが回り
Then 「Upload to Chrome Web Store」と「Upload to Edge Add-ons」はスキップされ、ジョブ全体が緑になる

### S2: 変数を戻せばストアアップロードが復活する

Given リポジトリ変数 `ENABLE_STORE_UPLOAD` を `'true'` に設定し
When Release ワークフローが回り
Then 両アップロードステップが実行される (成否は secrets / ストア側の状態に従来どおり依存する)

## 所有者の確認手順

1. 当該 run の CI ログを開き、Chrome 側の `OAuth token refresh failed` の有無と Edge 側の `Upload failed:` / `Publish failed:` に続く status fields を読む
2. Chrome が認証失敗の場合: GCP コンソールで OAuth 同意画面が Production か確認し、refresh token を再発行して `CHROME_REFRESH_TOKEN` (必要なら client id/secret) を更新する
3. Edge がパッケージ検証失敗の場合: status fields の理由を直す (manifest / 権限 / バンドル内容)。API キー起因なら `EDGE_API_KEY` / `EDGE_CLIENT_ID` を更新する
4. 失敗したジョブだけ再実行 (Re-run failed jobs) する。全量再実行は不要

## 制約

- secrets の値自体はリポジトリに書かない (値は GitHub の secrets 画面でのみ扱う)
- ストア側の審査・検証ルールに合わせるためのコード変更が必要になった場合は別 PBI に切り出す

## 完了条件

- [ ] Release ワークフローが `ENABLE_STORE_UPLOAD` 未設定で緑になる (両アップロードがスキップされる。次回リリース時に確認)
- [x] `vars.ENABLE_STORE_UPLOAD == 'true'` の評価が YAML として妥当である (パーサ検証済み)
- [x] 認証情報の復旧手順が「所有者の確認手順」に残り、再開方法が明示されている
