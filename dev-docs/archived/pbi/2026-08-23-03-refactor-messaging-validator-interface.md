# PBI: Messaging Validator Interface Unification

**Date:** 2026-08-23  
**Priority:** Medium (DI clarity + maintainability)  
**Estimation:** 2 points

---

## ユーザーストーリー

**As a** メッセージハンドラー開発者  
**I want to** messaging validator が統一 interface で定義され、handler registry に明示的に紐付く  
**So that** スキーマ変更時に 1 箇所の修正で済み、新規 validator 追加時の紐付けを忘れない

---

## ビジネス価値

### 主要価値
1. **スキーマ単一化**: BrowsingLog, AIResponse など 5 ファイルに散在した validation を 1 interface に統一
2. **DI 明確化**: handler がどの validator を使うべきか、registry レベルで明示
3. **エラー検出**: 無効メッセージを早期に検出、silent fail を防止
4. **保守性向上**: schema 変更時に 5 箇所全て書き直す手作業を削減

### 測定方法
- ✓ MessageValidator<T> interface が定義される
- ✓ Handler registry にすべてのhandler が validator を登録している
- ✓ 無効メッセージ検出のテストが 5+ ケース通る
- ✓ schema 変更時に編集対象が 1 ファイルに集約される

---

## 現状とリスク分析

### 現在の実装状況

#### Validator の散在
```typescript
// src/messaging/sqliteValidators.ts
export function isSqliteOperation(msg: unknown): msg is DashboardSqliteRequest {
  return typeof msg === 'object' && msg !== null && 'operation' in msg
}

// src/background/handlers/recordingHandler.ts (implicit validation)
if (!isBrowsingLogValid(msg)) { /* handle error */ }

// src/background/handlers/aiHandler.ts (no explicit validator)
if (msg.type !== 'ai-summary') throw new Error('Invalid type')

// src/dashboard/... (validator scattered)
// src/messaging/types.ts (type defs only, no validators)
```

#### DI 非明確
```typescript
// src/dashboard/main.ts の handler registry
// どの handler がどの validator を使うか、明示されていない
```

### なぜなぜ分析: なぜ validator が散在しているのか？

**Question 1: 5 ファイルで validator が重複実装されているのはなぜ？**
- **Answer**: 歴史的な理由
  - 当初は messaging protocol が統一されていなかった
  - domain ごと（SQLite, BrowsingLog, AI）に別々に validation を実装
  - その後、型定義は types.ts に統一したが、validator は放置

- **根本原因**: validator interface が存在しない
  - 修正: `interface MessageValidator<T> { validate(msg: unknown): T }`

**Question 2: Handler が validator を明示的に紐付けていないのはなぜ？**
- **Answer**: DI pattern が未確立
  - Handler が個別に validation logic を埋め込んでいる
  - Handler registry に validator 登録の仕組みがない

- **根本原因**: messaging DI が新興段階
  - SQLite RPC は sqliteRpcClient.ts で service 層を確立済み
  - その他 domain (BrowsingLog, AI) は handler に直書き

**Question 3: Schema 変更時に 5 箇所全て更新する手作業が生じるのはなぜ？**
- **Answer**: スキーマ定義が 1 箇所（types.ts）だが、validator が 5 ファイル
  - types.ts で型定義 ← 単一ソース
  - validator は? ← 散在

- **根本原因**: Single Responsibility Principle 違反
  - 修正: schema = type + validator（1 ファイル、1 責務）

---

## BDD 受け入れシナリオ

```gherkin
Scenario: MessageValidator interface が定義され、全 validator がそれを実装する
  Given 5 ファイルに validator が散在している
  When MessageValidator<T> interface を定義し、全 validator が実装する
  Then validator の型シグネチャが統一される

Scenario: Handler registry に validator が登録され、明示的に紐付く
  Given Handler が validator を暗黙的に使っている（validation logic が散在）
  When Handler registry にすべての validator を登録
  Then Handler init 時に「このハンドラーが期待する validator」が明確化

Scenario: Schema 変更時に editor が「どのファイルを変更すべきか」を迷わない
  Given BrowsingLog schema に新フィールド追加が必要
  When 開発者が「validator を更新する場所」を search する
  Then 1 ファイル（validator implementation）に集約されている

Scenario: 無効メッセージが早期に検出され、ログされる
  Given invalid DashboardSqliteRequest が handler に到達
  When validator がそれを検出して error をスローする
  Then handler がそれをキャッチし、structured log に記録する
```

---

## 受け入れ基準

- [ ] `interface MessageValidator<T>` を `src/messaging/validators.ts` に定義
  ```typescript
  export interface MessageValidator<T> {
    validate(msg: unknown): T;  // throws if invalid
  }
  ```
- [ ] 既存 5 validator が interface を実装：
  - [ ] SqliteMessageValidator (sqliteValidators.ts)
  - [ ] BrowsingLogValidator (新規、現在 handler に散在)
  - [ ] AIResponseValidator (新規)
  - [ ] [他 2 domain validator] (例: 権限 validator など)
- [ ] Handler registry に validator を登録（MessageHandlerRegistry or handlers/ DI）
  - [ ] sqlite handler → SqliteMessageValidator
  - [ ] recording handler → BrowsingLogValidator
  - [ ] [他 handler] → [対応 validator]
- [ ] Invalid message テスト 5+ ケース
  - [ ] type mismatch 検出
  - [ ] required field 漏れ検出
  - [ ] 型違反検出（string vs number など）
  - [ ] error 時のログ記録確認
- [ ] npm run validate pass

---

## テスト戦略（t_wada スタイル Outside-In）

