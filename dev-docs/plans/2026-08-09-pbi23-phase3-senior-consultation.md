# Phase3 シニア相談資料

**PBI**: 2026-08-09-23 SQLiteトランスポート層削減
**対象**: Phase3（操作の宣言表、3pt）
**作成日**: 2026-08-10
**更新日**: 2026-08-10（事実検証・graphify調査・なぜなぜ分析により補強）

---

## 0. 事実検証サマリ（コード実測ベース）

| 主張 | 検証結果 | 根拠 |
|---|---|---|
| 送信側 `requireConfirmToken:true` は9箇所 | ✅ 正 | dashboardSqliteService.ts:183,202,218,235,279,367,392,439,462 |
| 受信側 `TOKEN_REQUIRED_SUBTYPES` は10件（backup_db含む） | ✅ 正 | dashboardSqliteProtocol.ts:65-67 |
| `backup_db` が受信側にあるが送信側に無い（ドリフト） | ✅ 正 | service.ts:414 にフラグ無し。CHANGELOG.md:1798 が v6.5.17 で受信側のみ追加と記録 |
| `exportDb()` は常にゲートで失敗する | ✅ 正（現在出荷中の実害） | exportLogsService.ts:125 → backupDb()（トークン無し）→ handlers.ts:63-74 で reject |
| 6 subtype に「token無し拒否」テストが無い | ✅ 正 | toggle_star/update/delete/import/backfill_metadata/cleanup_legacy |
| ハンドラ switch は20 case | ✅ 正 | handlers.ts:77-357 を実数え |
| トークンゲートは switch の外 | ✅ 正 | handlers.ts:63-74（switch より前） |
| offscreen の exhaustiveness check は維持される | ✅ 正 | offscreen.ts:340 `const _exhaustive: never = msg` |

**graphify 調査**: `TOKEN_REQUIRED_SUBTYPES`/`dashboardSqliteHandlers` は community 9（background/handlers）、`dashboardSqliteService`/`getConfirmToken`/`exportLogsService` は community 25（dashboard）。**受信と送信が別モジュール（別 community）に分かれ、共有の型で結ばれていない**。これがドリフトの構造的理由。

---

## 1. Phase3 の概要

宣言表 `SQLITE_OPERATIONS` を作成し、以下を導出する：
- `TOKEN_REQUIRED_SUBTYPES`（受信側ゲート）を配列から導出
- `dashboardSqliteService.ts` の各関数の `requireConfirmToken` フラグを宣言から自動化
- 「転送のみ」のハンドラ case を表から生成（残りは手書き）

---

## 2. 着手するべき最大の動機（ドリフトの実害）

### 2.1 現在のドリフト

| | 側 | 件数 | 内容 |
|---|---|---|---|
| `TOKEN_REQUIRED_SUBTYPES` | 受信（handlers.ts:65） | 10件 | toggle_star, update, delete, migrate, backfill_metadata, cleanup_legacy, clear_all, import, restore_db, **backup_db** |
| `requireConfirmToken: true` | 送信（dashboardSqliteService.ts） | 9箇所 | 上記9件（**backup_db を除く**） |

`exportLogsService.exportDb()`（:125）は `backupDb()`（:414、トークン無し）を呼ぶため、
**常に `"Confirmation token mismatch"` で reject され、`.db` バックアップが一切出力できない**。
CHANGELOG.md:1798（v6.5.17, Red Team）で受信側に `backup_db` が追加されたが、送信側 `backupDb()` の追随が漏れた。

### 2.2 なぜなぜ分析（ドリフトの根本原因）

- **なぜ1**: なぜ `exportDb()` は常に失敗するのか
  → 送信側 `backupDb()` が `confirmToken` を添付せず、受信側ゲートが `backup_db` を「要トークン」と判定して reject するから。
- **なぜ2**: なぜ送信側がトークンを添付しないのか
  → v6.5.17 で `backup_db` が `TOKEN_REQUIRED_SUBTYPES` に追加された際、対応する `dashboardSqliteService.backupDb()` の `requireConfirmToken: true` が書き忘れられたから。
- **なぜ3**: なぜ書き忘れが検出されなかったのか
  → 2つのリストが **別ファイル・別モジュール（community 9 vs 25）に手書きで二重保持**されており、共有の型で結ばれていない。片方を変えてもコンパイルエラーにならない。
