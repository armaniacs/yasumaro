# PBI: errorMessage() の扱い（削除テストによる現状維持の確定）

**作成日**: 2026-08-12
**調査日**: 2026-08-12
**優先度**: 🟢低
**見積もり**: 🟢低（1pt目安・ドキュメント化のみ）
**副作用**: 🟢なし
**種別**: 🔧非機能追加（refactor / 確認）

---

## 背景

graphify 知識グラフの god node 分析で `errorMessage()` が 243 edges で最高スコアと
なった。実体は `src/utils/errorUtils.ts` の 1 行純粋関数:

```ts
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
```

58 箇所の呼び出し側で `error instanceof Error ? e.message : String(e)` パターンを
集約している。本 PBI は「変更」ではなく、削除テストにより「薄いが保持すべき」と
判断し、その根拠をドキュメント化して将来の再提案を防ぐ。

## 調査結果：なぜなぜ分析（5回）

1. **Why 1**: なぜ errorMessage を検討対象にしたのか → god node（243 edges）だが実体は 1 行純粋関数。`e instanceof Error ? e.message : String(e)` を集約するだけ。
2. **Why 2**: 削除テストに通るか → 消すと 58 箇所に `e instanceof Error ? e.message : String(e)` が再出現（複雑さは集中して再出現）→ 「価値がある（保持すべき）」。
3. **Why 3**: 深掘り（interface 拡張）の余地はあるか → ない。純粋関数であり差し替え需要もなければ内部状態もない。深くする余地はない。
4. **Why 4**: 統合案（logger の LogEntry 構築時に統合）はどうか → logger 内部で errorMessage を使っている箇所は既に import 済み。外部 interface は維持。無理に統合する意味はない。
5. **Why 5**: 結論 → 現状維持。ただし「薄いが保持すべき」を ADR 的には残さず、本 PBI として「削除テストで価値確認済み、現状維持」をドキュメント化。将来「errorMessage はいらないのでは」と再提案されてもこの PBI が保持根拠を残す。

## 実装内容

コード変更は行わない。以下のドキュメント化のみ:

1. `src/utils/errorUtils.ts` の `errorMessage` に、削除テストの根拠をコメントで補強
   （「58箇所で再利用されるため削除しない。集約価値あり」）
2. 本 PBI ファイルにより「現状維持の判断」を記録

## 受け入れ基準

- [ ] `errorMessage` の削除テスト根拠がコメントで記録されている
- [ ] 本 PBI により「現状維持」の判断が pbi/ にドキュメント化されている
- [ ] コードの動作・interface に変更がない

## テスト戦略

- 新規テストは不要。既存の errorUtils 利用側テストが通ることを確認。

## 非スコープ

- errorMessage の signature 変更
- logger への統合
- 呼び出し側 58 箇所の変更
- PBI-1/2/3 が扱う他のロギング層改善
