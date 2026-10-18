# PBI: InMemoryStoragePort が文字列値の `*_version` キーを捨て、テストが同意版数などを観測できない問題の修正

## ユーザーストーリー

テストを書く開発者として、**test double が `chrome.storage.local` と同じキーを同じように保持してほしい**、なぜなら `InMemoryStoragePort` は `*_version` で終わるキーを数値の版数カウンタとして扱うため、文字列値の `privacy_consent_version`（日付）や `gemini_api_version`（`'v1'`）は**set した瞬間に消え**、テストからそのキーが見えなくなるから。見えないキーはテストで pin できず、production のバグが緑のまま通る。実際に 2026-10-19、この挙動を設定移行の欠陥と誤認しかけた（下記）。

## 優先度

- 順位: 2026-10-19 の 01 / 08（同日 8 件のうち 1 番目）
- RICE: 800（Reach=200 / Impact=2 / Confidence=100% / Effort=0.5）
  - Reach: この test double を使うテスト群（`new InMemoryStoragePort()` は 56 箇所）。テストスイート全体の検出力に効く
  - Impact: 2。production の不具合を直接起こすものではないが、**テストが観測できない状態を作る**ため、隠れたバグの温床になる（誤診も実際に起きた）
  - Confidence: 100%（下記のとおり実測で確定）
  - Effort: 0.5 SP。`set` と `get` の分岐修正＋parity テスト
- 種別: 🔧非機能追加（fix）
- 難易度: 🟢低
- 副作用: 🟡軽微（test double の意味論を `chrome.storage.local` に寄せる。数値の版数カウンタに依存する既存テストが非退行であることを確認する必要がある）

## 背景（発見の経緯）

PBI [2026-10-19-03](../../../pbi/2026-10-19-03-fix-consent-keys-settings-blob-relocation.md)（同意キーが settings ブロブへ畳まれる問題）の調査中、`InMemoryStoragePort` に withdrawn レコードと `privacy_consent_version` を seed して移行を実走させたところ、**allowlist で保護されているはずの ack まで移行後に消えて見えた**。実際には移行は ack を消しておらず、test double が seed の時点で捨てていた。

### 機構（コード上で確定）

`src/utils/storage/storagePort.ts`

| 箇所 | 内容 |
|---|---|
| `:125-133` | `set`: `if (k.endsWith('_version') && typeof v === 'number')` → `versions` へ。`else if (!k.endsWith('_version'))` → `store` へ。**`*_version` かつ数値でない値はどちらの分岐にも入らない**（`else if` が false になるため黙って捨てられる） |
| `:115-119` | `get(string)`: `keys.endsWith('_version')` なら `versions` だけを見て、無ければ `{}` を返す |
| `:94-113` | `get(string[])`: 同じく `*_version` は `versions` だけを見る |
| `:87-92` | `get(null)`: `store` と `versions` を結合して返す |

影響する実キー（いずれも値は文字列）:

- `StorageKeys.PRIVACY_CONSENT_VERSION` = `privacy_consent_version`（値は同意したポリシー版の日付。`acceptConsent` / `declineConsent` が書く）
- `StorageKeys.GEMINI_API_VERSION` = `gemini_api_version`（値は `'v1'` 等。`isMigratableStorageKey` が true であることを既存テストが assert している）
- `StorageKeys.TRANCO_VERSION` = `tranco_version`（値は ISO 文字列。allowlist で top-level に残る）

数値の CAS 用キー（`settings_version` / `savedUrls_version` など）は意図どおり `versions` に入る。壊れているのは「`*_version` という名前だが値は文字列」という第 2 の用途。

### 実測（2026-10-19）

```
await port.set({ privacy_consent_version: '2026-09-08', gemini_api_version: 'v1' });
await port.get(null)  →  {}                                  ← 2 キーとも消える
await port.set({ privacy_consent_version: 42 });
await port.get(null)  →  {"privacy_consent_version":42}       ← 数値なら保持される
```

`chrome.storage.local`（および `ChromeStoragePort`）は同じ `set` で 2 キーとも保持する。

## 影響

- **`*_version` の文字列キーを扱うテストは実挙動を再現できない。** たとえば `isPolicyVersionChanged()` は保存値が常に未設定に見えるため常に `true`（＝再同意が必要）と判定され、版数比較の分岐を正しく pin できない。
- **誤診を生む。** 2026-10-19 に「ack まで移行で消えた」と読みかけた（実際は allowlist で残る）。test double の忠実性が崩れていると、原因の切り分けに余計な時間がかかり、誤った修正に進みうる。
- 逆に「テストが緑だから production も正しい」という前提が崩れる。この test double は 56 箇所で使われている。