- **なぜ4**: なぜテストも検出しなかったのか
  → サービス層テストは `chrome.runtime.sendMessage` をモックするため、「送信時にフラグが立っているか」を断言できない。受信側テスト（extra.test.ts:354）は「トークン無しで reject」を正しく検証しているため、逆に「送信側がトークンを送っていない」という欠陥が隠された。
- **なぜ5（根本・セキュリティ視点）**: これは単なるバグか、それとも脆弱性のseedか
  → **今日は「過剰防御（常に reject）」という機能停止に留まる**。しかし危険なのは逆方向の非対称性である:
  「送信側もトークンを送っていないのだから、受信側の `backup_db` も要トークンではないだろう」と**受信側から `backup_db` を削除**すれば、破壊的操作に対するトークンチェックが**黙って無効化**される。
  つまり「2箇所手書きの非対称リスト」は、**安全側へのズレは単なるバグだが、危険側へのズレはサイレントなセキュリティ低下**を生む構造を持っている。

**宣言表の真の価値**: 操作の「トークン要否」を単一ソース化し、かつ `requiresToken` を必須プロパティ＋網羅型表明にすることで、「破壊的操作のトークン要件が曖昧になる」という失敗モードそのものを構造的に排除する。これが PBI の thesis（「操作という概念が宣言として存在せず、暗黙的に散らばっている」）の核心である。

### 2.3 `backup_db` の分類と「唯一のガード」になぜなぜ

- **なぜA**: `backup_db` は破壊的操作か
  → **否**。中身は `sqliteClient.backupDb()` が `.db` を読んで base64 化して返すだけ（sqliteClient.ts:371, 388）。ユーザーデータを変更しない。
- **なぜB**: ではなぜ Red Team が `TOKEN_REQUIRED_SUBTYPES` に入れたか
  → 非破壊だが「全履歴DBのエクスポート」は機微な読み出し（全ブラウジング履歴の持ち出し）であり、防御深化としてトークンを要求したと解釈される（CHANGELOG.md:1798）。
- **なぜC**: トークンは何を守っているか
  → `exportLogsPanel.ts:57` は `exportDb()` を**確認ダイアログ無し**で呼ぶ（grep で modal/confirm なしを確認）。つまりプログラム上のトークンチェックが**唯一の**ガード。
- **なぜD（重要）**: それが何を意味するか
  → 受信側から `backup_db` を削除すれば、エクスポートは**ゼロガードで動くようになる**。現在は「過剰防御で壊れている」が、削除すれば「 guard なしで全履歴を持ち出せる」になる。2.2 の「危険側へのサイレントな非同期化」は、この `backup_db` が最も顕著な実例である。
- **なぜE（意思決定の分岐）**: では正しいfixはどちらか
  → 二択:
    - **(i) 送信側がトークンを送る**（service.ts:414 に `{ requireConfirmToken: true }` を1行追加。`withConfirmToken()` は既に実装済みでそれに乗る）。`backup_db` は「機微な読み出し＝要トークン」のまま。
    - **(ii) `backup_db` を `TOKEN_REQUIRED_SUBTYPES` から削除**する（エクスポートは非破壊だからトークン不要、という再分類）。この場合ドリフトは「送信側が正しく、受信側が過剰」と見なせる。
  → どちらを採るかはセキュリティ方針の判断。**宣言表を作る前に決めておかないと、表の内容（backup_db の `requiresToken`）が揺れる**。

**送信側fixの局所性**: `backupDb()` の修正は `sendDashboardMessage({ subtype: 'backup_db' })` を `sendDashboardMessage({ subtype: 'backup_db' }, { requireConfirmToken: true })` にするだけ。`withConfirmToken()`（service.ts:59-62）が session からトークンを取得・添付するので、他実装は不要。

### 2.4 `backup_db` 方針の pros/cons（深掘り・未決定）

両案とも「現在の export が 100% 壊れている」実害を解消する。違いは**ガードの有無**。

**トークンの実効力の再考（重要）**:
- トークンチェックは SW ハンドラで行われるが、送信元は常に dashboard 拡張自身（registry `'extension-only'`）。
- `withConfirmToken()` は**呼べば自動で** session からトークンを取得・添付する。つまり同じ拡張内のコードが `exportDb()` を呼めば、意図に関わらずトークンを得る。
- よって `backup_db` のトークンは「**意図しない呼び出し（バグ等）の防止**」には効くが、「同じ拡張内の悪意あるコードによる持ち出し阻止」には弱い。
- 本当の強い防御は **UI 確認ダイアログ**（exportLogsPanel に「全DBをエクスポートしますか？」）であり、現在それは存在しない（2.3C）。

