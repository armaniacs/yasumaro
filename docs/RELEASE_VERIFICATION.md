# リリース成果物の検証 / Release Artifact Verification

[日本語](#日本語) | [English](#english)

## 日本語

GitHub Releases に添付される zip(`yasumaro-<version>-chrome.zip` / `-firefox.zip` / `-edge.zip`)は、次の 2 つの方法で改ざんの有無と出所を確認できます。

### 1. チェックサム(SHA256SUMS)

各リリースには、上記 3 つの zip の SHA-256 を記録した `SHA256SUMS` が添付されています。zip と `SHA256SUMS` を同じディレクトリにダウンロードし、そのディレクトリで次を実行します。

```bash
shasum -a 256 -c SHA256SUMS
```

すべての行が `OK` になれば、ダウンロードした zip はリリース時に生成されたものと一致しています。一部の zip だけをダウンロードした場合、未ダウンロードの行は読み込み失敗として表示されるため、ダウンロードした zip の行だけを確認してください。

### 2. ビルド来歴(GitHub artifact attestation)

zip は GitHub Actions のリリースワークフローでビルドされ、build provenance の attestation が付与されています。[GitHub CLI](https://cli.github.com/) で次を実行します。

```bash
gh attestation verify yasumaro-<version>-chrome.zip --repo armaniacs/yasumaro
```

検証に成功すると、その zip が `armaniacs/yasumaro` のワークフローでビルドされたことが確認できます。firefox / edge の zip も同様にファイル名を置き換えて検証します。

`.crx` と `SHA256SUMS` 自体は attestation の対象外です。改ざん耐性の根拠は attestation 側にあり、`SHA256SUMS` は同一性確認用です。

## English

The zip archives attached to GitHub Releases (`yasumaro-<version>-chrome.zip` / `-firefox.zip` / `-edge.zip`) can be verified for integrity and provenance using the two methods below.

### 1. Checksums (SHA256SUMS)

Each release includes a `SHA256SUMS` file listing the SHA-256 digests of the three zip archives. Download the zip archive(s) and `SHA256SUMS` into the same directory and run:

```bash
shasum -a 256 -c SHA256SUMS
```

When all lines report `OK`, the downloaded archives match those produced during the release build. If you only downloaded one browser's zip, lines for the missing archives will show a read error; inspect only the line for the archive you downloaded.

### 2. Build Provenance (GitHub Artifact Attestation)

The zip archives are built by the GitHub Actions release workflow and carry GitHub build provenance attestations. Verify them with the [GitHub CLI](https://cli.github.com/):

```bash
gh attestation verify yasumaro-<version>-chrome.zip --repo armaniacs/yasumaro
```

A passing verification proves the archive was built by the release workflow in `armaniacs/yasumaro`. Replace the filename to verify the firefox or edge zip archive as well.

`.crx` files and `SHA256SUMS` itself are excluded from attestation. Cryptographic tamper-evidence comes from the attestation; `SHA256SUMS` is for integrity checking.