## BDD受け入れシナリオ

```gherkin
Scenario: 1. 文字列値の *_version キーが往復する
  Given InMemoryStoragePort がある
  When  privacy_consent_version に日付文字列を set する
  Then  get(privacy_consent_version) は同じ文字列を返す
  And   get(null) の結果にも含まれる
  And   get([privacy_consent_version, gemini_api_version]) でも取得できる

Scenario: 2. 数値の *_version は従来どおり版数カウンタとして振る舞う（回帰ガード）
  Given InMemoryStoragePort がある
  When  settings_version に数値を set する
  Then  get(null) に settings_version として現れる
  And   StorageTransaction の CAS（楽観ロック）が従来どおり動く

Scenario: 3. chrome.storage.local と同じ結果になる（parity）
  Given 同じ set / remove の列を InMemoryStoragePort と ChromeStoragePort に与える
  When  両方から get(null) する
  Then  キーと値の集合が一致する（文字列の *_version を含む）

Scenario: 4. remove も両方の入れ物に効く（境界）
  Given 数値の *_version と文字列の *_version を set している
  When  remove で両方を消す
  Then  get(null) から両方とも消える
```

## 受け入れ基準

- [x] 文字列値の `*_version` キーが保持され、`get(string)` / `get(string[])` / `get(null)` の 3 経路すべてで返る（**根因に合わせて `versions` マップ自体を廃止**し、全キーを通常キーとして保存する。実装メモの選択肢 1 より踏み込んだ理由は完了記録のなぜなぜ分析を参照）
- [x] 数値の `*_version` キーは CAS 世代番号として同じ見え方を保つ（`get(string)` / `get(string[])` / `get(null)` の結果が従来と一致。既存テスト非退行）
- [x] `remove` が `*_version` キーにも効く（数値・文字列の両方）
- [x] `ChromeStoragePort` との parity がテストで固定される（同一操作列で `get(null)` のキー・値集合が一致）
- [x] `privacy_consent_version` / `gemini_api_version` / `tranco_version` を seed して読めることを pin するテストがある
- [x] `src/utils/storage/storagePort.ts` のコメントに `*_version` の 2 つの用途（数値の CAS カウンタ / 文字列値の通常キー）が明記される
- [x] `npm run validate` が緑

## テスト戦略

- **単体**: `src/utils/storage/__tests__/storagePort.test.ts` に文字列 `*_version` の往復（`get` の 3 経路）を追加。`remove` の境界も同ファイル。
- **parity**: `src/utils/storage/__tests__/storagePortCloneBoundary.test.ts`（`InMemoryStoragePort` と `ChromeStoragePort` を同じ操作列で比較する既存の型）と `storageTransaction-contract.test.ts` の matrix に、文字列 `*_version` のケースを追加する。
- **回帰**: 数値版数カウンタに依存する既存テスト（`settings_version` / `savedUrls_version` を使う CAS のテスト）が非退行であること。
- **E2E**: 不要。

## 実装メモ（実装者向け）

### 対象ファイルと該当行

| ファイル | 行 | 内容 |
|---|---:|---|
| `src/utils/storage/storagePort.ts` | 125-137 | `InMemoryStoragePort.set`。文字列 `*_version` を捨てる分岐 |
| 同上 | 115-119 | `get(string)` の version 分岐（`versions` のみ参照） |
| 同上 | 94-113 | `get(string[])` の version 分岐（同上） |
| 同上 | 139-141 | `remove`。`store` のみ削除（`versions` を消すかを決める） |
| `src/utils/storage/__tests__/storagePort.test.ts` | — | 往復のテストを足す場所 |
| `src/utils/storage/__tests__/storagePortCloneBoundary.test.ts` | 16 | 2 実装を並べる parity テストの型 |
| `src/utils/storage/__tests__/storageTransaction-contract.test.ts` | 22 | 同上（transaction 契約の matrix） |

### 最小変更の選択肢

1. **`set` を「`*_version` かつ数値 → `versions`、それ以外 → `store`」に変え、`get` の version 分岐を「`versions` に無ければ `store` を見る」に変える（推奨）**
   - 変更は分岐 3 箇所。`ChromeStoragePort`（キーをそのまま保持）の挙動に一致する。
   - 副作用: 数値 `*_version` の見え方は変えない（`versions` を先に見るため）。