**案 (i): 送信側がトークンを送る（backup_db = 要トークンのまま）**
- Pros:
  - 現在唯一のガードを維持（2.3C: UI modal なし）。削除すればゼロガードになる。
  - Red Team の意図（CHANGELOG:1798「全DBバックアップ操作に確認トークンを要求」）と合致。彼らはゲートが**発火する**ことを期待しており、送信側の忘れがバグと読める。
  - 修正は1行。`withConfirmToken()` 既存。宣言表は `backup_db.requiresToken=true` で特例なし。
  - 機微な全履歴エクスポートへの防御深化として妥当。
- Cons:
  - `backup_db` は非破壊的読み出し。protocol.ts:64 のコメント「destructive/mutating operations」の語義に厳密には合わない（セマンティクスのゆらぎ）。
  - 非破壊操作へのトークン要求はやや過剰分類。session トークンが失効していれば再取得まで export が失敗（軽微なUX摩擦）。
  - 同一拡張内の悪意ある持ち出しは阻止できない（上記「実効力の再考」）。

**案 (ii): `backup_db` を `TOKEN_REQUIRED_SUBTYPES` から削除（非破壊エクスポートは不要と再分類）**
- Pros:
  - セマンティクスが正しい: 読み出し/エクスポートは destructive/mutating ではない。protocol のコメントとも整合。
  - ドリフトを「送信側が正しく、受信側が過剰」と見なして解消。送信側1行変更（`requireConfirmToken` を付けない）で一致。
  - 非破壊操作へのトークン摩擦が消える。
- Cons:
  - **セキュリティ低下**: export がゼロガードになる（2.3C: UI modal なし）。全ブラウジング履歴DBがガードなしで持ち出し可能に。
  - Red Team の明示的なセキュリティ判断（CHANGELOG:1798）を覆すため、根拠が必要。
  - 宣言表 `backup_db.requiresToken=false` とすると、「requiresToken = 破壊的または機微な読み出し」という意味づけになり、コメントの更新が必要。
  - (ii) を採るなら **補償制御として exportLogsPanel に UI 確認ダイアログを追加**しないと、セキュリティが現状（壊れているがガードはある）より悪化する。

**推奨（暫定）**: (i) を基本とし、backup_db のトークンを「意図しない呼び出しの防止」と位置づける。ただし真の強防御は UI 確認ダイアログであり、それは Phase3 の別タスク（または別PBI）として積み残す。決定はシニアのセキュリティ方針確認を経る。

---

## 3. 設計判断が必要な点

### 3.1 宣言表の配置場所

| 選択肢 | 長所 | 短所 |
|---|---|---|
| **A: SW 側** (`handlers/` 配下) | 受信側ゲートと同一層。変更が局所 | 送信側（dashboard, community 25）が SW 層を import する層間依存が発生 |
| **B: 共有層** (`messaging/` 配下) | 送受信両方が参照可能 | 新規ファイル。責務が曖昧になりやすい |

**推奨**: A。理由: 操作の「検証」は SW 側（community 9）の責務。送信側は `requiresToken` 値を読み取るだけの参照で済む。ただし  2.1 のドリフト再発を防ぐため、**送信側も同じ表から導出する**ことが必須（3.2）。

### 3.2 送信側フラグの導出方法

```typescript
// dashboardSqliteService.ts 各関数で:
const spec = SQLITE_OPERATIONS.find(o => o.subtype === 'backup_db');
// spec.requiresToken → requireConfirmToken に使用
```

**判断が必要**: この導出を実行時（`find`）にするか、ビルド時/型レベルで保証するか。
後者（例: 各関数に `SubtypeSpec<'backup_db'>` のような型を付与し、`requiresToken` をコンパイル時に参照）の方がドリフトを型で弾けるが、実装コストは高い。

### 3.3 `requiresToken` の安全側倒し

`requiresToken: boolean` を **必須プロパティ**にしても、誤った `false` を書かれることは型では防げない。

| 安全策 | 実現方法 | 状態 |
|---|---|---|
| 網羅型表明 | `DashboardSqliteSubtype extends SQLITE_OPERATIONS[number]['subtype']` | ✅ 計画済み |
| 拒否テスト | destructive 各件の「token 無し拒否」を検証 | ⚠️ 6件（後述 5.1）が未実装。計画の `it.each` 10件案も未存在 |

**Step 3-0（テスト先行）が必須**。テスト無しで宣言表を作ると、誤った `false` が潜んでも検出できない。

