# Offscreen クレンジング委譲の wire 契約を SSOT 型へ統一（fix）

## 1. タイトル + 種別

- **タイトル**: Offscreen クレンジング委譲の wire 契約を SSOT 型（`CleansingOffscreenResponse` / `CLEANSING_OFFSCREEN_TYPE`）へ統一する
- **種別**: fix（wire 契約の silent drift リスク解消。挙動不変）
- **見積もり**: 1 SP

## 2. 優先度

- **優先度**: 順位 6
- **RICE**: R3 / I1 / C1.0 / E1 → **3.0**
- **根拠**:
  - Offscreen 側に完全な応答型 `CleansingOffscreenResponse` と型定数 `CLEANSING_OFFSCREEN_TYPE` が SSOT として存在するのに、content 側デリゲートは応答 shape を手書きコピーしており、応答契約にフィールド（`totalRemoved` 等）が追加されたとき content 側の複製が silent drift する
  - `as unknown as never` → `as unknown as {...}` の二重キャストで送受信しており、wire 契約が型システムから隠れている
  - メッセージ型が文字列ハードコードで、SSOT 定数を重複している
- **依存**: なし。台帳の tie-break（同点 5-way のリスク軽減順）で wire 契約 silent drift が先頭のため、同順位候補より先に着地させる

## 3. ユーザーストーリー

**コンテンツバンドルの保守担当者として**、Offscreen クレンジング委譲のメッセージ契約が offscreen 側の SSOT 型と単一の情報源になっているほしい。なぜなら、content 側の手書き複製があると応答フィールドの追加がコンパイル時に検出されず、wire 契約が黙って drift するから。

## 4. 背景

content 側デリゲート（`cleanseViaOffscreen`）は Offscreen 応答 shape を自分のファイル内で弱い形に手書きコピーし、二重キャストで送受信している。Offscreen 側には完全な応答型 `CleansingOffscreenResponse` と型定数 `CLEANSING_OFFSCREEN_TYPE` が SSOT として存在するが、content 側はどちらも import しておらず、メッセージ型は文字列ハードコード。応答契約にフィールド（`totalRemoved` 等）が追加されたとき content 側の複製は silent drift する。

該当箇所（全 file:line 検証済み）:

- `src/content/cleansingOffscreenDelegate.ts:85-92` — `sendMessage({...} as unknown as never) as unknown as { success: true; html: string } | { success: false; error: string } | undefined`（手書き弱 shape）
- `src/content/cleansingOffscreenDelegate.ts:87` — `type: 'CLEANSING_OFFSCREEN'`（文字列ハードコード）
- `src/offscreen/cleansingOffscreen.ts:13` — `export const CLEANSING_OFFSCREEN_TYPE`（SSOT 定数。使用は `src/offscreen/offscreen.ts:110` のみ）
- `src/offscreen/cleansingOffscreen.ts:49` — `export type CleansingOffscreenResponse`（SSOT 型）
- 同一ファイル内の重複キャスト: `src/content/cleansingOffscreenDelegate.ts:27` と `:80` — `(globalThis as unknown as { chrome?: typeof chrome }).chrome`

対応方針（挙動不変）:

- `CLEANSING_OFFSCREEN_TYPE` と `CleansingOffscreenResponse` を `../offscreen/cleansingOffscreen.js` から import し、`:87` の文字列を定数に、`:85-92` の応答を SSOT 型で受ける
- 既存のガードはそのまま同一位置に残す: サイズ上限拒否でローカルパースに落とさない契約、`:97-105` の `TOO_LARGE_ERROR_PREFIX` チェック、`:55-65` の同期フォールバック上限（`MAX_CLEANSING_HTML_BYTES`）
- chrome 取得の 2 箇所（`:27` / `:80`）は 1 つのローカルヘルパーにまとめる

## 5. BDD シナリオ

### シナリオ 1: wire 契約が SSOT 型で統一される

