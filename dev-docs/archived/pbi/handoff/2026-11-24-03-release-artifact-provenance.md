# 引き継ぎ: 2026-11-24-03 リリース成果物の SHA256 と provenance

- 状態: 完了（2026-11-26: v6.9.78 実地検証・README/docs 目次配線完了）
- 最終更新: 2026-11-26
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

## 実リリース検証記録(2026-11-26: v6.9.78)

1. GitHub Release `v6.9.78` に `SHA256SUMS` と chrome / firefox / edge の 3 zip が添付されていることを確認
2. `gh release download v6.9.78` で取得し、`shasum -a 256 -c SHA256SUMS` を実行: 3 行すべて `OK` を確認
3. `gh attestation verify` を chrome / firefox / edge の 3 zip に対して実行: 3 本すべて `Verification succeeded!`（`.github/workflows/release.yml@refs/tags/v6.9.78`、SLSA provenance v1）を確認
4. `docs/RELEASE_VERIFICATION.md` を日英バイリンガル化し、`README.md`（方法4 / Option 4 / 文書一覧 / Documentation）、`docs/guides.html`、`dev-docs/DOCUMENTATION_GUIDE.md` へリンクを追加
5. `.crx` と `SHA256SUMS` 自体は attestation 対象外である旨を `docs/RELEASE_VERIFICATION.md`（日英）に明記済み

## 残りの手順

- なし（完了・アーカイブ対象）

## 未確認・注意

- actionlint は未インストールで、実行していない
- release.yml の構造そのものを検査するテストは無い。必要なら、SHA 固定と permissions を pin するテストを scripts/__tests__ に追加する
