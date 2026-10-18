# PBI: package-lock.json の全 resolved URL を公式レジストリへ戻す（npm.flatt.tech ミラーの無宣言依存の解消）

## ユーザーストーリー

**リポジトリのメンテナ／リリース担当者**として、**コミットされた `package-lock.json` が指す依存取得元を、公式レジストリか明示的に宣言された社内ミラーに一本化する方法がほしい**。なぜなら、今の状態では 1090 件の依存すべてが第三者ミラー `npm.flatt.tech` から取得されるのに、その事象はリポジトリのどこからも宣言されておらず（`.npmrc` なし・workflow の `registry-url` なし）、CI とリリースの成果物の中身が「誰が、どの正確さで配布しているか分からないホスト」に全面的に依存しているから。

リリース成果物の再現性・監査追跡性が、外部ホストの善意に預けられている状態は、リリース判定として受け入れられない。

## 優先度

- **順位**: 03 / 25
- **RICE**: 4800（Reach=800 / Impact=2 / Confidence=80% / Effort=0.4）
- **種別**: 🔧非機能追加（fix）
- **難易度**: 🟡中
- **副作用**: 🔴あり
  - `package-lock.json` の **1090 件の resolved URL 全置換**＝全依存の張替になる。バージョン・integrity ハッシュは変えないため意味論的には同一依存だが、**開発環境・CI 環境のネットワーク到達性に影響する**（ミラー到達性を前提にしていた開発者が、公式レジストリに到達できる必要がある）。
  - 併せて `.npmrc` をコミットすると、`npm install` の解決挙動が開発者ごとに変わる。ローカルに `~/.npmrc` でミラーを設定している開発者には挙動差が出る。
  - lockfile の巨大差分（1090 行）になるため、通常変更と同一コミットに混ぜると revert・bisect の障害になるため、**単独コミットで切り出す**こと。
- **採点根拠**: 監査3位。`package-lock.json` の解決済み tarball URL が1090件すべて第三者ミラー `npm.flatt.tech` を指し、公式レジストリを指すものは0件。ランタイム依存の `sqlite-wasm` / `wa-sqlite` を含む全CI・リリースジョブが `npm ci` でそのURLから取得する。コミットされた `.npmrc` も workflow の `registry-url` 宣言も存在しないため、このミラーへの依存は構成物のどこからも宣言されていない。ミラー運営者・忠実性・ランナー到達性は外部事実だが、**attack surface の大きさ（全1090依存）とリリース job への波及範囲**が全候補中最大。

## 背景（監査の出典）

- security-audit run-2 の needs_validation リード（run-1 からの持ち越し再検証、件数は run-1 時の835件から1090件に増加）。
- **fingerprint: `c1fe8c20`**
- 監査成果物: `/Users/yaar/security-audit-skill/obsidian-smart-history/run-2/`
  - `findings.json`（fingerprint `c1fe8c20`）、`NEEDS-VALIDATION.md` 5番、`REPORT.md`
- **verdict**: `needs_validation` — 決定的な事実（ミラー運営者・プロキシ忠実性・ランナー到達性）はソースからは観測不能。

### 着手時点の観測結果（読み取り専用で確認）

