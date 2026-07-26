# PBI: recordBtnの動的ハンドラー切り替え箇所の.onclick=パターンを整理する

**作成日**: 2026-07-25
**更新日**: 2026-07-26（フェーズ0再調査により対象範囲を拡大）
**優先度**: Low
**見積もり**: 🟡中（2pt目安、当初の🟢低から引き上げ）
**副作用**: 🟡軽微（同一ボタンへの複数ハンドラー登録を避ける設計の可能性があり、置き換え方法の検討が必要）

---

## 背景

Checking Team レビュー（2026-07-25）の UI Expert からの指摘。`src/popup/main.ts:18` で `recordBtn.onclick = () => handleRecordNowClick(false);` がインラインで割り当てられており、`addEventListener` を使うべきとされた。

**フェーズ0の事前調査（2026-07-25時点）** では `main.ts:16-19` は既に `addEventListener` 化されていることを確認した。ただし2026-07-26の再調査で、**同一パターンが以下6箇所に残存**していることが判明した:

- `src/popup/recordCurrentPage.ts:73, 76`（`resetRecordButton`内、ドメインフィルタ状態に応じてボタンのテキスト・ハンドラーを切り替え）
- `src/popup/recordCurrentPage.ts:88`（`setRecordAnywayButton`内）
- `src/popup/statusPanel.ts:347, 350`（同様にrecordBtnのテキスト・ハンドラー切り替え）
- `src/popup/errorUtils.ts:348`（`forceBtn.onclick`）

**注記**: これらは全て同一ボタン要素（`recordBtn`/`forceBtn`）に対して、状態に応じてテキストとクリックハンドラーを繰り返し再設定する箇所であり、`.onclick =`（プロパティ代入）を使うことで「常に1つのハンドラーのみ」を保証している可能性がある。`addEventListener` に単純に置き換えると、呼び出しのたびにリスナーが積み重なり、クリック時に複数回ハンドラーが実行される回帰を生むリスクがある。置き換える場合は `removeEventListener` で前回登録分を明示的に除去するか、専用のヘルパー関数（`setSingleClickHandler(btn, handler)`）を導入する必要がある。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -rn "\.onclick\s*=" src/popup/ src/dashboard/
```

各箇所が「複数回呼ばれても問題ない一度きりの初期化」なのか、「状態遷移のたびに繰り返し呼ばれ、ハンドラーを都度差し替える」ものなのかを個別に確認する。後者（`recordCurrentPage.ts`, `statusPanel.ts`）は安易な `addEventListener` 置き換えがリスナー蓄積バグを生むため特に注意する。

## 受け入れ基準（BDD）

```gherkin
Scenario: 状態遷移のたびにハンドラーが差し替わっても重複登録されない
  Given recordBtn がドメインフィルタ許可/拒否の状態を繰り返し切り替える
  When resetRecordButton() が複数回呼ばれる
  Then クリック時に実行されるハンドラーは常に最新の1つのみである（前回のリスナーが蓄積しない）

Scenario: 既存のクリック動作が回帰しない
  Given リファクタリング後の recordCurrentPage.ts / statusPanel.ts / errorUtils.ts
  When ボタンをクリックする
  Then 既存と同じ挙動（force記録 or 通常記録）が実行される

Scenario: 単純な初期化のみの箇所（main.ts）は現状維持される
  Given main.ts の addEventListener 化は既に完了している
  When 本PBIの変更を適用する
  Then main.ts には変更を加えない
```

## 受け入れ基準
- [ ] `recordCurrentPage.ts:73, 76, 88`, `statusPanel.ts:347, 350`, `errorUtils.ts:348` の `.onclick =` 箇所について、繰り返し呼ばれる際にリスナーが蓄積しないことを保証する形に統一する
- [ ] 統一方法は「`.onclick =` のまま維持する（現状も安全なため変更不要と判断する）」または「`removeEventListener` 併用のヘルパー関数に置き換える」のいずれかを採用し、判断根拠をコメントに残す
- [ ] 既存の `popup` 関連テスト（`__tests__/main.test.ts` 含む）が全てパスする
- [ ] 実際にボタンクリックの挙動が変わらないことを手動確認する

## テスト戦略

### 単体テスト
- 複数回の状態遷移（許可→拒否→許可）をシミュレートし、最終的に1回のクリックで1回だけハンドラーが実行されることを確認するテストを追加
- 既存の popup 関連テストが変更後も全てパスすることを確認

## 実装アプローチ

1. 6箇所それぞれについて「繰り返し呼ばれるか」「複数リスナー蓄積のリスクがあるか」を判定する
2. `.onclick =` のままで安全（プロパティ代入は本質的に単一ハンドラーを保証する）と判断されれば、コメントでその設計意図を明記して変更を見送る
3. 万一 `addEventListener` 化する必要がある箇所があれば、`removeEventListener` で前回ハンドラーを除去してから登録するヘルパーを導入する

## 見積もり

2pt（6箇所の挙動確認 + 必要な箇所のみ改修 + リスナー蓄積の回帰テスト追加）

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: 既存テストで担保、状態遷移の繰り返しテストを追加

## Definition of Done
- [ ] 6箇所全てについて設計意図（`.onclick=`維持 or ヘルパー導入）が確認・記録されている
- [ ] 既存テストが全てパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-25-2019-review-main.md`（UI Expert指摘。当初 `main.ts` の1箇所として指摘されたが、同種パターンが他5箇所に存在することが2026-07-26の再調査で判明）
- 対象コード: `src/popup/recordCurrentPage.ts:73,76,88`, `src/popup/statusPanel.ts:347,350`, `src/popup/errorUtils.ts:348`
