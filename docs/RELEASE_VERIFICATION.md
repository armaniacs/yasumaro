# リリース成果物の検証

GitHub Releases に添付される zip(`yasumaro-<version>-chrome.zip` / `-firefox.zip` / `-edge.zip`)は、次の 2 つの方法で改ざんの有無と出所を確認できます。

## 1. チェックサム(SHA256SUMS)

各リリースには、上記 3 つの zip の SHA-256 を記録した `SHA256SUMS` が添付されています。zip と `SHA256SUMS` を同じディレクトリにダウンロードし、そのディレクトリで次を実行します。

```bash
shasum -a 256 -c SHA256SUMS
```

すべての行が `OK` になれば、ダウンロードした zip はリリース時に生成されたものと一致しています。一部の zip だけをダウンロードした場合、未ダウンロードの行は読み込み失敗として表示されるため、ダウンロードした zip の行だけを確認してください。

## 2. ビルド来歴(GitHub artifact attestation)

zip は GitHub Actions のリリースワークフローでビルドされ、build provenance の attestation が付与されています。[GitHub CLI](https://cli.github.com/) で次を実行します。

```bash
gh attestation verify yasumaro-<version>-chrome.zip --repo armaniacs/yasumaro
```

検証に成功すると、その zip が `armaniacs/yasumaro` のワークフローでビルドされたことが確認できます。firefox / edge の zip も同様にファイル名を置き換えて検証します。

`.crx` と `SHA256SUMS` 自体は attestation の対象外です。
