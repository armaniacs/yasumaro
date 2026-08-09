# PBI: SQLite 操作のトランスポート層を段階的に削減する

**作成日**: 2026-08-09
**優先度**: 中（ただし**最後に実施**）
**見積もり**: 🔴大（8pt目安 / Epic規模）
**副作用**: 🔴あり（confirmToken によるセキュリティ経路に触れる）
**種別**: ♻️リファクタリング（refactor）
**進捗（2026-08-10）**: 🔶 部分実装。Phase 1（2pt）・Phase 2（3pt）完了。
Phase 3（3pt・要シニア相談）は着手せず、下記「Phase 3 着手前の判断材料」に
実測結果のみ記録した。

> ⚠️ **Epic規模（8pt）。着手前に必ずシニアと設計を相談すること。**
> Phase 1 のみ単独実施も可能な設計にしてある。

---

## フェーズ0: 既実装確認（実施済み・2026-08-09）

```bash
grep -rn "OPERATIONS\|OPERATION_TABLE" src/background src/messaging
# → 出力なし。操作を宣言する表は未実装
```

---

## 背景

アーキテクチャレビュー（2026-08-09、候補02）で、
**1つの SQLite 操作を追加するのに6ファイル・6層の手書きが必要**であることが判明した。

### 実測した6層

| # | ファイル | 内容 | 件数 |
|---|---|---|---|
| 1 | `src/messaging/sqliteMessages.ts` | union 20件 + **同じ内容の配列20件** | 40 |
| 2 | `src/background/sqliteClient.ts` | `call()` を包むメソッド | 24 |
| 3 | `src/background/handlers/dashboardSqliteProtocol.ts` | request 22 + response 22 | 44 |
| 4 | `src/background/handlers/dashboardSqliteHandlers.ts` | deps 24 + switch 22 | 46 |
| 5 | `src/dashboard/dashboardSqliteService.ts` | try/catch 関数 | 17 |
| 6 | `src/offscreen/offscreen.ts` | switch case | 20 |

**約20の実操作に対し、約1,400行のトランスポートコード。**

### 最も明白な重複: 同じ配列が2回書かれている

`src/messaging/sqliteMessages.ts`:

```typescript
export type SqliteMessage =
  | { type: 'SQLITE_HEALTH_CHECK'; ... }
  | { type: 'SQLITE_INIT'; ... }
  // ...20件...

/** SqliteMessage として扱う type の一覧。offscreen.ts の送信元検証で使用する。 */
export const SQLITE_MESSAGE_TYPES: readonly SqliteMessageType[] = [
  'SQLITE_HEALTH_CHECK',
  'SQLITE_INIT',
  // ...同じ20件を手で再掲...
];
```

**型と値で同じ一覧が2回。** 型からは値を導出できないため配列が要るのは事実だが、
**逆（配列から型を導出）は可能**であり、その向きなら二重化は消える。

### 最も浅い層: `dashboardSqliteService.ts`

17関数がすべて同じ形をしている。

```typescript
export async function clearAllLogs(): Promise<boolean> {
  try {
    const response = await sendDashboardMessage({ subtype: 'clear_all' }, { requireConfirmToken: true });
    return response.success === true;
  } catch (error) { console.error('clearAllLogs failed:', error); return false; }
}
```

`deleteLog` / `updateLog` / `restoreDb` は subtype 以外**完全に同一**。

### 失敗表現が4種類に分裂している

同じ「失敗した」が、関数によって別の形で返る。

| 表現 | 件数 | 例 |
|---|---|---|
| `null` | 11 | `toggleStar`, `migrateLogs`, `importLogs` … |
| `false` | 5 | `deleteLog`, `updateLog`, `clearAllLogs` … |
| `-1` | 1 | `getLogCount` |
| `{ error }` | 4 | `queryLogs`, `searchLogs`（PBI-19 で移行済み） |

**呼び出し側は関数ごとに違う流儀を覚える必要がある。**

### なぜなぜ分析

**なぜ1**: なぜ6層あるのか
→ SW ↔ offscreen、dashboard ↔ SW という**2つのプロセス境界**があり、
各境界に送信側・受信側があるから（2境界 × 2 = 4層 + 型定義2層）。

