# PBI: リリース zip に SHA256SUMS と build provenance を付ける

## ユーザーストーリー
GitHub Releases の zip を「パッケージ化されていない拡張機能を読み込む」でインストールする利用者として、ダウンロードした zip がリリースワークフローで作られたものと同一で、途中で改ざんされていないことを自分で確かめたい、なぜならストアの審査を経ない配布経路では、zip の差し替えや中間者による改ざんを利用者が検知する手段がほかにないから。

## 優先度
- 順位: 02/12
- RICE: 6.4(Reach 4 × Impact 2 × Confidence 0.8 / Effort 1)
  - Reach 4: 主な配布経路は 3 ストアで、zip を直接読み込む利用者は一部
  - Impact 2: 改ざん検知の手段がない状態を解消する(セキュリティ必須)
  - Confidence 0.8: GitHub の attestation がリポジトリの公開設定・プランで使えるかを実リリースで確認する必要がある
  - Effort 1: release.yml に 2 ステップ、利用者向け文書 1 本
- 根拠と依存: 01(開発中機能の判定)と同点。リスク軽減の大きさは本 PBI が上だが、01 が 04・08 の前提のため 2 位。本 PBI の依存はない

## ビジネス価値
- 審査を経ない配布経路でも、利用者が改ざんと出所を検証できる
- 正式版の配布物として、配布元の主張(このワークフローでビルドした)が暗号学的に裏付けられる
- 測定方法: 次のリリースで Release の添付物に `SHA256SUMS` が並び、`shasum -a 256 -c SHA256SUMS` と `gh attestation verify` がともに成功すること

## BDD受け入れシナリオ

```gherkin
Scenario: ダウンロードした zip がチェックサムと attestation で検証できる
  Given v<version> の GitHub Release に chrome / firefox / edge の zip と SHA256SUMS が添付されている
  When  利用者が zip と SHA256SUMS を同じディレクトリに置いて `shasum -a 256 -c SHA256SUMS` を実行する
  Then  3 行すべてが OK になる
  And   `gh attestation verify yasumaro-<version>-chrome.zip --repo armaniacs/yasumaro` が成功する

Scenario: 改ざんされた zip は検証で失敗する
  Given 利用者がダウンロードした zip の中身が 1 バイトでも変わっている
  When  `shasum -a 256 -c SHA256SUMS` を実行する
  Then  その zip の行が FAILED になり、コマンドは 0 以外で終わる
  And   `gh attestation verify` もその zip について失敗する

Scenario: 一部の zip だけをダウンロードした場合も手順どおりに判断できる
  Given 利用者が chrome の zip だけをダウンロードしている
  When  `shasum -a 256 -c SHA256SUMS` を実行する
  Then  未ダウンロードの行は読み込み失敗として表示される
  And   利用者向け文書の説明に従い、ダウンロードした zip の行だけで判断できる
```

## 受け入れ基準
- [x] release ジョブが chrome / firefox / edge の 3 つの zip から `SHA256SUMS` を生成し、Release に添付する
- [x] `SHA256SUMS` のファイル名欄は Release の添付名と一致する(`dist/` 接頭辞なし)
- [x] 同じ 3 つの zip に build provenance の attestation が付与される
- [x] 新規 action は commit SHA で固定し、行末コメントにタグ名を書く(既存の運用と同じ)
- [x] `id-token: write` と `attestations: write` は release ジョブだけに付与し、`record-metrics` ジョブには付与しない。トップレベルの `permissions` は広げない
- [x] 利用者向けの検証手順(`shasum -a 256 -c SHA256SUMS`、`gh attestation verify <zip> --repo armaniacs/yasumaro`)が `docs/RELEASE_VERIFICATION.md` にあり、README の「方法4: GitHub Releases の zip を読み込む」から参照される
- [x] `.crx` を attestation の対象に含めるかが決まり、文書に明記されている

## テスト戦略(t_wadaスタイル)

### E2Eテスト
- 実リリース(タグ push)後に、Release から zip と `SHA256SUMS` をダウンロードし、macOS で `shasum -a 256 -c SHA256SUMS` と `gh attestation verify` を手動で実行する(自動化しない。結果を handoff に記録する)

### 統合テスト
- release.yml の構造を pin するテストを追加する場合は、既存の `scripts/__tests__/` の流儀に合わせる。検査対象: 全 `uses:` が 40 桁 SHA であること、`id-token` / `attestations` が release ジョブにのみあること、`files:` に `dist/SHA256SUMS` があること

### 単体テスト
- 対象なし(ワークフロー定義と文書のみ)

## 実装アプローチ
- **Outside-In**: 先に利用者向けの検証手順(文書)を書き、その手順が成立するようにワークフローを組む
- **Red-Green-Refactor**: 構造テストを追加する場合、テストを先に書いて赤を確認し、ワークフローを直して緑にする

## 見積もり
1 ストーリーポイント(要チームでの見積もり)