| 項目 | 実測値 |
|---|---|
| `package-lock.json` lockfileVersion | 3 |
| `packages` エントリ数 | 1091（うち root の workspace 枠 1） |
| `resolved` を持つエントリ | **1090** |
| ホスト内訳 | **`npm.flatt.tech`: 1090 / `registry.npmjs.org`: 0** |
| `integrity` を持つ resolved エントリ | 1090 / 1090（= 全件に sha512 あり） |
| ランタイム依存の解決先 | `wa-sqlite 1.0.0` → `https://npm.flatt.tech/wa-sqlite/-/wa-sqlite-1.0.0.tgz`<br>`@subframe7536/sqlite-wasm 1.4.0` → `https://npm.flatt.tech/@subframe7536/sqlite-wasm/-/sqlite-wasm-1.4.0.tgz` |
| ツリー内 `.npmrc` | **存在しない**（`find . -name .npmrc` 該当0） |
| workflow 数 | 6（`ci.yml` / `coverage.yml` / `pages.yml` / `release.yml` / `security-audit.yml` / `tests.yml`） |
| `actions/setup-node` 出現 | 14 箇所 |
| `registry-url` 宣言 | **0 箇所（全 workflow）** |
| `npm ci` 出現 | 12 箇所（ci.yml 4 / tests.yml 4 / coverage 1 / pages 1 / release 1 / security-audit 1） |
| `wasm/crates.json` | ローカル `cargo build` するクレート（pii-sanitizer / textrank / sentence-dedup / tag-cooccur）の SSOT。**npm tarball の取得経路には影響しない**（監査記録と一致） |

### この環境固有の観測（着手前に潰すべき点）

- **開発マシン-global の `/Users/yaar/.npmrc` に `registry=https://npm.flatt.tech/` と `//npm.flatt.tech/:_authToken` が設定されている。**
  - npm の `replace-registry-host`（npm 9 以降の既定値は `npmjs`）は、lockfile の `registry.npmjs.org` を指す `resolved` を**設定レジストリで置換する**。したがって公式URLで生成された lockfile が、このマシンで `npm install` を走らせた瞬間にミラーURLへ書き換わる、という発生機構が説明できる。
  - つまり **lockfile を直して終わる話ではなく、「書き換えが再発しない宣言」を同時に入れることで初めて閉じられる**。再発防止のゲートは本 PBI の受け入れ基準に含む。

### integrity ハッシュの解釈について（重要な留保）

1090件すべてに `integrity`（sha512）があるため、**lockfile 確定後にミラー側が tarball を差し替える**攻撃は npm 側で失敗する。ここは安心材料。ただし逆に、**lockfile 生成時点で取得された tarball がすでに公式と一致していた保証にはならない**。記録されている integrity は「そのときミラーが返したもののハッシュ」であって、「公式レジストリのハッシュ」ではない。忠実性の照合（audit の validation plan の local 側）は**別途 owner が実行する必要がある**。

## BDD受け入れシナリオ

```gherkin
Scenario: 公式レジストリが宣言され、ミラーへの無宣言依存がゼロになる（ハッピーパス）
  Given このリポジトリの package-lock.json に 1090 件の resolved URL が記録されている
  When  依存取得元の宣言状態を検査する
  Then すべての resolved URL が宣言されたレジストリ（registry.npmjs.org）を指している
  And   ツリー内にミラー host を指す resolved URL が 1 件も存在しない
  And   すべての setup-node ステップが registry-url を明示している
  And   npm ci が成功し、validate ゲート（型検査・lint・テスト）が緑になる
  And   CI 実行ログ上で tarball の取得先が registry.npmjs.org であることを確認できる

Scenario: 宣言されたレジストリが到達不能なとき、パイプラインは fail-closed で停止する（境界）
  Given 依存取得元は単一の宣言済みレジストリ（registry.npmjs.org）である
  And   そのレジストリが到達不能である（DNS 失敗・TLS 失敗・5xx のいずれか）
  When  CI ジョブが npm ci を実行する
  Then  npm ci は非ゼロ終了し、そのジョブは失敗として終了する
  And   一部の依存を黙って欠落させ、テストを部分実行したうえで緑になることはない
  And   release ワークフローは成果物を publish / upload しない
  And   失敗ログがどのレジストリで取得に失敗したかを明示している

Scenario: 未宣言の host が lockfile に混入した状態を、ゲートが検出する（再発防止）
  Given package-lock.json に未宣言のレジストリ host を指す resolved URL が混ざっている
  When  validate ゲート（依存検査）が走る
  Then  検査は違反となるホスト名・パッケージ名・件数を出力して非ゼロ終了する
  And   PR 上の dod-check ジョブが緑になりえない
```

