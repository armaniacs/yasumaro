# PBI: renderMigrationSectionの表示優先順位ロジックをderiveMigrationStatus側に統合

## ユーザーストーリー
拡張機能の開発者として、`renderMigrationSection`に残っている状態→ラベルの優先順位判定ロジック（`opfs.done ? doneSuffix : (opfs.notApplicable ? ... : ...)`）を`deriveMigrationStatus`側の単一の判別可能ユニオン型（`displayState`）に統合したい、なぜなら現在この優先順位ロジックはレンダー関数側に残っており「DOM組み立てのみの薄い関数」という設計意図が未達成であり、将来この優先順位を変更する際にjsdom前提のテストを書かない限り壊れても気づけないため。

## 優先度
- 順位: 04 / 4（最後に着手）
- RICEスコア: 1.6（Reach=開発者(月数回の変更頻度) × Impact=1 × Confidence=80% / Effort=1人日）
- 根拠: adversarial-code-reviewで裏取り済み（diagnosticsPanel.ts:367-368で優先順位ロジックの残留を確認）。視覚的差分ゼロを保ちながらのリファクタで他候補より実装コストが高い。依存関係なし。

## 制約
- 表示内容・DOM構造は変更しない（リファクタのみ、視覚的な差分ゼロ）
- `MigrationOpfsStatus`/`MigrationIdbStatus`型の既存フィールド（`done`/`notApplicable`/`checking`/`warn`）は後方互換のため残すか、置き換える場合は呼び出し元（テスト含む）を全て更新する

## BDD受け入れシナリオ

```gherkin
Scenario: OPFS移行状態の表示ラベルがderiveMigrationStatus側で一意に決定される
  Given DiagnosticsSnapshot.sqlite が特定の移行状態を示す値を持つ
  When deriveMigrationStatus(snapshot.sqlite) を呼び出す
  Then opfs.displayState が 'done' | 'notApplicable' | 'checking' | 'pending' のいずれか一意の値として返される

Scenario: renderMigrationSectionがdisplayStateをそのままラベルにマッピングするだけになる
  Given deriveMigrationStatus の戻り値に opfs.displayState が含まれている
  When renderMigrationSection(el, snap) を呼び出す
  Then 優先順位の条件分岐なしに displayState から対応するラベル文字列を引くだけになる

Scenario: 既存の診断パネル表示が変更前と完全に同じ結果になる
  Given 任意の DiagnosticsSnapshot.sqlite の組み合わせ
  When 変更前後それぞれで renderMigrationSection を実行する
  Then 生成されるDOM上の表示テキストが完全に一致する
```

## 受け入れ基準
- [ ] `MigrationOpfsStatus`/`MigrationIdbStatus`に`displayState: 'done' | 'notApplicable' | 'checking' | 'pending'`（IDB側は`checking`なしの3値）を追加し、優先順位ロジックを`deriveMigrationStatus`内に移す
- [ ] `renderMigrationSection`の`opfsValue`/`idbValue`算出が、`displayState`から対応するラベル文字列を引くだけの単純なマッピングになる
- [ ] IDB側に`checking`状態が存在しない非対称設計であることをコードコメントで明示する
- [ ] 既存の診断パネルE2Eテスト（見た目・表示内容）が変更なくパスする
- [ ] `deriveMigrationStatus.test.ts`に`displayState`の全パターン（done/notApplicable/checking/pending）の単体テストを追加する

## テスト戦略
- E2E: 既存の診断パネル表示確認フローをそのまま再実行し回帰がないことを確認
- 統合: なし
- 単体: `displayState`の全パターン網羅、OPFS/IDBそれぞれの非対称性（IDB側にcheckingがないこと）を明示的にテストする

## 見積もり
2ポイント（要チームでの見積もり）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
