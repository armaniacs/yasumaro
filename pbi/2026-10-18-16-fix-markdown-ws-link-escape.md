# PBI: 空白区切りの `[text] (url)` 綴りをノート書き込み前に必ずエスケープする

## ユーザーストーリー

Obsidian のデイリーノートに閲覧履歴を溜めている利用者として、**攻撃者が支配するページの本文に `[text] (url)` 形式の空白区切りリンクが埋め込まれていても、それが実際のリンクとしてノートに現れない**ことを保証してほしい。履歴ノートは「自分で選んだ情報の置き場」なのに、その置き場に第三者が誘導リンクを仕込める状態になっているからだ。しかも既存のサニタイザチェーンは「空白なし」の綴りしか止めておらず、空白1つを挟むだけで素通りする。ノート本文の表示が変わる点には同意できるが、止めるべきものを環境依存の挙動に委ねたままにだけはしたくない。

並行して、セキュリティ監査の担当者とライブラリ使用者として、**CommonMark でも Obsidian live-preview でも「この綴りはリンクとしてレンダリングされない」と確定したうえで、実装の優先度を再評価できる**ことを望みたい。監査 verdict が `needs_validation` のまま「阻止すべきもの」が確定していないため、着手前に owner 確認を1回挟むのが正しい順序である。

## 優先度

- 順位: 16 / 25
- RICE: 750（Reach=100 / Impact=0.5 / Confidence=100% / Effort=0.1）
- 根拠: 監査16位。アクティブなサニタイザチェーンは、空白なしの markdown リンク綴り `[text](url)` だけをエスケープし、空白区切りの `[text] (url)` 綴りを攻撃者ページテキストからそのままノートの Obsidian daily note と gist plainLine へ通す。CommonMark のインラインリンク文法がリンクテキストと宛先の間の空白を禁じているため、この綴りは CommonMark では通常のリンクにならない可能性が高く（bounded local render で確かめられる）、Obsidian の live-preview で実際にクリック可能なリンクとしてレンダリングされるかは owner 観測に依存する。つまり「阻止すべきもの」が環境依存で確定していないため、実装前に owner 確認を1回挟むのが正当な順序。
- 種別: 🔧非機能追加（fix）
- 難易度: 🟢低
- 副作用: 🟡軽微（ノート本文の表示が変わる。空白を含むリンク表記を利用しているユーザーには影響しうる）

## 背景（監査の出典）

security-audit run-2 の needs_validation リード。fingerprint: `5dd75a26909c05452fb8bc16f24f6f7d4e8255c1fb71a0318ce27051dbae9062`。監査成果物: `/Users/yaar/security-audit-skill/obsidian-smart-history/run-2/`（`NEEDS-VALIDATION.md` 2番 / `findings.json` 29件中の1件、verdict: `needs_validation`）。

claimed root cause（監査原文）: "`sanitizeAllMarkdownLinks` pattern `/(!?)\[([^\]]*)\]\(([^)]+)\)/gi` (`markdownSanitizer.ts:56-58`, called from `sanitizeForObsidian:118`) requires `](` with no whitespace, and no normalization pass in the sanitize chain escapes or collapses the whitespace-separated spelling before the note write."

- [entrypoint] `src/background/handlers/recordingHandlers.ts:144`（service worker）— `VALID_VISIT` は `ValidVisitValidator` が長さ（最大 1,000,000 文字の非空文字列）に上限を掛けるだけで `message.payload?.content` を受け入れる。攻撃者ページテキストは変換されずにパイプラインへ入る。
- [propagation] `src/messaging/validators.ts:164` — `assertContentLength(payload.content, 'ValidVisitValidator')`。長さ境界のみ。内容変換はしない。
- [propagation] `src/background/pipeline/steps/truncateContentStep.ts:30` — UTF-8 で 64 KB へ切り詰められたテキストは `sanitizeForObsidian`（`markdownFormatter` の `sanitizeSummary` → `markdownSanitizer` の `sanitizeAllMarkdownLinks`）を通過する。空白なしリンク綴り・wikilink・HTML エンティティはエスケープされるが、`[text] (url)` 形は対象外。
- [propagation] `src/background/pipeline/steps/formatMarkdownStep.ts:59` — `buildEntryMarkdown(entryInput, 'obsidianList', entryOpts)`。summary は `markdownFormatter.ts:232` で `- ${timestamp} [${title}](${url})\n    - ${tags}${summary}` に埋め込まれる（インデント付きリスト行）。
- [sink] `src/background/pipeline/steps/saveToObsidianStep.ts:65`（service worker → Obsidian Local REST API）— `obsidianClient.appendToDailyNote(markdown, context.traceId)` がノート文字列をデイリーノートへ書き込む（`:63` は replayWrite 分岐）。
- [sink] `src/background/syncTargets/gistSyncTarget.ts:64-67` — 同じ cleanse 済み summary が `normalizeSummary: false` / `summaryFallback: null` で第2の派生シンク（gist plainLine、`markdownFormatter.ts:210` の `- [${title}](${url}): ${summary}`）へ到達する。