```gherkin
Given cleansingOffscreenDelegate.ts が CLEANSING_OFFSCREEN_TYPE と CleansingOffscreenResponse を offscreen 側から import している
When 型チェックを実行する
Then メッセージ type が文字列ハードコードではなく SSOT 定数で構築されていること
And Offscreen 応答が手書き弱 shape ではなく CleansingOffscreenResponse 型で受けていること
And 応答受信の as unknown as {...} 手書きキャストが存在しないこと
```

### シナリオ 2: 応答 shape の複製が消え silent drift しない

```gherkin
Given 応答契約 CleansingOffscreenResponse が offscreen 側の SSOT 型である
When 応答にフィールド（totalRemoved 等）が追加される
Then content 側に手書きコピーされた応答 shape が存在せず silent drift が起きないこと
```

### シナリオ 3: 挙動が完全に不変である

```gherkin
Given 既存デリゲートテスト（contentKernel.offscreen.test.ts）の pin が維持されている
When リファクタリング後にテストを実行する
Then すべてのテストが無変更で通過すること
And TOO_LARGE エラー時は元 html を返しローカルパースにフォールバックしないこと
And その他の失敗・未対応環境では同期フォールバックすること
And 同期フォールバックのサイズ上限契約（MAX_CLEANSING_HTML_BYTES）が同一位置に維持されること
```

## 6. 受け入れ基準

- [x] `cleansingOffscreenDelegate.ts` が `CLEANSING_OFFSCREEN_TYPE` と `CleansingOffscreenResponse` を `../offscreen/cleansingOffscreen.js` から import している
- [x] `:87` の `type: 'CLEANSING_OFFSCREEN'` 文字列ハードコードが `CLEANSING_OFFSCREEN_TYPE` 定数に置き換えられている
- [x] `:85-92` の応答受信が `CleansingOffscreenResponse` 型で行われ、手書き弱 shape（`{ success: true; html: string } | { success: false; error: string } | undefined`）が削除されている
- [x] `:27` と `:80` の重複 `(globalThis as unknown as { chrome?: typeof chrome }).chrome` 取得が 1 つのローカルヘルパーにまとめられている
- [x] 既存ガードが同一位置に維持されている: `:97-105` の `TOO_LARGE_ERROR_PREFIX` チェック（サイズ上限拒否はローカルパースにフォールバックしない）、`:55-65` の同期フォールバック上限
- [x] 挙動が完全に不変である（既存テスト全通過、判定ロジック変更なし）

## 7. テスト戦略

1. **既存デリゲートテストの green 維持**: `src/content/__tests__/contentKernel.offscreen.test.ts`（`cleanseViaOffscreen — delegation with fallback`）の pin（フォールバック、TOO_LARGE 拒否、サイズ上限）は無変更で維持し、変更中の安全網として使う。Offscreen 側の `src/offscreen/__tests__/cleansingOffscreen.test.ts` も無変更で green を維持する
2. **型レベルの pin**: `npm run type-check` で SSOT 型 import が効いていることを確認する。手書き shape・文字列ハードコードの再出現は型チェックとレビューで検出する（wire 契約の複製を作らない）
3. **validate 通過**: `npm run validate`（type-check + test）で既存テスト全通過を確認する

## 8. 見積もり

**1 SP** — import 差し替え・定数利用・ローカルヘルパー抽出のみでロジック変更なし。影響範囲は `src/content/cleansingOffscreenDelegate.ts` 1 ファイル

## 9. DoD

- [x] 受け入れ基準 6 件すべて充足
- [x] `npm run validate`（type-check + test）が green
- [x] 既存デリゲートテスト（`contentKernel.offscreen.test.ts`）が pin 無変更で通過
- [x] `cleansingOffscreenDelegate.ts` 内に応答 shape の手書き複製が残っていない（grep で確認）
- [x] chrome 取得の重複キャストが解消（ローカルヘルパー 1 か所）
- [x] 既存機能への影響ゼロ（挙動不変）

## 10. 出所

- holistic-1009 ラウンド（[台帳](2026-10-09-00-backlog-holistic-1009.md)）
- RICE 順位 6（R3 / I1 / C1.0 / E1 → 3.0）
- 依存: なし