2. **CAS の版数を専用 API（`getVersion` / `bumpVersion`）に分離する**
   - 根本的だが `StorageTransaction` と全利用側に波及する。本 PBI の Effort では収まらないため別 PBI 相当。

**推奨: 1。**

### 実装者向け注記 — 現状コードの確認（着手前に必ず実行）

```bash
# 分岐の現状（文字列 *_version がどちらにも入らないことを確認）
sed -n '125,141p' src/utils/storage/storagePort.ts
# *_version という名前の StorageKeys（値が文字列のもの）
grep -n "_VERSION:" src/utils/storage/types.ts
```

**未実装**（2026-10-19 に実測で確認済み）。

### 落とし穴

- **`set` だけ直しても読めない。** `get(string)` は `keys.endsWith('_version')` を先に見て `versions` だけを返すため、`store` に入れた値は version 分岐で握り潰される。`get` の 3 経路すべてを直すこと。
- `remove` は現在 `store` しか消さない（`:139-141`）。`versions` を消す必要があるかを決めて、テストで固定すること（消さないと、削除後に古い版数が生き残って CAS が誤判定しうる）。
- 数値 `*_version` の意味（`get(null)` で `{key}_version` として現れる）に依存するコードがあるか確認すること。`grep -rn "_version\`\|_version'" src/` で読み出し側を洗う。
- `cloneAtBoundary`（構造化クローン境界）を通すので、値の型によっては clone の挙動も確認する。

### ロールバック手順

1. 分岐の変更なので `git revert` で戻せる。データを書かないため、ロールバックの副作用は無い。
2. revert 後も既存テストは緑（本 PBI が足すテストだけが落ちる）。

## 見積もり

0.5 SP（🟢低）。`set` / `get` / `remove` の分岐修正＋単体 4 件＋parity の追記。

## Definition of Done

- [x] BDDシナリオ 1〜4 が自動テストで実装されパス
- [x] `npm run validate` が緑（数値版数カウンタの既存テストが非退行）
- [x] `storagePort.ts` のコメントに 2 つの用途を明記
- [x] コードレビュー完了
- [x] PBI [2026-10-19-03](../../../pbi/2026-10-19-03-fix-consent-keys-settings-blob-relocation.md) の落とし穴にある「この test double では `privacy_consent_version` を seed しても観測できない」という注意書きを、本修正後に「seed して観測できる」へ更新する

## 完了記録（2026-10-19）

### なぜなぜ分析（原因 → 示唆 → 解）

**疑問**: なぜ `InMemoryStoragePort` は `chrome.storage.local` が保持するキーを黙って捨てるのか。

1. **なぜ落ちるのか** — `set` が `*_version` で終わるキーを「数値なら `versions`、それ以外は `store` に入れない」と分岐していた。文字列値はどちらの枝にも当たらず、例外もログも無く消える。
2. **なぜ `*_version` を特別扱いしていたのか** — このコードベースは CAS（楽観ロック）の世代番号を `<key>_version` という**兄弟キー**で表現しており、ポートがそれを `versions` マップで模していた。
3. **なぜ模倣が必要だったのか** — `get(null)` / `get('<key>_version')` を chrome と同じ見え方にしたかったため。**ただし `StorageTransaction` は `<key>_version` を通常のキーとして `port.get` / `port.set` に渡している**（`storageTransaction.ts:374`）。通常キーとして保存しても見え方は同じで、模倣は不要だった。
4. **なぜ不要な模倣が害を生んだのか** — `*_version` という**命名規約を意味の判別子として流用**したため。判別子（数値か）は書き込み経路にしか無く、fallback も無い。しかも `StorageKeys` の中で `_version` で終わるキー（`privacy_consent_version` / `gemini_api_version` / `tranco_version`）は**すべて文字列値の通常キー**で、判別子が想定した形状（数値 CAS）は `StorageKeys` には存在しない。つまり特別扱いは「壊す形状」だけを実在させ、「守る形状」は名前から動的に生成されるものだけだった。
5. **なぜ長く残ったのか** — 落ち方が**静か**（`{}` を返すだけ）でテストは緑のまま。port を使うテストは数値 CAS か、別ハーネス（`chrome.storage.local` モック）で seed しており、**2 実装を文字列 `*_version` で比較するテストが無かった**。