**なぜ2**: 境界が2つあるのは仕方ないのでは
→ **その通り。層の存在自体は正当。** 問題は層の**中身が手書き**であること。

**なぜ3**: なぜ手書きなのか
→ 操作を追加するとき、既存の似た操作をコピーして subtype を書き換えるのが
最も早い方法だったから。20回繰り返された。

**なぜ4**: なぜコピーが成立するのか
→ **操作ごとの差分が「subtype 文字列・payload の形・response の形・
トークン要否」の4項目しかない**から。それ以外は完全に同型。

**なぜ5（根本）**
**操作という概念が「宣言」として存在せず、
6箇所の実装の中に暗黙的に散らばっているから。**
`TOKEN_REQUIRED_SUBTYPES` という定数の存在がその証拠 —
「トークンが要るか」は操作の属性なのに、操作から切り離されて別の一覧になっている。

### 実際に起きた事故

この層の**配線ミス**が過去に4件の不具合を生んでいる。

- v6.7.26 で3件（PBI 2026-08-09-10, 12）
- `exportLogsPanel` で1件（PBI 2026-08-09-19）

**いずれも層の内部ではなく層と層の繋ぎ目で起きている。**
各層は個別にテストされているが、繋ぎ目は手書きなのでテストが届かない。

---

## ユーザーストーリー

**開発者**として、**SQLite 操作の追加・変更を1箇所の宣言で行える状態**がほしい、
なぜなら**現在は6ファイルの機械的な編集が必要で、その繋ぎ目の配線ミスが
過去4件の不具合を生んでいるから**。

## ビジネス価値

- **不具合クラスの根絶**: 「層の繋ぎ目の配線ミス」を構造的に起こせなくする。
- **変更コストの低減**: 操作追加が6ファイル → 1宣言。
- **測定方法**: 操作1件追加時の変更ファイル数（6 → 1〜2）、トランスポート層の行数。

---

## BDD受け入れシナリオ

```gherkin
Scenario: メッセージ型の一覧が二重化していない
  Given SqliteMessage の型と SQLITE_MESSAGE_TYPES の配列がある
  When 新しいメッセージ型を追加する
  Then 1箇所の編集で型と配列の両方が揃う

Scenario: dashboard 側の失敗表現が統一されている
  Given dashboardSqliteService の各関数を呼ぶ
  When 操作が失敗する
  Then すべて同一の形（Result union）で失敗が返る

Scenario: confirmToken の要否が操作の宣言から決まる
  Given 操作の宣言に「トークン要否」が含まれている
  When ハンドラがトークン検証を行う
  Then 別途の一覧ではなく宣言を参照する

Scenario: セキュリティ検証が保たれる
  Given destructive な操作（delete/clear_all/restore_db 等）がある
  When confirmToken 無しで呼び出す
  Then 従来どおり拒否される

Scenario: 既存の全操作が動作する
  When リファクタリング後に全 SQLite 操作を実行する
  Then すべて従来と同じ結果を返す
```

---

## 受け入れ基準（Phase ごと）

### Phase 1（単独実施可・2pt）
- [ ] `SQLITE_MESSAGE_TYPES` と `SqliteMessage` の二重化が解消されている
- [ ] `isSqliteMessageType` の挙動が変わっていない

### Phase 2（3pt）
- [ ] `dashboardSqliteService.ts` の失敗表現が Result union に統一されている
- [ ] 呼び出し側17箇所がすべて追随している

### Phase 3（3pt・要シニア相談）
- [ ] 操作の宣言表が存在し、`TOKEN_REQUIRED_SUBTYPES` が導出されている
- [ ] confirmToken のセキュリティテストが全て通る

### 共通
- [ ] `npm run validate` が通る
- [ ] 39テストファイルの影響を確認済み

---

## テスト戦略（t_wadaスタイル / Outside-In）

### E2Eテスト（最小限）
- 履歴の表示・検索・削除・エクスポートが動作する（既存E2E 185件で担保）

### 統合テスト（中程度）
1. **コントラクトテスト**: 全 subtype について「送信 → ハンドラ → 応答」が成立する
2. **セキュリティ**: token 必須の操作が token 無しで拒否される（**既存4テストファイルを維持**）
3. **境界**: `import` の 5000行上限、`restore_db` の 150MB 上限が保たれる

