# 引き継ぎ: 2026-11-24-04 正式版リリース準備

- 状態: 文書の更新まで完了。採番待ち(07・08 の完了後)
- 最終更新: 2026-11-24
- 対象 PBI: [../2026-11-24-04-release-ga-preparation.md](../2026-11-24-04-release-ga-preparation.md)

## 済んだこと

ブランチ `1124a` のコミット 6d39eb66e(docs:)に入っています。

- README.md の日本語「Obsidianへの追加の仕組み」節を、If-Match 条件付き書き込みと 412 の 1 回再書き込みに合わせて更新した
  - 強い ETag があれば If-Match を付ける、412 なら GET から保存までを 1 回だけやり直す、2 回目も 412 なら保存失敗として扱う
  - ETag が無い・弱い・新規ノートのときは従来どおりで、小さな競合リスクが残る
  - dev-docs/API_ENDPOINTS.md の If-Match 節へリンク

## 済んだこと(追加)

ブランチ `1124a` で実施。

- README English 側に「How Obsidian appends work」節を新設し、日英で内容を揃えた(競合通知の表面化を含む最新仕様)
- README の機能一覧を裁定(4 機能とも開発中のまま)に合わせた。English 側の 3 機能に「in development」を付け、日英で対称にした。webhook export は機能一覧に載せないまま
- `CHROMEWEBSTORE.md` を更新: Target version を 6.9.76 に同期、webhook を experimental と明記(機能一覧と説明文)、Privacy summary の旧方式の説明を許可リスト方式に更新
- `AGENTS.md` の Release 節の `manifest.json` bump の記述を実際の版管理(package.json が SSOT)に修正

## 残りの手順

1. SECURITY.md の Supported Versions 表を、正式版の版番号に合わせて更新する(採番時に実施)
2. CHANGELOG に正式版のエントリを書く(採番時に実施。`[Unreleased]` は蓄積中)
3. `docs/RELEASE_POLICY.md` に v7 系の方針の節を追加する(内容は owner が決める)
4. 採番(7.0.0 案)は、2026-11-24-07(監査 run-3)と 2026-11-24-08(実機スモーク)の完了後にのみ行う。同期対象は CONTRIBUTING.md のリリースフローに従う

## owner への確認事項

- 正式版の版番号(案: 7.0.0)と v7 系のバージョニング方針の内容
- SECURITY.md の 6.x の扱い(サポート終了日または期間)
- Edge / AMO の掲載文の管理場所(リポジトリ内で見つからず。ローカル専用ファイルを除く)

## 注意

- worktree は `main` から分岐するため、`1124a` にしかない実装(If-Match など)は入っていない。README のコミットは `1124a` の上に載せてあり、`main` へ入れるときは `1124a` と一緒に入れること