## 受け入れ基準

- [ ] `package-lock.json` の resolved URL 1090件すべてが `registry.npmjs.org`（またはリポジトリで明示的に宣言したレジストリ）を指し、`npm.flatt.tech` への参照が 0 件になる。
- [ ] `integrity`（sha512）1090件がすべて維持されている（ホストの書き換えによって integrity の値が失われていない）。バージョン・`dependencies` 宣言内容の変更は 0 件（純粋にホストのみが変わる差分）。
- [ ] リポジトリに `.npmrc` を追加する場合、`registry=https://registry.npmjs.org/` とミラーへの自動置換を止める設定（`replace-registry-host=never`）を含み、**認証トークン・シークレットを一切含まない**。
- [ ] 全 6 workflow の全14 `setup-node` ステップが `registry-url: 'https://registry.npmjs.org/'` を明示する（現状 0/14）。
- [ ] 機械的検査が導入され、validate ゲートの一部として **fail-closed** で走る。具体的には `scripts/release-checks/check-deps.mjs` に「lockfile の resolved ホストが宣言済み許可リストに含まれること」「未宣言 `.npmrc` が存在しないこと」の静的検査を追加し、`npm run validate` から到達可能にする。
- [ ] 開発マシンに `~/.npmrc` でミラーを設定した状態でも、`npm install` を実行しても lockfile の resolved URL がミラーへ書き換わらない（再発機構が閉じられていることを、このマシン上で実証する）。
- [ ] ロールバック経路が明確であること: 本変更は単一コミットに切り出され、`git revert <commit>` で完全に元に戻せること（同一コミットに無関係な変更を混ぜない）。
- [ ] `SECURITY.md` に依存取得元（Supply chain / 依存取得先の宣言）節を追加し、`THIRD_PARTY_NOTICES.md` の生成元レジストリが公式であることを明記する。

## テスト戦略

- **単体（CI 設定の静的検証）**
  - `package-lock.json` をパースし、全 `resolved` のホストを列挙して宣言済み許可リストと照合する検査。未宣言ホストがあれば**ホスト名・パッケージ名・件数**を出して非ゼロ終了。
  - 全 workflow YAML を走査し、`setup-node` ステップに `registry-url` があること、値が許可ホストであることを検査。0/14 のような抜け漏れを数で報告。
  - ツリー内 `.npmrc` の有無検査。存在する場合、許可キーで構成され、トークン相当の行（`_authToken` / `_auth` / `_password`）を含まないことを検査。
  - 上記は外部ネットワークに到達しない純粋静的検査として実装する（テスト自体、外部ホストに fail してはいけない）。

- **統合（依存取得経路の整合）**
  - `npm ci` をクリーンなワークツリーで実行し、全 1090件が宣言レジストリから取得され、integrity 検証を通過することを確認。
  - 宣言レジストリの **到達不能を再現**したケース（`--registry` を到達不能ホストに向ける、`NPM_CONFIG_REGISTRY` の差し替え、またはサンドボックスの egress 遮断）で、`npm ci` が非ゼロ終了し、ジョブが fail-closed になることを確認。**欠落した依存を黙って許容しないこと**（部分的成功が緑にならない）。
  - 開発マシンにミラー設定が残った状態で `npm install` を実行し、lockfile の resolved URL が書き換わらないことを確認（差分 0 行）。

- **E2E（ビルドと公開経路が green）**
  - `npm run validate` が緑。
  - `npm run build` およびリリース相当のビルド（`build:store` 相当）が緑。
  - main ブランチ推送後、`ci.yml` の validate / build / bench-check、`tests.yml` の4ジョブ、`coverage.yml`、`security-audit.yml` がすべて緑。`release.yml` が依存取得を完走すること（publish は行わない dry-run 相当まで）。

## 実装メモ（実装者向け）

### 対象ファイル

