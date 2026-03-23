# TrustDb static initPromiseとインスタンス状態の不整合修正

## Context

TrustDbクラスにstaticな`initPromise`とインスタンス状態(`this.state`)が混在しており、複数インスタンス作成時に初期化が二重実行される可能性があります。

**現状のコード:**
```typescript
class TrustDb {
  private static initPromise: Promise<void> | null = null;
  private state: TrustDbState = { ... };

  async initialize(): Promise<void> {
    if (this.state.initialized) {
      return;
    }

    if (TrustDb.initPromise) {
      return TrustDb.initPromise;
    }

    TrustDb.initPromise = this.doInitializeWithRetry(3);
    await TrustDb.initPromise;
  }

  private async doInitialize(): Promise<void> {
    // this.stateを更新
    this.state.database = ...;
    this.state.bloomFilter = ...;
    this.state.initialized = true;
  }
}
```

**問題点:**
1. static/instance混在: `TrustDb.initPromise`はstaticだが、`this.state`はインスタンス別
2. 二重初期化リスク: 複数インスタンス作成時にそれぞれが初期化を実行
3. 状態不整合: Instance 1の`initPromise`がInstance 2の初期化を待つが、Instance 2は自分のstateを更新

**使用状況（getTrustDb）:**
```typescript
export function getTrustDb(): TrustDb {
  // ✅ シングルトン返却 - 正しい使用
  if (!TrustDb.instance) {
    TrustDb.instance = new TrustDb();
  }
  return TrustDb.instance;
}
```

## Decision

### 修正方針: getTrustDbのみに責任を集中

**決定:**
- getTrustDb通过single instance patternを既に実装
- static initPromiseはgetTrustDb内で管理すべき
- TrustDbクラスからinitPromiseを削除し、初期化責任をgetTrustDbに移動

**実装パターン（after fix）:**
```typescript
const TrustDb = class {
  // static initPromise削除
  private state: TrustDbState = { ... };

  async initialize(): Promise<void> {
    if (this.state.initialized) return;
    await this.doInitialize();
  }
};

let trustDbInstance: TrustDb | null = null;
let initPromise: Promise<TrustDb> | null = null;

export function getTrustDb(): TrustDb {
  if (!trustDbInstance) {
    trustDbInstance = new TrustDb();
  }
  if (!initPromise) {
    initPromise = trustDbInstance.initialize().then(() => trustDbInstance!);
  }
  return trustDbInstance;
}
```

## Consequences

### Positive

- 意図明確: `getTrustDb()`が唯一の初期化ポイント
- ステート分離: static変数が`getTrustDb()`モジュール内に集約
- 二重実行防止: `initPromise`が最初インスタンスの初期化を管理

### Negative

- 既存インターフェース破壊: TrustDb.initialize()が必要なコードが影響を受ける
- テストコード修正: 直接TrsustDbインスタンスを作成するテストを修正

### Mitigation

- 後方互換性: TrustDb.initialize()は残し、内部でno-op（初期化済み時）

## Implementation Steps

- [x] ADR作成
- [ ] TDD Red: 初期化二重実行を検証するテスト作成
- [ ] TDD Green: initPromiseをgetTrustDbに移動
- [ ] TDD Refactor: TrustDb.initialize()をno-opに変更
- [ ] 統合テスト実行・検証
- [ ] ドキュメント更新

## Status

- **Proposed**: 2026-03-20
- **Approved**: 2026-03-20
- **Implemented**: -
- **Superseded By**: -