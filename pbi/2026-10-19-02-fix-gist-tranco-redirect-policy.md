# PBI: Gist 同期と Tranco 更新の fetch が redirect を追従し、資格情報が Location のホストへ再送されうる問題の修正

## ユーザーストーリー

GitHub PAT を保存して Gist 同期を使うユーザーとして、**保存したトークンが、こちらが指定していない宛先へ送られないこと**がほしい、なぜなら Gist の接続テストと同期は `Authorization: token <PAT>` を付けて `https://api.github.com` を叩くが、redirect 方針が platform 既定の `follow` のままだと、30x が返った瞬間にブラウザが `Location` のホストへ**トークンごと**リクエストを再送するから。Tranco 更新も同じく追従し、こちらは資格情報を持たないが、未検証の宛先へリクエストが飛ぶ点は同じ。

## 優先度

- 順位: 2026-10-19 の 02 / 02（同日起票 2 件のうち 2 番目）
- RICE: 320（Reach=80 / Impact=2 / Confidence=100% / Effort=0.5）
  - Reach: Gist 同期を使うプロファイルは限定的（PAT を保存した利用者）ため 80
  - Impact: 2。**PAT が `Location` のホストへ再送されうる**が、`api.github.com` は HSTS 付きの固定ホストで、GitHub 側か TLS が破られない限り 30x は起きない。Tranco は資格情報を持たないため実害は「未検証宛先へのリクエスト」
  - Confidence: 100%（構造確定。`redirect` 未指定を呼び出し引数で確認済み）
  - Effort: 0.5 SP。5 サイトに共通 seam を展開し、テストを足すだけ
- 種別: 🔧非機能追加（fix）
- 難易度: 🟢低
- 副作用: 🟡軽微（`api.github.com` / `tranco-list.eu` が正規の 30x に依存していた場合、その機能だけが失敗する。現在の実装は追従前提ではないため影響は限定的。失敗は既存の transport failure として扱われる）

## 背景（発見の経緯）

PBI [2026-10-18-01](../dev-docs/archived/pbi/2026-10-18-01-fix-ai-fetch-redirect-policy.md) / [2026-10-18-08](../dev-docs/archived/pbi/2026-10-18-08-fix-obsidian-redirect-bearer.md)（AI 経路・Obsidian 経路への `redirect:'error'` 適用）の完了後、独立レビューで「ADR 2026-08-29 の『tranco / gist は固定ホストのままで挙動不変』という記述は誤り」と指摘され、2026-10-19 に ADR の当該記述を訂正した。**コード側は未修正**のため本 PBI に切り出す。

### 機構（コード上で確定）

`redirect` を指定していない残りの fetch サイト:

| ファイル | 行 | 資格情報 | 備考 |
|---|---:|---|---|
| `src/background/syncTargets/gistSyncTarget.ts` | 134 | `Authorization: token ${pat}` | `/user`（接続テスト） |
| 同上 | 162 | `Authorization: token ${pat}` | `/gists`（作成） |
| 同上 | 191 | `Authorization: token ${pat}` | `/gists/${gistId}`（更新） |
| `src/utils/trustDb/trancoUpdater.ts` | 133 | なし | `/api/lists/date/latest` |
| 同上 | 148 | なし | `/download/${listId}/${count}` |

- いずれも `fetchWithTimeout` を `redirect` 指定なしで呼ぶ。`fetchWithTimeout` は残りのオプションを platform `fetch` へ素通しする（`src/utils/fetch.ts:169`）ため、platform 既定の `redirect: 'follow'` が効く。
- 正解の共通 seam は既に存在する: `src/utils/fetch.ts:73` の `NO_REDIRECT_FETCH_POLICY = { redirect: 'error' } as const`（AI 経路 `HttpProviderStrategy.ts:246/315`、Obsidian 経路 `obsidianClient.ts:276/318/370` が使用中）。
- `scripts/update-preset-domains.ts:23` も Tranco を fetch するが、これはビルドスクリプト（Node 実行・拡張機能の権限外）なので対象外。

### 影響

- **Gist の 3 サイト**: `api.github.com` が 30x を返した場合、`Authorization: token <PAT>` が `Location` のホストへ再送される（307/308 ではボディも保持される）。ブラウザはクロスオリジンリダイレクトで `Authorization` を剥がすが、**同一 origin 内の 30x では剥がれない**ため、リダイレクト先のパスが変わっても送信は続く。
- **Tranco の 2 サイト**: 資格情報は無いが、`Location` が private IP を指す場合にリクエストが飛ぶ（ADR 2026-08-29 が塞いだ VULN-016 と同じ形。ただし応答本文はローカルに保存されない）。