**実装者が見落としやすい構造的ポイント（実ファイルで確認）**: `markdownFormatter.ts:77` の `normalizeSingleLine` は `.replace(/  +/g, ' ')` を含む。つまり `sanitizeSummary`（`:94` で `normalizeSingleLine` → `:95` で `sanitizeForObsidian`）は、**改行や連続スペースで `](` を分断していた攻撃者ペイロードを、能動的に `[text] (url)` という空白区切り形へ変換する**。`[text]\n(https://evil.example)` はノートの summary 行で `[text] (https://evil.example)` に正規化される。よって「攻撃者は最初から空白区切り綴りを書く必要はない」。エスケープする側を空白許容にするなら、`normalizeSingleLine` の**後**に掛ける必要がある。既存の呼び出し順（`:94` → `:95`）はこの条件を満たしているため、チェーンの順序変更は不要。

## BDD受け入れシナリオ

1. **Scenario: 空白区切りの `[text] (url)` はノートへ書き込まれる際にエスケープ済みになる**
   - **Given** 攻撃者ページの本文に `click [here] (https://evil.example/phish)` が含まれている
   - **When** そのページを `VALID_VISIT` で記録し、`privacyPipeline` → `formatMarkdownStep` → `saveToObsidianStep` を通す
   - **Then** `appendToDailyNote` に渡される markdown に `[here] (` という生の空白区切り綴りが残っていないこと
   - **And** 該当箇所が `\[here\]\(` ではなく `\[here\] \(https://evil.example/phish\)` のように、角括弧・丸括弧がすべてバックスラッシュで前置された形になっていること

2. **Scenario: 空白なしの通常の `[text](url)` の挙動は変わらない（回帰ガード）**
   - **Given** 記録対象の summary に `click [here](https://example.com/page)` が含まれている
   - **When** `sanitizeAllMarkdownLinks` / `sanitizeForObsidian` を通す
   - **Then** 出力は従来どおりの `click \[here\]\(https://example.com/page\)` であること
   - **And** 空白区切り対応のためにスペースが削除されないこと（すなわち `\[here\] (https://example.com/page\)` のような表記に変わっていないこと）

3. **Scenario: 改行で `](` を分断したペイロードも、空白区切り形として扱われる**
   - **Given** 攻撃者ページの本文に `click [here]\n(https://evil.example/phish)` が含まれている
   - **When** Obsidian 経路（`normalizeSummary` 有効）で `sanitizeSummary` を通す
   - **Then** `normalizeSingleLine`（`markdownFormatter.ts:77`）が改行を単一スペースへ畳んだうえで、出力に生の `here] (` が現れないこと
   - **And** gist 経路（`normalizeSummary: false`、`gistSyncTarget.ts:65`）では生改行が保持されたうえで、同様に生の空白区切り綴りが現れないこと

4. **Scenario: 画像リンクの空白区切り形も同様にエスケープされる**
   - **Given** 攻撃者ページの本文に `![alt] (https://evil.example/track.png)` が含まれている
   - **When** `sanitizeAllMarkdownLinks` を通す
   - **Then** 出力は `!\[alt\] \(https://evil.example/track.png\)` となり、`!` の位置と後ろ続括弧のエスケープが両方揃っていること
   - **And** 空白なし形 `![alt](https://example.com/a.png)` の出力が従来どおり `!\[alt\]\(https://example.com/a.png\)` であること（回帰ガード）

5. **Scenario: 通常の英文括弧表現を誤ってリンク扱いしない（副作用のpin）**
   - **Given** 通常の英文本文に `the three options [sic] (see the appendix (page 3))` が含まれている
   - **When** `sanitizeAllMarkdownLinks` を通す
   - **Then** 出力の**意味**が変わらないこと（可読性は変わりうるが、括弧の並びが崩れない）
   - **And** このケースが「空白区切り形として無条件に丸める」実装で壊れないことを、期待値として pin しておくこと

