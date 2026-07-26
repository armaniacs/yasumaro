# PBI: インラインイベントハンドラー指摘の現状確認とレビュープロセスへのフィードバック

**作成日**: 2026-07-25
**優先度**: Low（調査タスク）
**見積もり**: 🟢低（1pt目安）
**副作用**: 🟢なし（コード変更が不要な可能性が高い）

---

## 背景

Checking Team レビュー（2026-07-25）の UI Expert からの指摘。`src/popup/main.ts:18` で `recordBtn.onclick = () => handleRecordNowClick(false);` がインラインで割り当てられており、`addEventListener` を使うべきとされた。

**フェーズ0の事前調査により、この指摘は現状のコードと一致しないことが判明している。** `src/popup/main.ts:16-19`（2026-07-25時点）は以下の通りで、既に `addEventListener` を使用している:

```typescript
document.addEventListener('DOMContentLoaded', () => {
  const recordBtn = document.getElementById('recordBtn') as HTMLButtonElement | null;
  if (recordBtn) {
    recordBtn.addEventListener('click', () => handleRecordNowClick(false));
  }
```

このPBIは「実装」ではなく、指摘が既に解消されていることを確認し、レビュー結果と実コードの乖離を記録する調査タスクとして扱う。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "onclick\|addEventListener" src/popup/main.ts
grep -rn "\.onclick\s*=" src/popup/ src/dashboard/
```

`main.ts` 以外に popup/dashboard 配下で同様の `.onclick =` パターンが残っていないか、念のため全体を確認する。

## 受け入れ基準（BDD）

```gherkin
Scenario: popup/dashboard全体でインラインハンドラーが使われていないことを確認する
  Given src/popup/ と src/dashboard/ の全TypeScriptファイル
  When ".onclick =" のようなインライン代入パターンを検索する
  Then 該当箇所が見つからない、または見つかった場合はaddEventListenerに置き換える

Scenario: 誤検出をレビュープロセスにフィードバックする
  Given 指摘箇所が既に修正済みであることが確認できた
  When 調査結果をまとめる
  Then 次回以降のCheckingTeamレビューで参照できるよう記録を残す
```

## 受け入れ基準
- [ ] `src/popup/`, `src/dashboard/` 全体で `.onclick =` パターンをgrepし、残存箇所がないか確認する
- [ ] 残存箇所が見つかった場合は `addEventListener` に置き換える
- [ ] 見つからなかった場合は、本PBIをクローズし `plans/2026-07-25-2019-review-main.md` に対する誤検出注記を残す

## テスト戦略

### 単体テスト
- 既存の popup/dashboard テストが変更後も全てパスすることを確認（変更が発生した場合のみ）

## 実装アプローチ

1. `grep -rn "\.onclick\s*=" src/` で全体を走査
2. 該当箇所があれば `addEventListener('click', ...)` に置き換え、既存の登録があれば重複登録を避ける
3. 該当箇所がなければ調査結果のみ記録してクローズ

## 見積もり

1pt（grep調査 + 必要なら1-2箇所の置き換え）

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: 既存テストで担保

## Definition of Done
- [ ] popup/dashboard全体でインラインハンドラーの残存有無が確認されている
- [ ] 残存箇所があれば修正済み
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-25-2019-review-main.md`（UI Expert指摘、現状コードと不一致の可能性あり）
- 対象コード: `src/popup/main.ts:16-19`