## BDD受け入れシナリオ

```gherkin
Scenario: 1. Gist の接続テストが 30x を拒否し、PAT を転送先へ送らない
  Given ユーザーが GitHub PAT を保存しており、Gist 設定の接続テストを実行する
  And   api.github.com が 302 を返し、Location が別ホストを指している
  When  接続テストが応答を受け取る
  Then  接続テストは失敗として扱われる
  And   発行されたリクエストは当初の URL に対する 1 件だけで、Location のホストへのリクエストは無い
  And   Authorization ヘッダーが転送先へ渡っていない

Scenario: 2. Gist の作成・更新も同じ方針を共有する
  Given ユーザーが Gist 同期を実行する
  When  api.github.com が 30x を返す
  Then  どちらの経路も転送せず失敗として扱われる
  And   3 サイトとも同じ共通 seam（NO_REDIRECT_FETCH_POLICY）を使っている

Scenario: 3. Tranco 更新も 30x を拒否する
  Given Tranco のメタデータ取得またはダウンロードが 30x を返し、Location が private IP を指している
  When  更新処理が応答を受け取る
  Then  リクエストは転送されず、更新は失敗として扱われる

Scenario: 4. 正常応答（200）では従来どおり動作する（回帰ガード）
  Given api.github.com と tranco-list.eu が 200 を返す
  When  接続テスト / Gist 同期 / Tranco 更新を実行する
  Then  いずれも従来どおり成功し、リクエスト回数・ヘッダー・保存される内容が変わらない
```

## 受け入れ基準

- [ ] `gistSyncTarget.ts` の 3 サイト（`/user` / `/gists` / `/gists/${gistId}`）が `NO_REDIRECT_FETCH_POLICY` を展開している
- [ ] `trancoUpdater.ts` の 2 サイト（メタデータ / ダウンロード）が同ポリシーを展開している
- [ ] 30x を返す mock で、**2 次リクエストが発行されない**（発行された URL が当初の 1 件だけである）ことをテストで固定する
- [ ] 200 の通常経路で、リクエスト回数・ヘッダー・結果が修正前と同一である
- [ ] リダイレクト拒否による失敗が既存の failure taxonomy（transport / network）に分類され、ユーザー向け文言が status 数値を漏らさない
- [ ] ADR `dev-docs/ADR/2026-08-29-fetch-redirect-policy.md:80-93` の「未適用の経路」記述が、本修正後に「適用済み」へ更新される
- [ ] `npm run validate` が緑

## テスト戦略

- **単体**: `src/background/syncTargets/__tests__/` の Gist テストで `global.fetch` を stub し、`init.redirect === 'error'` を 3 サイトで pin する。加えて **30x を返す応答を注入し、fetch が当初 URL の 1 回だけで呼ばれる**ことを固定する（PBI 01/08 が残した「機構だけを pin する」状態を本 PBI では繰り返さない）。
- **統合**: 接続テストの呼び出し（ダッシュボードまたは background ハンドラ）→ `gistSyncTarget` → fetch の経路で、失敗が UI 向けの失敗として返ることを固定する。
- **単体（Tranco）**: `src/utils/trustDb/__tests__/trancoUpdater*.test.ts` の既存 stub に 30x を返すケースを足す。
- **E2E**: 不要（決定的な局所挙動）。owner 観測は不要。

## 実装メモ（実装者向け）

### 対象ファイルと該当行

| ファイル | 行 | 内容 |
|---|---:|---|
| `src/utils/fetch.ts` | 73 | `NO_REDIRECT_FETCH_POLICY`（既存の共通 seam） |
| `src/background/syncTargets/gistSyncTarget.ts` | 134 / 162 / 191 | `fetchWithTimeout` のオプションにポリシーを展開 |
| `src/utils/trustDb/trancoUpdater.ts` | 133 / 148 | 同上 |
| `dev-docs/ADR/2026-08-29-fetch-redirect-policy.md` | 80-93 | 残存リスクとしての記述を「適用済み」へ更新 |

### 実装手順

1. 各 `fetchWithTimeout(url, { ... })` のオプション先頭に `...NO_REDIRECT_FETCH_POLICY` を足す（AI / Obsidian 経路と同じ書き方）。
2. `import { CONNECTION_TEST_CACHE_MODE, fetchWithTimeout } from '../../utils/fetch.js'` に `NO_REDIRECT_FETCH_POLICY` を追加。
3. mock fetch が `init` を検査するテストを足し、**30x を返す応答で 2 次リクエストが出ない**ことも固定する（`redirect: 'error'` は mock では abort しないため、実装側が投げる失敗の扱いまで確認する）。
4. ADR の残存リスク節を「適用済み」に更新し、適用日を書く。