6. **Scenario: 空白1つ以上のゆらぎとタブ・全角スペースを吸収する**
   - **Given** summary に `[here]  (https://evil.example)`（スペース2つ）、`[here]\t(https://evil.example)`（タブ）、`[here]　(https://evil.example)`（全角スペース）が含まれる
   - **When** `sanitizeAllMarkdownLinks` を通す
   - **Then** いずれも角括弧・丸括弧がエスケープされた形になり、生の `](` に相当する綴りが残らないこと
   - **And** `sanitizeForObsidian` の後段 `escapeObsidianWikilinks`（`markdownSanitizer.ts:121`）と HTML エンティティ化（`:126-129`）が壊れないこと

## 受け入れ基準

- [ ] `src/utils/markdownSanitizer.ts:56` の `allMarkdownLinkPattern` が、リンクテキストと宛先の間の空白を許容する形（`]\s*(`）に変更されていること。空白なし形が引き続きマッチすることを既存テストで担保すること
- [ ] `src/utils/markdownSanitizer.ts:58` の置換が、**間にある空白を保持する**形になっていること。現状の置換は `$1\\[$2\\]\\($3\\)` で空白という概念が無いため、空白許容にすると `[text] (url)` → `\[text\]\(url\)` となりノート本文からスペースが消える。`(!?)\[([^\]]*)\](\s*)\(([^)]+)\)` のように空白キャプチャのグループを持たせ、`$1\\[$2\\]$3\\($4\\)` のように**空白を残して**置換することが副作用 🟡軽微 を最小にする
- [ ] `src/utils/markdownSanitizer.ts:112-132` の `sanitizeForObsidian` 内の順序（`:118` リンク → `:121` wikilink → `:126-129` HTML エンティティ）が維持されていること。特にエスケープが HTML エンティティ化の**前**である理由（`&` を先にエンコードしないと後続の `;` が再エンコードされる）をコメントで残すこと
- [ ] Obsidian 経路と gist 経路の**両方**で空白区切り形が停止していること。統合確認先は `src/background/pipeline/steps/formatMarkdownStep.ts:59`（`obsidianList`、summary は `markdownFormatter.ts:232` でインデント付きリスト行に埋め込まれる）と `src/background/syncTargets/gistSyncTarget.ts:64-67`（`plainLine`、`normalizeSummary: false`）の両方
- [ ] 既存テスト `src/utils/__tests__/markdownSanitizer.test.ts`（336行）・`markdownSanitizerBoundary.test.ts`（63行）・`src/utils/__tests__/markdownFormatter.test.ts`（378行）の期待値が**一切変更されていない**こと。差分が出るなら、それは回帰ではなく意図した挙動変更として BDD シナリオで明示されていること
- [ ] `sanitizeMarkdownLinks`（`markdownSanitizer.ts:26-37`、http/https 限定・旧実装）は、本 PBI のスコープ外として変更しないこと。アクティブなチェーンは `sanitizeAllMarkdownLinks` のみであり、両者を同居させると「どちらが効くか」の混乱が増える
- [ ] ブロッカー（下記）が解消され、解消結果が PR 記述と監査 fingerprint `5dd75a26909c05452fb8bc16f24f6f7d4e8255c1fb71a0318ce27051dbae9062` の隣に記録されていること。未解消のまま実装に進んだ場合は `needs_validation` のままなので、その旨を実装メモに残すこと
- [ ] `dev-docs/SECURITY_REVIEW_GUIDE.md` の Markdown/ノート書き込みのサニタイズ節に「空白区切りリンク綴りも停止対象」と1行追記されていること（攻撃面の記述が実装とずれるのを防ぐ）

## テスト戦略

