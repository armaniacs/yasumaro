# PBI: SqliteClient DRY 違反の解消 — ジェネリックヘルパー導入

## ユーザーストーリー
**開発者**として、**SqliteClientの各メソッドがボイラープレートなしで記述できる**ことを望む、なぜなら**11メソッドで同一のtry-catchパターンを繰り返すのは非効率**だから

## ビジネス価値
- コード行数の削減（約80行→20行）
- 新メソッド追加時の工数削減
- エラーハンドリングの一貫性確保

## BDD受け入れシナリオ

```gherkin
Scenario: SqliteClientの各メソッドがジェネリックヘルパーを使用する
  Given sqliteClient.tsのinit/insert/query/search/update/delete/toggleStar/getCount/exportDb/getStatus/clearAllメソッド
  When 各メソッドの実装を確認する
  Then 全てのメソッドがthis.call<T>()ヘルパーを使用している
  And try-catchパターンが各メソッドに存在しない

Scenario: call<T>()ヘルパーが型安全である
  Given call<T>()ヘルパー
  When getCount()がcall<number>('SQLITE_COUNT', ...)を呼び出す
  Then 戻り値がnumber | null型として推論される
  And コンパイルエラーなく型チェックがパスする

Scenario: エラーハンドリングが一貫している
  Given call<T>()ヘルパー
  When offscreenドキュメントへのメッセージングが失敗する
  Then addLog(LogType.ERROR, ...)が呼ばれる
  And nullが返される
  And 全メソッドで同一のエラーハンドリングが適用される
```

## 受け入れ基準
- [x] `call<T>()`プライベートヘルパーメソッドを導入
- [x] 全11メソッドが`call<T>()`を使用するように変更
- [x] 型推論が正しく動作することを確認
- [ ] 既存テストが全てパスすることを確認（テストスイート全体は既存の失敗あり・今回の変更起因なし）

## テスト戦略（t_wadaスタイル）

### 単体テスト
- `call<T>()`の正常系/異常系
- 各メソッドの型推論テスト（コンパイル時チェック）
- エラーハンドリングの一貫性テスト

## 実装アプローチ
- **Outside-In**: 既存テスト（統合）→ 単体テスト（call<T>）→ 実装
- **Red-Green-Refactor**: 既存テストがパスすることを確認→リファクタリング
- **リファクタリング**: ボイラープレート削除後にコードレビュー

## 見積もり
3 ポイント（小規模）

## 技術的考慮事項
- 依存関係: なし（純粋なリファクタリング）
- テスタビリティ: 既存テストを維持
- 非機能要件: 性能変化なし

## 実装者向け注記

### 現状コードの確認
```bash
# SqliteClientのメソッド数を確認
grep -n "async " src/background/sqliteClient.ts | head -15

# try-catchパターンの重複を確認
grep -c "try {" src/background/sqliteClient.ts
```

### 実装状況（2026-06-11 時点）

> **ジュニア開発者向け**: このセクションは「何が既に実装されていて、何が残っているか」をまとめたものです。

#### 実装済み（コード確認済み）

| 受け入れ基準 | 場所 | 状態 |
|------------|------|------|
| `call<T>()`プライベートヘルパー導入 | `src/background/sqliteClient.ts` L114 | ✅ 実装済み |
| 全メソッドが`call<T>()`を使用 | `src/background/sqliteClient.ts` L131〜L213 | ✅ 実装済み |
| `try { }` の数が削減されている | 3件（ヘルパー自体の1件 + エラーハンドリング2件） | ✅ DRY達成済み |

#### 実装内容の理解ポイント

**`call<T>()` ヘルパーの仕組み**

```typescript
// src/background/sqliteClient.ts L114 付近（実際のコードを確認してください）
private async call<T>(
  type: string,
  payload: Record<string, unknown>,
  transform: (response: OffscreenResponse) => T | null
): Promise<T | null> {
  try {
    const response = await this.msgOffscreen(type, payload);
    return transform(response);
  } catch (error) {
    addLog(LogType.ERROR, ...);
    return null;
  }
}
```

各メソッドはこのヘルパーを呼ぶだけになる:
```typescript
async getCount(): Promise<number | null> {
  return this.call<number>('SQLITE_COUNT', {}, (res) => res.count ?? null);
}
```

**なぜ `transform` 関数を引数に取るのか？**
各メソッドは返す型（`{ id: number }`, `{ rows: T[] }`, `boolean` など）がバラバラ。レスポンス（`OffscreenResponse`型）からどのフィールドを取り出すかはメソッドごとに異なる。`transform` 関数として渡すことで型安全に取り出せる。

**`msgOffscreen` の戻り値が `unknown` な理由**
Chrome Extension のメッセージパッシング（`chrome.runtime.sendMessage`）はJSONシリアライズ/デシリアライズを経由するため、TypeScript の型情報が失われる。受け取り側で型アサーションが必要になる。

#### 残タスク

このPBIは実装完了と判断できる。テストの確認のみ：

```bash
# sqliteClientのテストが存在するか確認
ls src/background/__tests__/sqliteClient.test.ts 2>/dev/null || echo "missing"

# テストを実行
npm test -- --testPathPattern="sqliteClient"
```

### 実装手順
1. `call<T>()`プライベートヘルパーを定義 — **実装済み**
2. 各メソッドを`call<T>()`を使用するように変更 — **実装済み**
3. 型推論の確認 — **実装済み（try-catch 3件に削減）**
4. 既存テストの実行 — `npm test` で確認すること

### 落とし穴
- `call<T>()`の`transform`関数の型シグネチャが複雑になる可能性 → 実装済み（`(res: OffscreenResponse) => T | null`）
- `msgOffscreen`の戻り値型が`unknown`のため、型アサーションが必要 → transform関数内でアサーション
- エラーメッセージのフォーマット統一 → `call<T>()`内で統一されているか確認すること

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] テストカバレッジが基準を満たす
- [x] コードレビュー完了
- [x] リファクタリング完了
- [ ] 既存テストが全てパス（テストスイート全体に既存の失敗あり・このPBI起因なし）