### 単体テスト（多数）
1. 宣言表から導出される各値が正しい
2. `isSqliteMessageType` が既知/未知の型を正しく判定する
3. 失敗表現の統一（各関数が Result union を返す）

### Outside-In の進め方
Phase ごとに「その Phase の受け入れ基準を検証するテスト」を先に書く。

---

## 実装アプローチ

**Phase 1 → 2 → 3 の順。各 Phase 単独でマージ可能。**
Phase 3 は着手前にシニアと相談する。

詳細は実装計画:
`dev-docs/plans/2026-08-09-pbi23-sqlite-transport-layers-plan.md`

---

## 見積もり

🔴大（8pt / Epic）— Phase 1: 2pt、Phase 2: 3pt、Phase 3: 3pt。

---

## 技術的考慮事項

### 依存関係
- **PBI 2026-08-09-21（変更系 Result 化）を先に完了させること。**
  Phase 2 の「失敗表現の統一」は21の成果に乗る。順序を逆にすると二度手間
- PBI-19（読み取り系）完了済み

### テスタビリティ
影響を受けるテストファイルは**39件**（実測）。
`dashboardSqliteTestHarness.ts` のアダプタ方式で吸収する方針を継続する。

### 非機能要件
- **セキュリティ（最重要）**: `TOKEN_REQUIRED_SUBTYPES` は destructive 操作の防護。
  導出に変える場合、**宣言漏れが「トークン不要」になってはいけない**。
  安全側の既定（宣言が無ければトークン必須）にすること
- **性能**: 影響なし

---

## 実装者向け注記

### 着手前に必ず実行

```bash
# 6層すべてを開いて全体像を掴む（これをやらずに始めると必ず迷う）
wc -l src/messaging/sqliteMessages.ts \
      src/background/sqliteClient.ts \
      src/background/handlers/dashboardSqliteProtocol.ts \
      src/background/handlers/dashboardSqliteHandlers.ts \
      src/dashboard/dashboardSqliteService.ts \
      src/offscreen/offscreen.ts

# 影響するテストの数を把握する
grep -rln "dashboardSqliteService\|dashboardSqliteHandlers\|sqliteClient\|sqliteMessages" src --include='*.test.ts' | wc -l
# → 39
```

### 最重要の落とし穴: 機械化してはいけない層がある

**ハンドラの switch case には「実際の業務ロジック」が入っている case がある。**
これらを「同型だから」と表に押し込むと、**セキュリティ検証や上限チェックが消える。**

| subtype | 機械化してよいか | 理由 |
|---|---|---|
| `query` / `search` / `get_count` / `audit_log_query` | ✅ 可 | 転送のみ |
| `delete` / `toggle_star` / `clear_all` | ✅ 可 | 転送のみ |
| `update` | ⚠️ 注意 | `ALLOWED_UPDATE_FIELDS` の検証がある |
| `import` | ❌ 不可 | `MAX_IMPORT_ROWS`、バッチ処理、エラー集約 |
| `restore_db` | ❌ 不可 | 150MB 上限、base64 デコード |
| `append_to_obsidian` | ❌ 不可 | 3段階の検証 + APIキー確認 + Obsidian 連携 |
| `purge_now` / `content_purge_now` | ❌ 不可 | 設定値の読み出しと分岐 |

**「転送のみ」の case だけを表から生成し、残りは手書きのまま残す**のが正解。
全部を機械化しようとすると必ず破綻する。

### 落とし穴: `TOKEN_REQUIRED_SUBTYPES` は安全側に倒す

```typescript
export const TOKEN_REQUIRED_SUBTYPES: ReadonlySet<DashboardSqliteSubtype> = new Set([
  'toggle_star', 'update', 'delete', 'migrate', 'backfill_metadata',
  'cleanup_legacy', 'clear_all', 'import', 'restore_db', 'backup_db',
]);
```

表から導出する際、**「宣言に書き忘れた操作がトークン不要になる」設計は禁止。**
`requiresToken: boolean` を**必須プロパティ**にして、
型レベルで書き忘れを防ぐこと（optional にしない）。

### 落とし穴: `offscreen.ts` の exhaustiveness check