- 単体: `sanitizeAllMarkdownLinks` に空白区切り形（`[here] (https://evil.example)`）と通常の形（`[here](https://example.com)`）を渡し、**前者のみ**エスケープされることを pin。加えて、空白2つ・タブ・全角スペース・`![alt] (url)`・英文括弧表現（`[sic] (see ...)`）の非破壊を `src/utils/__tests__/markdownSanitizer.test.ts` に追加する。境界テストは既存の `markdownSanitizerBoundary.test.ts` の書式に揃える（新規 describe を足すか、既存 describe に追加するかを既存構成を見て決める）。実時間待ち禁止のルール（`AGENTS.md`「Async / Timing Failures」）に従い、`waitForMock` / `expect.poll` 系の待ちを一切持ち込まない
- 統合: `privacyPipeline`（`src/background/privacyPipeline.ts`）→ `formatMarkdownStep`（`sanitizeForObsidian` 経由）→ `saveToObsidianStep` の経路、および `gistSyncTarget` への波及。既存テストの受け皿として `src/background/pipeline/steps/__tests__/formatMarkdownStep.test.ts` と `src/background/__tests__/recordingPipeline-impl.test.ts` が既に `sanitizeForObsidian` / `sanitizeAllMarkdownLinks` を参照しているため、そこへ「空白区切り形が `appendToDailyNote` 引数に含まれない」1 ケースを追加する。gist 側は `normalizeSummary: false` の分岐を必ず通すこと（`gistSyncTarget.ts:65`）。タイムアウトや固定 sleep は使わない
- E2E: owner 観測（隔離 test vault に空白区切りリンクを含むページを保存し、Obsidian がクリック可能リンクとしてレンダリングするか確認）。自動化できない観測なので、`dev-docs/TESTING_GUIDE.md` の手動テストチェックリストに1項目として足し、観測結果を PR に貼り付ける。ローカル側では bounded CommonMark レンダラ（ネットワーク無し・本番データ無し）で `[text] (url)` と `\[text\] \(url\)` の対をレンダリングし、CommonMark 側の挙動だけでも確定させる

## 実装メモ（実装者向け）

### 対象ファイルと該当行（実ファイルで確認済み）

| ファイル | 行 | 内容 |
|---|---|---|
| `src/utils/markdownSanitizer.ts` | 56 | `allMarkdownLinkPattern = /(!?)\[([^\]]*)\]\(([^)]+)\)/gi` — `]` と `(` の間に空白を許さない |
| `src/utils/markdownSanitizer.ts` | 58 | `text.replace(allMarkdownLinkPattern, '$1\\[$2\\]\\($3\\)')` — 空白という概念が無いため、許容するとスペースが消える |
| `src/utils/markdownSanitizer.ts` | 112-132 | `sanitizeForObsidian`。順序は 118 リンク → 121 wikilink → 126-129 HTML エンティティ |
| `src/utils/markdownSanitizer.ts` | 72 | `escapeObsidianWikilinks` の `(!?)\[\[([^\]]*)\]\]`（空白無しの別系統。改変しない） |
| `src/utils/markdownSanitizer.ts` | 26-37 | `sanitizeMarkdownLinks`（http/https 限定・旧実装。アクティブなチェーンでは未使用。変更しない） |
| `src/utils/markdownFormatter.ts` | 76-78 | `normalizeSingleLine`。`:77` の `.replace(/  +/g, ' ')` が `[text]\n(url)` を `[text] (url)` へ**能動的に生成する** |
| `src/utils/markdownFormatter.ts` | 91-96 | `sanitizeSummary`。`:94` で正規化 → `:95` で `sanitizeForObsidian`。順序は既に「正規化後・エスケープ後」で正しい |
| `src/utils/markdownFormatter.ts` | 117 | tagPrefix も `sanitizeForObsidian` を通る（`#tag` の後ろに空白区切りリンクが来る余地） |
| `src/utils/markdownFormatter.ts` | 232 | `obsidianList`。`- ${timestamp} [${title}](${url})\n    - ${tags}${summary}` — summary はインデント付きリスト行に載る |
| `src/utils/markdownFormatter.ts` | 210 | `plainLine`。`- [${title}](${url}): ${summary}` |
| `src/background/pipeline/steps/formatMarkdownStep.ts` | 59 | `buildEntryMarkdown(entryInput, 'obsidianList', entryOpts)` |
| `src/background/handlers/recordingHandlers.ts` | 144 | `content: message.payload?.content \|\| ''`（入口。変換なし） |
| `src/messaging/validators.ts` | 164 | `assertContentLength`（長さ境界のみ） |
| `src/background/pipeline/steps/truncateContentStep.ts` | 30 | 64 KB 切り詰め。これ以降は縮まない |
| `src/background/pipeline/steps/saveToObsidianStep.ts` | 63, 65 | `appendToDailyNote(markdown, ...)`（`:63` は replayWrite） |
| `src/background/syncTargets/gistSyncTarget.ts` | 64-67 | `plainLine` + `normalizeSummary: false` + `summaryFallback: null`（第2シンク） |
| 既存テスト | — | `src/utils/__tests__/markdownSanitizer.test.ts`（336行）/ `markdownSanitizerBoundary.test.ts`（63行）/ `markdownFormatter.test.ts`（378行）/ `src/background/pipeline/steps/__tests__/formatMarkdownStep.test.ts` |