---

## 4. リスクポイックと対策（実測ベースの分類）

### 4.0 ハンドラ20 case の実測分類

実数（handlers.ts:77-357）:

| 分類 | case | 件数 |
|---|---|---|
| 純転送（deps呼び出し＋エラー写像のみ） | confirm_token, query, search, toggle_star, delete, get_count, clear_all, status, opfs_spike, audit_log_query | 10 |
| 転送＋軽い変換（生成時に変換を落とすと契約破壊） | backup_db（base64化）, migrate（結果再整形 read/inserted/error）, backfill_metadata（try/catch）, cleanup_legacy（try/catch） | 4 |
| 業務ロジック（手書き必須） | update（ALLOWED_UPDATE_FIELDS）, import（MAX_IMPORT_ROWS・バッチ）, restore_db（150MB上限）, append_to_obsidian（3段検証＋APIキー）, purge_now, content_purge_now | 6 |

**「生成対象」は「純転送10件」に限定すべき**。4件の「転送＋軽い変換」は一見転送だが変換を持つため、生成時に `bytesToBase64` 等を消すと応答契約が壊れる。

**純転送10件も「応答契約が同一」ではない**（重要）**: 各 case の戻り形は subtype ごとに異なる。
- `toggle_star` → `{ success: true, ...result.data }`（is_starred を展開）
- `get_count` → `{ success: true, count: number }`
- `query`/`search`/`audit_log_query` → `{ success: true, rows, total }`
- `delete`/`clear_all`/`confirm_token`/`status`/`opfs_spike` → それぞれ専用形

つまり「純転送」＝「業務ロジック・バリデーションを持たない」という意味であり、「応答をそのまま返せる」ではない。表駆動生成を行うなら、**subtype → deps メソッド の対応だけでなく、応答写像（どのフィールドを `{success:true,...}` に載せるか）も宣言に持たせる**か、あるいは生成を「deps 呼び出し＋共通エラー写像」の骨組みだけに留めて応答写像は各 case に残すか、の設計判断が必要。後者（骨組みのみ生成）ならリスクは低いが削減効果は限定的。

### 4.1 業務ロジック・変換を持つ case の取り扱い

| subtype | リスク | 対策 |
|---|---|---|
| `update` | `ALLOWED_UPDATE_FIELDS`（handlers.ts:12）のホワイトリスト所在が変わる | 生成対象外。手書き維持 |
| `import` | `MAX_IMPORT_ROWS`（handlers.ts:16）・バッチ処理が消える | 生成対象外 |
| `restore_db` | 150MB上限（handlers.ts:214）・base64 デコードが消える | 生成対象外 |
| `append_to_obsidian` | 3段検証＋APIキー確認（handlers.ts:243-260）が消える | 生成対象外 |
| `purge_now` / `content_purge_now` | 設定読み出し分岐（handlers.ts:292-321）が消える | 生成対象外 |
| `backup_db` | **`bytesToBase64(result.data)` 変換を持つ**（handlers.ts:338） | 生成対象外。手書き維持 |
| `migrate` | **`runMigration` 結果を read/inserted/error に再整形**（handlers.ts:87-89） | 生成対象外。手書き維持 |
| `backfill_metadata` / `cleanup_legacy` | **try/catch で「not available」を丸める**（handlers.ts:346,354） | 生成対象外。手書き維持 |

### 4.2 ゲートの位置

現在のトークン検証は `switch` の**外側**（handlers.ts:63-74）。

```typescript
// 現在: 正しい位置
if (TOKEN_REQUIRED_SUBTYPES.has(subtype)) {
  if (payload.confirmToken !== deps.getConfirmToken()) {
    return { success: false, error: 'Confirmation token mismatch' };
  }
}
switch (subtype) { ... }
```

生成コード化する際も**この位置を維持すること**。case 内に落とし込むと、業務ロジック側にも検証を書く必要が生じ、重複と脱落の両方が起きうる。

### 4.3 offscreen.ts の exhaustiveness check

`offscreen.ts:337-343` の `const _exhaustive: never = msg;` は Phase 1 で実証されたとおり、型導出の方法に依存せず機能する。

**注意**: offscreen の switch は `SqliteMessage`（SW↔offscreen 境界）を対象とし、Phase 3 の宣言表は `DashboardSqliteSubtype`（dashboard↔SW 境界）を対象とする。**別の union**。offscreen 側の exhaustive は Phase 3 では直接影響を受けない。

---