## 技術的考慮事項
- 依存関係: なし
- セキュリティ: action は SHA 固定(タグは付け替え可能なため)。permissions はジョブ単位で最小化する。ジョブ単位の `permissions` はトップレベルを置き換えるため、release ジョブでは `contents: write` を明示し直す必要がある
- 制約: GitHub artifact attestation はリポジトリの公開設定・プランによって使えない場合がある。失敗時はまずリポジトリ設定を確認する
- 非機能要件: 文書は Shift-JIS 範囲の文字のみ(`npm run check:docs-chars`)

## 実装者向け注記

### 現状コードの確認
確認済み(2026-11-24)。本 PBI の作成時点で、同じブランチ `1124a` のコミット 1a9a52c27 に実装が入っている。着手前に必ず handoff ファイルを読み、残りの手順から再開すること。

```bash
rtk grep -n "permissions\|id-token\|attestations\|SHA256SUMS\|attest-build-provenance\|uses:" /Users/yaar/Playground/yasumaro/.github/workflows/release.yml
git -C /Users/yaar/Playground/yasumaro show --stat 1a9a52c27
rtk grep -rn "RELEASE_VERIFICATION" /Users/yaar/Playground/yasumaro/README.md /Users/yaar/Playground/yasumaro/docs
```

- ワークフロー: `.github/workflows/release.yml`(タグ `v*` の push で起動。release ジョブと record-metrics ジョブ)
- zip の生成: `npx wxt zip -b chrome` / `-b firefox` / `-b edge` が `dist/yasumaro-<version>-<browser>.zip` を出力。chrome は `scripts/build-crx3.mjs` で `.crx` も作る
- Release 作成: `softprops/action-gh-release@8a0cd651e5b2365bd640854a3fa5dfc70e4875f3 # v3.0.4` の `files:`
- 追加済みのステップ: 「Generate SHA256SUMS」(`working-directory: dist`、`sha256sum`)、「Attest build provenance」(`actions/attest-build-provenance@4d101475d8b20a2381f78447822ac1eab6504dd8 # v4.2.2`)
- 利用者向け文書: `docs/RELEASE_VERIFICATION.md`(作成済み)。README の方法4 からのリンクは未確認(上の grep で README に一致がなければ未対応)

### 範囲
- 含める: SHA256SUMS の生成と添付、zip の attestation、権限の最小化、利用者向け手順と README からの導線
- 含めない: ストアに提出するパッケージの署名(ストア側が署名する)、CLI(crates.io)の provenance、`.crx` 署名鍵の運用変更

### 実装手順
1. handoff ファイルを読み、実装済みの項目を確認する
2. README の日本語「#### 方法4: GitHub Releases の zip を読み込む」と英語「#### Option 4: Load the GitHub Releases zip」に `docs/RELEASE_VERIFICATION.md` へのリンクを追加する。README の「### 文書一覧」と「### Documentation」にも登録する。`dev-docs/DOCUMENTATION_GUIDE.md` の文書一覧の登録ルールに従う
3. `.crx` を対象に含めるかを owner に確認し、含める場合は `subject-path` と `sha256sum` の対象と文書を揃える
4. 必要なら release.yml の構造テストを追加する
5. 次のタグ push 後、BDD のハッピーパスを手動で確認し、handoff に結果を記録する

### 落とし穴
- `sha256sum` を `dist/` の外で実行すると、`SHA256SUMS` のファイル名欄に `dist/` が入り、利用者のディレクトリで `-c` が失敗する
- ジョブ単位の `permissions` を書くと、そのジョブではトップレベルの指定が消える。`contents: write` を書き忘れると Release 作成が 403 になる
- attestation のステップは Release 作成より前に置く。後ろに置き、そのステップが失敗すると、検証できない Release が公開済みになる
- `SHA256SUMS` 自体は attestation の対象外。改ざん耐性の根拠は attestation 側にあり、`SHA256SUMS` は同一性の確認用だと文書で区別する
- action の SHA は `gh api repos/<owner>/<repo>/git/ref/tags/<tag>` で取得し、注釈付きタグの場合は tag object ではなく commit の SHA を使う

## Definition of Done
- [x] 全 BDD シナリオが、実リリースでの手動確認で検証されている(結果は handoff に記録)
- [x] `npm run validate` が緑
- [x] コードレビュー完了(SHA 固定と permissions の範囲を確認)
- [x] ドキュメント更新済み(`docs/RELEASE_VERIFICATION.md`、README の方法4 からのリンク)

## 引き継ぎ
状態: 完了(2026-11-26)。v6.9.78 の 3 zip に対する `shasum -a 256 -c SHA256SUMS`(3/3 OK)と `gh attestation verify`(3/3 成功)を確認済み。`docs/RELEASE_VERIFICATION.md` の日英化および `README.md` / `docs/guides.html` / `dev-docs/DOCUMENTATION_GUIDE.md` からのリンク配線完了。詳細は [handoff/2026-11-24-03-release-artifact-provenance.md](handoff/2026-11-24-03-release-artifact-provenance.md) を参照。