| ファイル | 変更内容 |
|---|---|
| `package-lock.json` | resolved URL 1090件を宣言レジストリへ書き換え（**単独コミットに切り出す**） |
| `.npmrc`（新規） | 存在しない場合は作成。`registry` を明示し、ミラーへの自動置換を止める。**トークン禁止** |
| `.github/workflows/ci.yml` | `setup-node` 5箇所に `registry-url` 追加（現在 0） |
| `.github/workflows/tests.yml` | `setup-node` 4箇所に `registry-url` 追加（現在 0） |
| `.github/workflows/release.yml` | `setup-node` 2箇所に `registry-url` 追加（現在 0） |
| `.github/workflows/coverage.yml` / `pages.yml` / `security-audit.yml` | `setup-node` 各1箇所に `registry-url` 追加（現在 0） |
| `scripts/release-checks/check-deps.mjs` | lockfile ホスト・`.npmrc`・`registry-url` の静的検査を追加（`npm run validate` から到達可能にする） |
| `SECURITY.md` / `THIRD_PARTY_NOTICES.md` | 依存取得元の説明を追加 |

### 最小変更の選択肢

#### 選択肢1: lockfile の全 resolved URL を公式レジストリへ書き換え ＋ `.npmrc` でレジストリを明示（**推奨**）

- 実装: `package-lock.json` の `resolved` のホストを機械的に置換し、リポジトリ直下に `.npmrc` で `registry=https://registry.npmjs.org/` を宣言。あわせてミラーへの自動置換を止める（npm 9 以降 `replace-registry-host` の既定 `npmjs` は、lockfile が `registry.npmjs.org` を指していると**設定レジストリで置換する**ため、これを `never` に固定しないと再導入の経路が残る）。
- **再現性**: 効果大。同一バージョンの同一アーティファクトを、宣言されたホストから取得する状態に固定される。`integrity` は不変なのでハッシュ検証の枠組みはそのまま機能する。ただし**これは「ミラーが迄今为止忠実だった」ことを証明しない**。忠実性の照合は別途（下記ブロッカー）。
- **オフライン開発**: 悪化方向。ミラー経由でしか依存を止められない環境（社内ファイアウォール等）は、突然、公式レジストリに到達できる必要がある。すでにキャッシュ済みの `node_modules` は影響を受けないが、クリーン再取得は影響を受ける。
- **キャッシュ効果**: `setup-node` の `cache: 'npm'` は lockfile をキャッシュキーに含むため、この書き換えで**全 runner の npm キャッシュが無効化され、初回 CI はフル再取得**（時間・レート制限コストが一度だけ発生）。2回目以降は安定する。

#### 選択肢2: CI workflow で `registry-url` を明示し、lockfile は監査で Pin して CI 側で代替を許す

- 実装: 全 `setup-node` に `registry-url` を追加し、lockfile は現状のまま監査記録に Pin、CI 側でミラー利用を明示的に許可する。
- **重要 — この選択肢だけでは attack surface を閉じられない。** `npm ci` は lockfile の `resolved` フィールドに書かれた URL から tarball を取得する。`setup-node` の `registry-url` は `.npmrc` にレジストリを書くため、影響するのは **メタデータ（バージョン解決・audit 情報）の取得先**であって、**lockfile に固定された tarball URL の取得先ではない**。したがって選択肢2単独では「宣言されていないミラーへの依存」は残り続ける。
- **再現性**: 変わらない（lockfile が同じなら）。むしろ「宣言と実際の取得先が食い違う」状態が固定され、監査時に明示的な矛盾として現れる。
- **オフライン開発 / キャッシュ効果**: 影響なし（lockfile が変わらないため）。
- **結論**: 選択肢2は選択肢1の**補完**（メタデータ取得先を明示してドリフトを防ぐ）として採用すべきであり、代替ではない。

#### 推奨の組み合わせ