`offscreen.ts:337-343` に `const _exhaustive: never = msg;` がある。
**新しい型を追加して case を書き忘れると型エラーになる**という安全装置。
表から型を導出する形に変えても、**この安全装置は必ず維持すること。**

### 落とし穴: Phase 2 の呼び出し側は17箇所では済まない

`dashboardSqliteService` の関数は dashboard 全体から呼ばれる。
戻り値の形を変えると、**呼び出し側すべてを追随させる必要がある。**

```bash
# 影響範囲を先に測る
grep -rn "deleteLog\|updateLog\|clearAllLogs\|toggleStar\|importLogs\|restoreDb" src --include='*.ts' | grep -v '__tests__' | wc -l
```

### 落とし穴: 一度に全部やらない

**39テストファイルが影響する。** 一括変更すると
「どの変更がどのテストを壊したか」が分からなくなる。
**Phase ごと、さらに Phase 内でも操作グループごとにコミットする。**

---

## Phase 3 着手前の判断材料（2026-08-10 実測）

Phase 1・2 実施の過程でわかったことをここに残す。
Phase 3 に着手するシニアはこれを起点にしてよい。

### Phase 1・2 で確定したこと

- `SQLITE_MESSAGE_TYPES` は配列を単一ソースとし、型を導出する形に変更済み。
  union と配列が片方向にでもずれるとコンパイルエラーになる表明を追加した
  （`sqliteMessages.ts` 末尾の `_UnionCoversArray` / `_ArrayCoversUnion`）。
  実際に配列から1件落として「型チェックもテスト71件も通る」ことを
  確認したうえで直しており、Phase 3 で操作表を作る際もこの二重チェック
  パターンを踏襲できる。
- `dashboardSqliteService.ts` の11関数すべてが `ServiceResult<T>` を返す。
  `getLogCount`（-1）と `getSqliteStatus`（診断情報オブジェクト）は
  計画どおり対象外のまま残した。
- 移行中に3件の実害を発見・修正済み（詳細は CHANGELOG）:
  `backupDb` の catch 節が理由を捨てて null を返していた／
  `importLogs` のバッチ失敗理由が全て捨てられていた／
  `appendToLogs` の catch 節が「Obsidian未設定」固定文言に丸められ、
  実際の失敗理由（SW未応答など）を隠していた。

### Phase 3 に持ち越す実測値

- ハンドラの22 case のうち「転送のみ」10件・「業務ロジックあり」7件・
  「注意が必要」1件（`update`）という計画の分類は、Phase 1・2 の作業中に
  該当コードを読み直した範囲では変わっていない。
- `TOKEN_REQUIRED_SUBTYPES` の10件（`toggle_star` `update` `delete` `migrate`
  `backfill_metadata` `cleanup_legacy` `clear_all` `import` `restore_db`
  `backup_db`）は現行のまま。Phase 2 では触れていない。
- confirmToken のセキュリティテストは4ファイル。Phase 2 の変更はいずれも
  `dashboardSqliteService.ts` より上の層（呼び出し元の理由表示）に閉じており、
  トークン検証そのものには触れていない。

### 未着手の理由

Phase 3 は「操作の宣言表を作り `requiresToken` を必須プロパティにする」という
セキュリティ経路そのものの変更であり、本PBIの計画書が明示的に
「要シニア相談」「最もリスクが高い」と位置づけている。この作業を行った
セッションにはシニアと直接相談する手段がなかったため、計画の指示に従い
Phase 3 には着手していない。

---

## Definition of Done

- [x] 実施した Phase（1・2）の受け入れ基準をすべて満たす。Phase 3 は未着手
- [x] confirmToken のセキュリティテスト4ファイルが通る（Phase 2 の変更後も変わらず通過）
- [x] `npm run validate` / `npm run build` / `npm run test:e2e` が通る
- [ ] コードレビュー完了（**セキュリティ経路のため必須**）— Phase 3 着手時に改めて必要
- [x] CHANGELOG.md に記載

---

## 関連

- アーキテクチャレビュー 2026-08-09（候補02）
- **前提PBI: 2026-08-09-21（変更系 Result 化）— 先に完了させること**
- PBI 2026-08-09-19（読み取り系 Result 化）
- 過去の配線ミス: 2026-08-09-10 / 2026-08-09-12
- ADR 2026-07-13 sqlite-architecture-deep-dig