### 最小変更の選択肢

1. **パターンの空白許容（最小）**: `src/utils/markdownSanitizer.ts:56` を `(!?)\[([^\]]*)\](\s*)\(([^)]+)\)` にし、`:58` を `$1\\[$2\\]$3\\($4\\)` に変更する。1ファイル・2 hunk。**副作用最小の形**（空白を保持するのでノート本文の見た目が変わるのは「リンクとして解釈されずリテラルになる」だけ）。BDD シナリオ 1〜4 を直接カバーする
2. **チェーンに「リンク綴りの正規化パス」を追加**: `sanitizeForObsidian`（`:112-132`）の先頭に、空白区切り形を `](` に丸める正規化パスを1段足し、既存のエスケープに掛ける。選択肢 1 とほぼ同じ結果だが、丸めた後続の `escapeObsidianWikilinks`（`:121`）と HTML エンティティ化（`:126-129`）をそのまま再利用できる。**新しい関数と新しい export が要るので単体テストの追加分のコストが増える**。選択肢 1 で足りなければ採らない
3. **レンダラに依存せず note へ出る前に常にエスケープする（最も防御的）**: sink（`saveToObsidianStep.ts:65` と `gistSyncTarget.ts:64`）で、直前に同一の空白許容エスケープをもう一度掛ける。2つのシンク両方への変更になるため「チェーンが将来ずれてもシンク側で守る」という二重化になるが、サニタイザの SSOT は `markdownFormatter` に1つだけという現設計（`AGENTS.md` の "Markdown-link handling lives in `src/utils/markdownSanitizer.ts`"）に反する。**既定では採らない**。選択肢 1 の後に、E2E 観測でなおリンク化することが示された場合ののみ再検討

推奨は **選択肢 1**。1ファイル 2 hunk で、既存のサニタイザ順序（正規化 → リンク → wikilink → HTML）に自然に収まり、既存テストの期待値も触らない。

### 落とし穴

- **空白許容パターンだけではノート本文のスペースが消える**: `:58` の現状の置換文字列に空白の概念が無いこと。選択肢 1 を「パターンだけ `\s*` を足す」と実装するとノート本文のスペースが消え、副作用 🟡軽微 の範囲が読めなくなる。空白キャプチャのグループを持たせること
- **`normalizeSingleLine` が攻撃者の空白区切り形を作る**: `markdownFormatter.ts:77`。`[text]\n(url)` や `[text]   (url)` は、ノートに入る時点ではすでに空白区切り形になっている。「攻撃者が空白を最初から書く必要がある」という前提でテストを書くと、**一部をテストできない**。BDD シナリオ 3 はこの正規化込みで成立させる
- **gist 経路は `normalizeSummary: false`**: `gistSyncTarget.ts:65`。ここは生改行が保持され、`markdownFormatter.ts:210` の plainLine 組み立てで改行が実際の行分割になる。`\s` が `\n` を含むので表示上は `\n` を保持したまま括弧だけエスケープされる形になる。「空白許容」が改行区切りまで適用されることの副作用を、テストで期待値として固定する
- **英文の誤検知**: `the three options [sic] (see the appendix)` のような自然文は空白区切り形に該当しうる。正しく「止めるべきリンク」に見えるが、括弧を全部エスケープすると可読性が落ちる。BDD シナリオ 5 で「意味が変わらない」ことだけ pin し、可読性そのものは受け入れ基準にしない
- **wikilink 系統との混同**: `escapeObsidianWikilinks`（`:72`）は `[[...]]` で空白を許さない別パターン。`:56` を変えた副作用が `:72` に伝播していないか、`sanitizeForObsidian` の順で両方を確認する

### ブロッカー（着手前に潰すべき owner 確認）