**選択肢1（lockfile 書き換え＋`.npmrc` 宣言）＋ 選択肢2 のうち `registry-url` 明示のみ**、に静的検査ゲートを加える。選択肢2 の「CI 側で代替を許す」部分（＝ミラー利用の明示的な許諾）は、忠実性照合が通らない限り採用しない。

**`~/.npmrc`（開発機のグローバル設定）には触れない。** オーナー判断（2026-10-18）により、開発機の Takumi Guard 設定は他プロジェクトでの悪性パッケージ防御として有効なため残す。そのうえでリポジトリ内の挙動は **プロジェクト直下の `.npmrc`** で固定する（npm の設定優先順位はプロジェクト > ユーザー）。これにより、`~/.npmrc` にミラー設定がある開発機でも lockfile の `resolved` は書き換わらず、npm ≥ 11.15.0 の `--allow-remote` enforcement（設定レジストリと tarball ホストの不一致を EALLOWREMOTE で拒否）も発生しない（設定レジストリ＝lockfile ホスト＝公式のため）。トレードオフとして、このリポジトリの依存取得では Takumi Guard のブロックが効かなくなる（CI の安定性と再現性を優先する判断）。

### ブロッカー（着手前に潰すべき owner 確認）

以下は **audit の `validation_plan` に従い owner が実施する外部事実の観測**であり、この PBI の実装作業だけでは解決できない。実装.diff を作る前に答えが出ていない項目は、PBI の「ブロッカー残存」として記録する。

1. **ミラー運営者の同一性** — **解決済み（2026-10-18）**: `npm.flatt.tech` は GMO Flatt Security の Takumi Guard（公開 SaaS 型セキュリティプロキシ、匿名利用可）。悪意ある第三者ミラーではなく、無宣言の外部 SaaS 依存であることが問題の本体。
2. **プロキシ忠実性** — **解決済み（2026-10-18）**: 代表 10 パッケージで lockfile integrity と `registry.npmjs.org` の `dist.integrity` が 10/10 完全一致。tarball は 302 で公式へパススルーし、実ダウンロードの sha512 も一致。**過去の成果物の完全性レビューは不要、供給網侵害の兆候 0 件。**
3. **ランナー到達性** — 公開エンドポイントで匿名利用可のため到達性は高いと推定できるが、決定論的な保証はない。**本 PBI の実装後は lockfile が公式を指すため、CI がミラーへ到達できるかは無関係になる**（実装後の CI 実行 1 回で解消）。fail-open か fail-closed かの確認は、宣言レジストリ＝公式の到達性に対して行えばよい。

> 1〜3 の観測結果が「ミラーは信頼できる」と判定されたとしても、「ソースに宣言がない」という指摘自体は解消しないため、**本 PBI の実装（選択肢1）は観測結果によらず実施する**。観測結果は主として、release の影響範囲と過去成果物の再取得要否を確定するために使う。

### ロールバック手順

lockfile を 1090行規模で書き換えるため、revert のしやすさを先に設計する。

- **前提**: lockfile 書き換えは**他の変更と混ぜない単独コミット**にする（`package-lock.json` のみ、または `.npmrc` + 検査スクリプトのみを別コミットに分離）。
- **手順**:
  1. `git log --oneline -n 5 -- package-lock.json` で書き換えコミットを特定する。
  2. `git revert --no-commit <commit>`。1090行だが機械生成のため競合はほぼ発生しない（同一ファイルの他変更が同一コミットに無いため）。
  3. 緊急時は `git checkout <書き換え前のcommit> -- package-lock.json` で旧 lockfile を復元し、`npm ci` を実行する。
- **ロールバック後の影響**: 依存グラフは旧コミット時点に戻り、`node_modules` は再取得が必要。ただし**バージョンは変わらない**（書き換えはホストのみを変更する）ため、ソースコードの互換性は影響を受けない。
- **保険**: 書き換え前の `package-lock.json` を PR 説明に添付しておくと、照合時の diff 確認が容易（同一コミット内では `git show <commit> --stat` で 1090行の変化量を確認できる）。