### 実装者向け注記 — 現状コードの確認（着手前に必ず実行）

```bash
# 1) ポリシーを使っているサイト（現状: HttpProviderStrategy 2 + obsidianClient 3 + systemHandlers はリテラル）
grep -rn "NO_REDIRECT_FETCH_POLICY" src/
# 2) fetch 呼び出しサイトの全体。1) に出てこないものが本 PBI の対象
grep -rn "fetchWithTimeout(\|fetchWithRetry(" src/
# 3) 期待: gistSyncTarget 3 サイトと trancoUpdater 2 サイトが 2) のみに現れる
```

**未実装**（2026-10-19 時点で 5 サイトすべて `redirect` 未指定）。なお `src/background/handlers/systemHandlers.ts:104` は `redirect: 'error'` をリテラルで持っており、挙動は正しいが共通 seam を共有していない（本 PBI でついでに寄せると「宣言は 1 箇所」が厳密に成り立つ。任意）。

### 落とし穴

- **`Authorization` はクロスオリジンリダイレクトで剥がれるが、同一 origin 内の 30x では剥がれない。** 「剥がれるから安全」と結論しないこと。剥がれるのは 3 エンジンとも cross-origin のときだけで、`api.github.com/a` → `api.github.com/b` のような同一 origin の付け替えには効かない。
- **PBI 01/08 と同じ「テストが機構だけを pin する」罠**: `init.redirect === 'error'` の assertion だけでは、実際に 2 次リクエストが出ないことを示せない。plain な fetch mock は abort を再現しないので、**mock 側で「redirect:'error' なら throw する」振る舞いを実装**して 2 次リクエストの不在を固定するか、その限界を完了記録に明記する。
- `GIST_API_BASE` は定数（`https://api.github.com`）であり、ユーザーが変更できない。優先度が低いのはこのためだが、**固定ホストでも資格情報を付けた fetch は redirect を拒否する**のが ADR 2026-08-29 の趣旨。
- `trancoUpdater` のダウンロード URL（`:145`）は API 応答から組み立てる。`listId` / `count` のバリデーションは既存のままとする（本 PBI は redirect 方針のみ）。
- Gist の `sync()` / `syncBatch()` に production 呼び出し元が無い可能性がある（PBI 25 の未解決 blocker）。**呼び出し元が無い場合でも接続テスト経路は生きている**ため、本 PBI の実害はゼロではない。判断材料として `pbi/2026-10-18-25-fix-gist-egress-csp-declare.md` の blocker 2 を参照。

### ロールバック手順

1. 変更は各オプションの 1 行追加なので、`git revert` で即座に戻せる。
2. ロールバックの判断基準: 本番で「Gist 接続テスト / 同期が一律に失敗する」報告が出た場合（＝ `api.github.com` が正規の 30x に依存していた場合）。その場合も **`redirect:'error'` を外すのではなく `fetchWithRedirectGuard` 方式（ホップ毎再検証）へ切り替える**こと。転送先を無検証で追従する状態には戻さない。

## 見積もり

0.5 SP（🟢低）。5 サイトへの 1 行追加＋テスト 2〜3 本＋ADR の更新。

## Definition of Done

- [ ] BDDシナリオ 1〜4 が自動テストで実装されパス
- [ ] `npm run validate` が緑
- [ ] ADR 2026-08-29 の残存リスク記述が更新されている
- [ ] コードレビュー完了
- [ ] 完了記録に、30x の実挙動を検証できた範囲と残る限界（browser/E2E のみ観測可能な部分）を明記する

## 関連

- `pbi/00-INDEX.md`
- `dev-docs/archived/pbi/2026-10-18-01-fix-ai-fetch-redirect-policy.md` / `dev-docs/archived/pbi/2026-10-18-08-fix-obsidian-redirect-bearer.md` — 同じ共通 seam を導入した先行 PBI（残存リスクとして本件を記録済み）
- `dev-docs/ADR/2026-08-29-fetch-redirect-policy.md` — 本 PBI が適用範囲を完成させる ADR
- `pbi/2026-10-18-25-fix-gist-egress-csp-declare.md` — 同じ `gistSyncTarget.ts` を触る。実装順は本 PBI を先にすると競合が小さい（1 行追加のみ）