**原因**: `*_version` という命名規約を「CAS 世代番号」の意味に流用してポートに特別扱いさせ、その判別に fallback が無かったこと。かつ、その特別扱いが守る対象を実際には持っていなかったこと。

**示唆**:
- PBI の推奨（選択肢 1: 数値でなければ `store` に入れ、`get` の version 分岐に fallback を足す）でも症状は消えるが、**規約の多重定義は残る**。将来 `_version` で終わる通常キーに数値を書けば再び `versions` に吸われ、`remove` と `getBytesInUse` がずれる（同じ規約を 5 箇所の分岐が別々に解釈している状態が続く）。
- ポートは「chrome と同じ素のキー・バリュー」であるべきで、CAS の意味は `StorageTransaction` 側に閉じている。特別扱いを消せば、この分岐クラス自体が消える。
- 静かに落ちる double は緑のテストを生む。**parity テストが無いこと**が検出漏れの直接原因なので、そこに文字列 `*_version` を足す。

**解**: `versions` マップを廃止し、全キーを通常キーとして保存する（`get` / `set` / `remove` / `seed` / `dump` / `getBytesInUse` から規約依存を削除）。`getVersion()` は store から `<key>_version` を読む形へ。parity テストに文字列 `*_version` を追加。**PBI の推奨より踏み込んだのは、根因が「fallback の欠落」ではなく「規約の流用」だったため。**

### 実装

- `src/utils/storage/storagePort.ts` — `versions` マップを削除。`get` の 3 経路を store 参照のみに、`set` を全キー保存に変更。`getBytesInUse` から「`*_version` を飛ばして 8 バイト加算」を削除（値の JSON 長で数える）。`getVersion()` は store から読む形に変更。クラスの doc に `*_version` の 2 つの用途を明記。
- **同時に消えた 3 つの非対称**（いずれも依存なしを確認済み）:
  1. `get([<base>])` が、store に無く versions にある場合に `{ '<base>_version': N }` を返していた（要求したキーが結果に無い）。
  2. `seed()` だけが非数値 `*_version` を store に入れており、`set()` と挙動が違った。
  3. `remove()` が versions を消さず、削除後も世代番号が生き残っていた。
- **依存が無いことの確認**: production で `<key>_version` を読むのは `storageTransaction.ts` の 6 箇所（すべて `port.get([key, \`${key}_version\`])` と明示要求）と `settingsMigration.ts:352`（`get(null)` のスナップショット経由）のみ。`getVersion()` の呼び出し元は 0 件。

### テスト

- `src/utils/storage/__tests__/storagePort.test.ts` — `describe('*_version keys of both shapes')` を追加（5 テスト）: 文字列 ``*_version`` の 3 経路往復、seed した文字列キーの読み出し、`getBytesInUse` の計上、数値・文字列混在の `remove`、数値 CAS 世代の回帰ガード。
- `src/utils/storage/__tests__/storagePortCloneBoundary.test.ts` — parity のループに「文字列 `*_version` を通常キーとして保存する」を追加（InMemory と chrome モックの両方で回る）。
- **Red の確認**: 修正前に 5 件が失敗（InMemory 側 4 件＋parity 1 件）。chrome モック側の parity テストは修正前から通っており、差分が double 側にあることを示す。
- 回帰: `src/utils/storage/` 配下 61 ファイル 549 テストが緑。`npm run validate` exit 0（1095 files / 16416 tests。修正前 16409 から +7）。
- **なぜなぜで選んだ形の検証**: 数値 `*_version` の見え方を固定する回帰ガードを含めたので、CAS の観測結果が変わっていないことをテストで示している。

### ゲート

`npm run validate` exit 0（1095 files / 16416 tests）。`src/utils/storage/` の 61 ファイル・549 テストが緑。

## 関連

- `pbi/00-INDEX.md`
- [2026-10-19-03-fix-consent-keys-settings-blob-relocation.md](../../../pbi/2026-10-19-03-fix-consent-keys-settings-blob-relocation.md) — 発見の現場。同 PBI の落とし穴は本 PBI の完了で更新済み
- `dev-docs/archived/pbi/2026-10-16-12-refactor-migration-port-unify.md` — `StoragePort` への統一（本 PBI はその test double の忠実性）
- `dev-docs/ADR/` — `storagePort` の契約に関する ADR があれば実装時に参照（`grep -rl "StoragePort" dev-docs/ADR/`）