## 見積もり

**3.0 SP**

内訳: 静的検査スクリプトの実装と単体テスト 1.5SP / lockfile 書き換えと workflow 14箇所の `registry-url` 追加 0.5SP / クリーン `npm ci` と `npm run validate` の再実行・CI 緑確認 0.5SP / ドキュメント更新 0.5SP。

> Effort=0.4 の根拠は「コード変更量が小さい」ことだが、**ネットワーク到達性という未知数と全 runner のキャッシュ無効化**が運営コストに含まれるため、RICE の数字をそのまま SP に落とすのはしない。ブロッカー1〜3(owner 観測) の実施時間は本 Estimates に含めていない（別作業）。

## Definition of Done

- [ ] BDDシナリオが自動テストで実装されパス
      - 静的検査（lockfile ホスト列挙・`setup-node` の `registry-url`・`.npmrc` の有無と秘密情報非含有）が `npm run validate` から実行される
      - fail-closed シナリオが統合テストで実証される（宣言レジストリの到達不能時に `npm ci` が非ゼロ終了し、ジョブが緑にならない）
- [ ] `npm run validate` が緑
- [ ] 監査 fingerprint を完了記録に残す
      - fingerprint: `c1fe8c20`
      - verdict `needs_validation` → 実装後ローカル検証（resolved ホスト・integrity 維持・`.npmrc` なしの確認）を実施し、結果を記録する
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
      - `THIRD_PARTY_NOTICES.md` に依存取得元（公式レジストリ）の説明を追加
      - `SECURITY.md` に Supply chain 節（依存取得先の宣言と検査ゲート）を追加
- [ ] ブロッカー1〜3（ミラー運営者同一性 / プロキシ忠実性 / ランナー到達性）の owner 観測結果が実施済みであり、結果が本 PBI に記録されている

## 調査結果（2026-10-18）

- 判定: **RESOLVED（性質変更）**
- 決め手: `npm.flatt.tech` は **GMO Flatt Security の Takumi Guard**（公開 SaaS 型セキュリティプロキシ、匿名利用可）であり、悪意ある第三者ミラーではない。代表 10 パッケージで lockfile integrity と registry.npmjs.org の dist.integrity が **10/10 完全一致**、tarball は 302 で公式へパススルー（実ダウンロードの sha512 も一致）→ **過去成果物の完全性レビューは不要、供給網侵害の兆候 0 件**。発生機構は `replace-registry-host`（既定 "npmjs"）の公式 docs で裏付けられた
- 影響: **Impact 2→1、Confidence 80→100（RICE 4800→2000）**。ただし「リポジトリから宣言されていない外部 SaaS 依存」という指摘は残る
- 方針決定（2026-10-18 オーナー判断）: **`~/.npmrc` の Takumi Guard 設定は残す**（開発機の他プロジェクトでは悪性パッケージのブロックとして実際に有効なため）。本 PBI は lockfile を公式へ戻し、**リポジトリ直下の `.npmrc` に `registry=https://registry.npmjs.org/` と `replace-registry-host=never` を置いて再発を防ぐ**。npm の設定優先順位はプロジェクト > ユーザーなので、`~/.npmrc` にミラー設定があってもリポジトリ内では公式が使われ、EALLOWREMOTE も発生しない
- トレードオフ: このリポジトリの依存取得では Takumi Guard のブロックが効かなくなる。CI の安定性・再現性と、無宣言依存の解消を優先する判断

## 関連

- pbi/00-INDEX.md
- 監査: `/Users/yaar/security-audit-skill/obsidian-smart-history/run-2/findings.json`（fingerprint `c1fe8c20`）、`NEEDS-VALIDATION.md` 5番、`REPORT.md`
- 依存検査の既存置き場: `scripts/release-checks/check-deps.mjs`
- WASM クレート SSOT（npm 取得経路とは独立）: `wasm/crates.json`