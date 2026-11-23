# PBI: Release 42908187378 のストアアップロード失敗の復旧

- 状態: 実装済み (検証待ち: 次回リリースでの緑確認)
- 種別: 非機能追加 (リリース運用)
- 見積もり: 1 SP
- 起票日: 2026-11-16
- 対象ラン: https://github.com/armaniacs/yasumaro/actions/runs/42908187378 (Release, v6.9.75, attempt 2)

## 原因 (2026-11-16 確定)

CIログの原文で確定。再実行の冪等性欠如であり、認証情報でもパッケージ内容でもない。

- **Chrome**: `PKG_INVALID_VERSION_NUMBER` ―「published package: 6.9.75」に対して同バージョンを再アップロードしたため拒否。attempt 1 が既に公開まで進めていたところへ attempt 2 が同 CRX を上げ直した
- **Edge**: `InProgressSubmission` ― "Can't publish extension as your extension submission is in progress"。前回試行の submission がサーバー側で実行中のまま publish を呼んだため拒否

両方とも「前回試行が部分的/完全に成功した後の再実行」に起因する。スクリプト本体・しきい値・成果物名の変更は不要だった。

## 修正内容

- `scripts/publish/cws.mjs`: アップロード拒否が `PKG_INVALID_VERSION_NUMBER` かつ store の published 版が自バージョンと一致する場合、目的 (公開済み) が達成済みとして成功扱いにする (`publishedVersionOnRecord` をエクスポート・単体テスト済み)。不一致・その他は従来どおり失敗
- `scripts/publish/edge.mjs`: publish の終端失敗が `InProgressSubmission` の場合のみ60秒待って再投稿する (最大3回)。最終試行は従来どおり失敗内容を出して失敗。アップロード側の挙動は不変 (`waitForOperation` に任意の終端分類フックを追加)
- テスト: `scripts/__tests__/publish-stores.test.ts` に7件追加 (計49件緑)。`npm run lint` エラー0、`tsc` 緑

## 方針 (2026-11-16)

ストアへのアップロードは GitHub release のプロセスに含め続ける (無効化案は却下)。CLI (crates.io) は緑のため、失敗しているのはストア認証情報またはストア側検証であり、復旧は secrets の更新とストア側の確認で行う。スクリプト本体・しきい値・成果物名の変更は不要と判断した (正常版 v6.9.72 と同一コード、テスト42件緑)。

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

### S1: 同バージョンの再アップロードが成功扱いになる (Chrome)

Given ストア公開済みが 6.9.75 の状態で
When 同バージョンの CRX をアップロードし `PKG_INVALID_VERSION_NUMBER` が返り
Then 「already published」として成功し、publish には進まない

### S2: 実行中の submission があっても publish が通る (Edge)

Given 前回試行の submission が実行中の状態で
When publish が `InProgressSubmission` で終端失敗し
Then 60秒待って再投稿し、空き次第 `Publish submitted` になる (最大3回。解消しなければ従来どおり失敗)

### S3: 従来の失敗は従来どおり失敗する

Given 上記以外の拒否 (別バージョン、検証エラー、認証失敗など) が返り
When 各ステップが実行され
Then 従来と同一メッセージで失敗する (テストで固定)

## 所有者の確認手順

1. 当該 run の CI ログを開き、Chrome 側の `OAuth token refresh failed` の有無と Edge 側の `Upload failed:` / `Publish failed:` に続く status fields を読む
2. Chrome が認証失敗の場合: GCP コンソールで OAuth 同意画面が Production か確認し、refresh token を再発行して `CHROME_REFRESH_TOKEN` (必要なら client id/secret) を更新する
3. Edge がパッケージ検証失敗の場合: status fields の理由を直す (manifest / 権限 / バンドル内容)。API キー起因なら `EDGE_API_KEY` / `EDGE_CLIENT_ID` を更新する
4. 失敗したジョブだけ再実行 (Re-run failed jobs) する。全量再実行は不要

## 制約

- secrets の値自体はリポジトリに書かない (値は GitHub の secrets 画面でのみ扱う)
- ストア側の審査・検証ルールに合わせるためのコード変更が必要になった場合は別 PBI に切り出す

## 完了条件

- [x] CI ログの原文で両失敗の原因が特定されている (Chrome: 同版再アップロード拒否、Edge: InProgressSubmission)
- [ ] Release ワークフローの再実行で Chrome / Edge の両アップロードが緑になる (次回リリース時に確認)
