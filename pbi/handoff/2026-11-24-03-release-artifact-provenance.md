# 引き継ぎ: 2026-11-24-03 リリース成果物の SHA256 と provenance

- 状態: 実装済み・実リリースでの確認待ち
- 最終更新: 2026-11-24
- 対象 PBI: [../2026-11-24-03-release-artifact-provenance.md](../2026-11-24-03-release-artifact-provenance.md)

## 済んだこと

ブランチ `1124a` のコミット 1a9a52c27(ci:)に入っています。

- `.github/workflows/release.yml`
  - release ジョブにだけ `contents: write` / `id-token: write` / `attestations: write` を付けた。トップレベルの `permissions: contents: write` はそのまま
  - 「List output archives」の後に「Generate SHA256SUMS」を追加。`working-directory: dist` で chrome / firefox / edge の 3 つの zip から `sha256sum` で生成する
  - 「Attest build provenance」を追加。`actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8 # v4.2.2`(SHA は gh api でタグから取得済み)。対象は同じ 3 つの zip
  - softprops/action-gh-release の `files` に `dist/SHA256SUMS` を追加
- `docs/RELEASE_VERIFICATION.md` を新規作成(`shasum -a 256 -c SHA256SUMS` と `gh attestation verify <zip> --repo armaniacs/yasumaro`)

確認済み: YAML パース、ステップ順、docs の文字種、release.yml を参照する既存テスト 59 件。

## 残りの手順

1. 次のリリースで、Release の添付物に `SHA256SUMS` が並ぶことを確認する
2. ダウンロードした zip で、macOS の `shasum -a 256 -c SHA256SUMS` が OK になることを確認する
3. attestation ステップが成功し、`gh attestation verify` が通ることを確認する。失敗したら、リポジトリで attestation が使えるか(公開リポジトリかどうか)を先に確認する
4. `docs/RELEASE_VERIFICATION.md` を docs の目次と README のインストール方法4(GitHub Releases の zip)から参照する。DOCUMENTATION_GUIDE の目次登録ルールを確認すること
5. `.crx` を対象に含めるかを決める(現状は zip のみ。docs にもそう明記)

## 未確認・注意

- actionlint は未インストールで、実行していない
- release.yml の構造そのものを検査するテストは無い。必要なら、SHA 固定と permissions を pin するテストを scripts/__tests__ に追加する