### E2E テスト
- Invalid DashboardSqliteRequest が handler に到達時、logged error が記録される
- Invalid BrowsingLog message が記録時に rejected される

### 統合テスト
- Handler registry に validator が紐付けられている
- Validator が thrown error を handler が catch できる
- Error が structured log に記録される（timestamp, validator name, message）

### 単体テスト
- SqliteMessageValidator: valid/invalid cases × 3
- BrowsingLogValidator: valid/invalid cases × 3
- AIResponseValidator: valid/invalid cases × 2
- [他 validators]: 各 2+ cases
- **Total: 15+ unit test cases**

### テストピラミッド
```
E2E (invalid message handling)
  2 テスト
  ├─ invalid SQLite request → logged
  └─ invalid BrowsingLog → rejected
統合テスト (handler + validator contract)
  5 テスト
  ├─ validator が registered & callable
  ├─ error 時に handler が catch
  └─ error が structured log
単体テスト (validator logic)
  15+ テスト
  ├─ each validator: valid/invalid/edge cases
  └─ error messages are descriptive
```

---

## 実装アプローチ

### Step 1: MessageValidator interface 定義
```typescript
// src/messaging/validators.ts (新規)
export interface MessageValidator<T> {
  validate(msg: unknown): T;
}

export class ValidationError extends Error {
  constructor(public validatorName: string, message: string) {
    super(message);
  }
}
```

### Step 2: 既存 validator の refactor
```typescript
// sqliteValidators.ts
export class SqliteMessageValidator implements MessageValidator<DashboardSqliteRequest> {
  validate(msg: unknown): DashboardSqliteRequest {
    // 既존 logic を method に move
    if (!isSqliteOperation(msg)) throw new ValidationError('SqliteMessage', '...')
    return msg as DashboardSqliteRequest
  }
}
```

### Step 3: 新規 validator 추출（BrowsingLog, AIResponse など）
```typescript
// src/messaging/browsingLogValidator.ts (새로 생성)
export class BrowsingLogValidator implements MessageValidator<BrowsingLogMessage> {
  validate(msg: unknown): BrowsingLogMessage {
    // handler에서 분산된 logic을 수집
  }
}
```

### Step 4: Handler registry에 validator 등록
```typescript
// src/background/handlers/handlerRegistry.ts (또는 DI layer)
const registry = new MessageHandlerRegistry()
  .registerValidator('sqlite', new SqliteMessageValidator())
  .registerValidator('browsing-log', new BrowsingLogValidator())
  .register('sqlite', new SqliteHandler(registry.getValidator('sqlite')))
  .register('record', new RecordingHandler(registry.getValidator('browsing-log')))
```

### Step 5: Handler에서 validator 호출
```typescript
// Handler 구현에서
class RecordingHandler {
  constructor(private validator: MessageValidator<BrowsingLogMessage>) {}
  
  async handle(msg: unknown) {
    const validated = this.validator.validate(msg)  // throws if invalid
    // use validated
  }
}
```

### Step 6: Error handling & logging
```typescript
// Handler wrapper에서
try {
  const validated = validator.validate(msg)
  await handler.handle(validated)
} catch (e) {
  if (e instanceof ValidationError) {
    logError({
      code: 'INVALID_MESSAGE',
      validator: e.validatorName,
      details: e.message,
      timestamp: Date.now()
    })
  }
}
```

---

## 実装者向け注記

### 現状確認
```bash
# 5 ファイルの validator location 確認
grep -rn "validate\|isSqliteOperation\|isBrowsingLog" src/messaging/ src/background/handlers/

# handler registry の現在の DI 構造確認
grep -n "register\|Registry" src/background/handlers/*.ts | head -20

# schema 型定義の確認
grep -n "type.*Message\|interface.*Message" src/messaging/types.ts | head -20
```

### なぜなぜ分析の結果（実装者向け参考）

**Q: なぜ validator interface が必要か？**
- A: 5 ファイルの validator が散在 → 統一 contract で整理 → schema 変更時に 1 ファイル

**Q: なぜ handler registry に登録するか？**
- A: Handler が validator を明示的に依存 → DI で wiring → 紐付け漏れ防止

**Q: なぜ早期検出が重要か？**
- A: Silent fail（無効メッセージが通る）→ runtime エラー（hard to debug）→ ログで可観測化

### 落とし穴
1. **Validator error の propagation**:
   - Error を throw vs return Result type
   - **推奨**: throw（handler が catch して log）

2. **Validator と type guard の混在**:
   - 既存：isSqliteOperation は type guard
   - 新: validator は throw するメソッド
   - **対応**: 両方共存（type guard は type safety、validator は runtime safety）

3. **Schema evolution**:
   - 新 field 追加時、validator も更新必須
   - **推奨**: schema変更が validator test を自動で fail させるテスト設計

---

## Definition of Done

- [ ] MessageValidator<T> interface が定義・デプロイ
- [ ] 全 5 validator が interface を実装
- [ ] Handler registry に validator が登録
- [ ] Invalid message テスト 5+ ケース通る
- [ ] Error logging が structured log に出力される
- [ ] npm run type-check pass
- [ ] npm run validate pass
- [ ] Code review 完了
- [ ] Refactor 完了（不要な implicit validation logic 削除）

---

## 参考資料

- [sqliteValidators.ts](src/messaging/sqliteValidators.ts)
- [MessageHandlerRegistry](src/background/handlers/messageHandlerRegistry.ts)
- [Handler implementations](src/background/handlers/)

---

## 次の Wave への接続

**Wave 4（検討）**: Messaging layer の完全な DI 統一
- **依存**: Wave 3 (validator interface) が完成してから
- **スコープ**: handler の完全な DI 化（storage adapter も含む）
- **見積もり**: 2-3 points
