# PBI: ESLint `no-test-sleep` の閾値を 20ms から 0 に下げる

## ユーザーストーリー

開発者として、6〜19ms の `setTimeout` も ESLint で警告したい。そうすれば、小さい sleep も見落とさず、すべての固定待機を condition-based に置き換えられる。

## ビジネス価値

**現状**: `local/no-test-sleep` ルール（`eslint/rules/no-test-sleep.mjs` L12）の閾値が 20ms に設定。

```typescript
const DEFAULT_THRESHOLD_MS = 20;
```

6〜19ms の sleep は約 70 件（grep 未検出）。これらは以下の特徴：
- 通常、`setTimeout(resolve, 10)` / `setTimeout(resolve, 20)` と書かれた短い待機
- 本来なら `drainMacrotask()` で十分だが、タイミング理由で少し長く待ったもの
- 「念のため」的な待機で、本来なら condition-based に置き換え可能

閾値を **0 に下げる** メリット：
- すべての固定 sleep が警告される → 100% の置き換え達成
- ESLint rule の意図が明確になる（「固定 sleep は禁止」）

デメリット：
- `setTimeout(resolve, 0)` （マイクロタスク flush）が警告される → 多数の正当化コメント必要
- しかし、`drainMacrotask()` を使う習慣化には、小さい値も警告する方がよい

## 推奨アプローチ

**段階的対応:**

### Phase 1: 既存ルールのまま（現在）
- 閾値 20ms で error に昇格させている
- 6〜19ms は手動で `drainMacrotask()` に置き換え（別 PBI 検討）

### Phase 2: 「正当な 0ms」の定義
1. マイクロタスク flush を目的とした `setTimeout(r, 0)` の定義
2. その他の `setTimeout` を 6ms 以上は**違反**とする

### Phase 3: 閾値を 0 に下げ、0ms に明示的な例外
```javascript
const DEFAULT_THRESHOLD_MS = 0; // All fixed sleeps are disallowed

// In rule logic:
if (delay.value === 0) {
  // Allow: this is a macrotask flush
  // Must use drainMacrotask() or have eslint-disable comment
  return;
}
context.report(...);
```

## 見積もり

0.5 SP（ルール修正のみ）+ 1 SP（既存コードの置き換え） = 1.5 SP

この PBI だけで実装するのではなく、6〜19ms の置き換えと合わせて実施が推奨。

## 検討事項

- グローバルに `setTimeout(r, 0)` が何件あるか（`drainMacrotask()` で置き換え可能か）
- テスト util の `setTimeout(r, 0)` は許可するか、それとも utils に寄せるか
- `setTimeout(r, 0)` の正当性判定を ESLint で自動化できるか

## DoD（Definition of Done）

- [x] 6〜19ms の sleep を全て `drainMacrotask()` に置き換える（57 件・20 テストファイルを解消。**文脈分類の結果、drainMacrotask への置換は負の検証（vacuous negative の回避のため正の anchor + yield）のみ**。条件待ちは `waitForMock`、並行テストの疑似レイテンシ（aiUsageTracker）は `Promise.withResolvers` ゲート、debounce 等の production timer 対象は該当なし。各ファイルで 10〜20 回連続実行し全 green。グループ A: 15 件・B: 16 件・C: 16 件・D: 10 件）
- [x] `eslint/rules/no-test-sleep.mjs` の閾値を 0 に下げる（`DEFAULT_THRESHOLD_MS = 1`。**resolvable な正の delay はすべて error、0 のみ許可**）
- [x] `setTimeout(r, 0)` に対する例外処理を追加（`delay >= 1` で判定するため 0 は構造的に許可。ルールテスト 13 件で契約を pin）
- [x] `npm run lint` で violation 0 を確認する（eslint キャッシュをクリアした上で `local/no-test-sleep` 0 件・0 errors を確認）
- [x] `npm run validate` が PASS する（929 files / 14,402 tests green。ルールテストは旧 threshold 前提の pin を新契約に更新）

### 実装上の注記

- **`--repeats=N` がこのリポジトリでは no-op**（vitest 5.0.2 + workspace projects config が CLI の repeats を無視する。`--repeats=1` と `--repeats=5` で wall time が同一という実測）。AGENTS.md の repeat gate（`--repeats=20`）は機能していないため、subagent は「N 回連続の単独実行」で代替した。AGENTS.md / vitest config の修正は別途必要（後続作業）
- `npx vitest run <f1> <f2> ...`（複数ファイル指定）も workspace config では 0 件マッチで exit 0 になるため、検証は単独ファイル実行で実施した
- 置き換えは 4 並列 subagent で実施。各グループが文脈分類 → 技法選択 → Red/Green 検証（本番コード一時改変で回帰シグナル確認）→ repeats 実行を完了。production code は無変更

## 参考

- PBI 2026-09-26-05: 20ms 以上の sleep 40 件を処理済み
- `eslint/rules/no-test-sleep.mjs`: ルール実装ファイル
- dev-docs/TEST_RULE.md § 実時間待ちの禁止と代替手段