## 5. 既存テストの穴（着手前に埋める必要あり）

### 5.1 トークン拒否テストの不足

以下の6 subtype に「token 無しで拒否」テストが**存在しない**（成功系のみ）:
`toggle_star` / `update` / `delete` / `import` / `backfill_metadata` / `cleanup_legacy`

（存在するのは `clear_all`・`migrate`・`restore_db`・`backup_db` の4件。計画書 Step 3-0 の `it.each` 10件案は `backup_db` については既に実装済みのため重複する。）

**Step 3-0 で6件（または10件まとめて）の拒否テストを追加必須**。

### 5.2 送信フラグの検証テストが存在しない

サービス層テストは `chrome.runtime.sendMessage` をモックするため、
`requireConfirmToken` フラグの欠落（backup_db ドリフト）を**検出できない**。

宣言表導入後は、送信フラグが宣言と一致することを検証するテストが必要。
これにより 2.1 のドリフト（危険側へのサイレントな非同期化）を再発防止できる。

---

## 6. Phase3 の判断選択肢

| 選択肢 | 内容 | 工数 | リスク |
|---|---|---|---|
| **A. 実施** | 宣言表作成＋送信側導出＋純転送10件生成＋backup_db ドリフト同時修正 | 3pt | 中（テスト先行で抑制可） |
| **B. 送信側導出を省略** | 宣言表は受信側ゲートだけ。送信側は手書き維持 | 2pt | 低（ただし backup_db ドリフトは別途修正必須） |
| **C. 延期** | Phase 1・2 の価値は既に実現済み。Phase 3 は別PBIに切り出し | — | 低（現状維持、但し 2.1 の実害は継続） |

**推奨**: A（最大価値）。但し以下を最優先:
1. Step 3-0 で 6 subtype の拒否テストを追加（守りを固める）
2. `backup_db` ドリフトを宣言表導入と**同時に**修正（実害解消）
3. 送信側も宣言表から導出し、2箇所手書きを排除（ドリフト再発防止）

---

## 7. シニアに確認したいこと

**【決定済み】`backup_db` のトークン要否: 案 (i) 採用**
- (i) 送信側がトークンを送る（service.ts:414 に `{ requireConfirmToken: true }` を1行追加）。`backup_db` は「機微な全履歴エクスポート＝要トークン」のまま。
- 決定根拠: Red Team の意図（CHANGELOG:1798）と合致、現在唯一のガードを維持、修正は1行。詳細な pros/cons は 2.4 参照。
- 宣言表では `backup_db.requiresToken = true`（特例なし）。
- **未解決の別タスク**: 真の強防御となる exportLogsPanel の UI 確認ダイアログは Phase3 外の別PBI/タスクに積み残す（現状ゼロガードではないが、トークンの実効力は「意図しない呼び出しの防止」に留まるため）。

**【設計・決定済み】生成の粒度**: **応答写像まで生成**（4.0 参照）。純転送10件の subtype→depsメソッド 対応＋応答写像（rows/total/count/...result.data 等の展開）を宣言に持たせて完全生成する。宣言表のスキーマは `subtype / depsMethod / responseShape` を含めること。

**【設計】宣言表の配置場所**: A（SW 側 `handlers/`）でよいか
**【設計】送信側フラグの導出**: 実行時 `find` でよいか、型レベルでより厳密にするか
**【優先度】Phase 3 の実施順位**: 現状の他PBI（暗号化キー移行、AIClient削除）と比較して、いつ着手するか。ただし `backup_db` ドリフトの実害（2.1）は独立した紧急fixでも可。

---

## 8. 参考: 実測値（計画書・PBI 本文との乖離）

| 項目 | 計画書/PBI記載 | 実測値 |
|---|---|---|
| ハンドラ case 数 | 22 / 「switch 22」 | **20** |
| 「転送のみ」件数 | 10（計画書 Step 3-2） | **10（純転送）＋ 4（転送＋軽い変換）** |
| 業務ロジック件数 | 7（計画書）/ 5（PBI） | **6**（update/import/restore_db/append_to_obsidian/purge_now/content_purge_now） |
| TOKEN_REQUIRED_SUBTYPES | — | 10件 |
| 送信側フラグ | — | 9箇所 |

**計画書の分類表は正確性に欠ける**。着手前に実測値（本資料 4.0）で分類表を書き直す必要がある。
特に `backup_db`/`migrate`/`backfill_metadata`/`cleanup_legacy` は「転送のみ」に見えて変換を持つため、生成対象から除外すること。