- **B1**: CommonMark で `[text] (url)` はリンクとしてレンダリングされるか。CommonMark のインラインリンク文法はリンクテキストと宛先の間の空白を禁じているため、bounded local render では「リンクにならない」方向に倒れる可能性が高い。**local**: 固定フィクスチャ `[text] (url)` と対照 `\[text\] \(url\)` を、ネットワーク無し・本番データ無しの bounded local CommonMark レンダラと本リポジトリの markdown パイプラインの両方に通す
- **B2**: ユーザーの Obsidian アプリ（live-preview / reading view）は `[text] (url)` をクリック可能リンクとしてレンダリングするか。**deployment**: 隔離した test vault に空白区切りリンクを含むページ本文を保存し、Obsidian がリンクとして描画するか、リテラル文字列として描画するかを owner が観察して結果を記録する。B1 が「リンクにならない」ことを示しても、Obsidian は CommonMark 後日実装の独自 live-preview を持つため **B2 は独立に必要**
- **優先度再評価**: B1 と B2 の**両方**が「リンクとしてレンダリングされない」で確定した場合、本 PBI の business value は「ノート本文の偽リンク誤生成の防止」に縮む。Impact は 0.5 からさらに下がり、順位 16 のままでも順位 17〜25 相当に再評価し、実装は「ノート可読性の防御的改善」として小额なまま残すのが正当。逆に **B2 が「クリック可能リンクになる」で確定した場合**は順位を上げる（Obsidian ユーザー全員が live-preview を使うため Reach の見積もりを上方修正し、Impact も 0.5 を超えて 1.0 を検討）。この再評価は B2 の owner 観測の後、B1 の前にコードを書かずに必ず行う

### ロールバック手順

- 変更は `src/utils/markdownSanitizer.ts` の 2 hunk（`:56` のパターン、`:58` の置換）に閉じる。`git revert <commit>` で `src/utils/markdownSanitizer.ts` のみ戻せば、ノート書き込みの挙動は完全に現状へ戻る（他ファイルに**副作用のある変更を含めない**ため、選択肢 1 を選んでおく）
- リリース済ノートへの遡及修正は行わない。既に書かれたノートのリンク化は発生時点の挙動であり、本 PBI は今後の書き込み経路のみを直す
- 一時的な無効化が必要な場合は、`sanitizeAllMarkdownLinks` の入口で新パターンを無効化する1行を入れて環境フラグで分岐するより、パターン定数を差し替えるほうが安全。フラグ分岐は「既定状態で安全か」を毎回レビューで問うことになるため使わない

## 見積もり

0.3 SP（人週 1 日）。ブロッカー B1（bounded local render、0.5-1 時間）→ B2（owner 観測、隔離 test vault で 0.5-1 時間、待ち時間は作業時間外）→ 選択肢 1 のパターン+置換（0.5-1 時間）→ BDD シナリオ 1-6 の pin 追加（2-3 時間）→ 統合2経路（obsidianList / plainLine）の確認（1-2 時間）→ `npm run validate` とレビュー（1-2 時間）。ブロッカーの両方が「リンクにならない」で確定し優先度を 17〜25 相当へ引き下げた場合も実装量は変わらないため、工数上はほぼ 0.3 SP のまま。選択肢 2 を採る場合は新しい export とその単体テストが加わるため +0.2 SP、選択肢 3 を採る場合は 2 シンク分の変更と SSOT 設計の合意が必要で +0.5 SP。

## Definition of Done

- [ ] BDDシナリオが自動テストで実装されパス（単体 6 シナリオ + 統合 2 経路）
- [ ] `npm run validate` が緑
- [ ] 監査 fingerprint（`5dd75a26909c05452fb8bc16f24f6f7d4e8255c1fb71a0318ce27051dbae9062`）を完了記録に残す
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（`dev-docs/SECURITY_REVIEW_GUIDE.md` のサニタイズ節、`dev-docs/TESTING_GUIDE.md` の手動テストチェックリスト）

## 調査結果（2026-10-18）

- 判定: **RESOLVED（価値↓）**
- 決め手: CommonMark 仕様は「リンクテキストと直後の括弧の間に空白を許さない」と明記し、**Example 511 が `[link] (/uri)` を非リンクとして例示**。GFM も同一（Example 520）。Obsidian も CommonMark 準拠を表明し、フォーラムの実測（1.9.2）で空白があると live preview でも動作しないことが確認されている。局所レンダリング（markdown-it 14.3.1）でも `[text] (url)` は `<a href` を生成しない
- 影響: **クリック可能な偽リンクはどのレンダラでも発生しない**。business value は「`normalizeSingleLine` が能動生成する `[text] (url)` 表記をノートに残さない」「将来のレンダラ差異への防御」に縮む。**Impact 0.5→0.25（RICE 750→250）**。ただし実装は 1 ファイル 2 hunk で低コストなため実施価値は残る

## 関連

- pbi/00-INDEX.md
- `/Users/yaar/security-audit-skill/obsidian-smart-history/run-2/NEEDS-VALIDATION.md` 2番
- `/Users/yaar/security-audit-skill/obsidian-smart-history/run-2/findings.json`（fingerprint `5dd75a26909c05452fb8bc16f24f6f7d4e8255c1fb71a0318ce27051dbae9062`）
