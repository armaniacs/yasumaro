# PBI: ENCRYPTION_SECRETの「廃止予定」ラベルを実態に合わせて訂正する

**作成日**: 2026-07-26
**完了日**: 2026-07-26
**優先度**: Low
**見積もり**: 🟢低（1pt目安）
**副作用**: 🟢なし（コメント訂正のみ、ロジック変更なし）

## 実装メモ（2026-07-26）

`src/utils/storage/encryptionSession.ts:138-154` を確認した結果、`ENCRYPTION_SECRET` は
マスターパスワード未設定ユーザー（デフォルトの自動暗号化パス）で新規生成・書き込みが継続的に行われる
現役のキーであることを確認した（143-154行目で初回生成時に`chrome.storage.local.set`する処理が存在）。
「廃止予定」ラベルは完全に誤りだった。

`src/utils/storage/types.ts:76` のコメントを、実態と誤削除時のリスク（新鍵管理スキームへの
マイグレーションなしに削除すると既存の暗号化データが復号不能になる）を明記した表現に修正した。
コメント変更のみのため型チェックのみ実行し、回帰がないことを確認した。

---

## 背景

Checking Team レビュー（`plans/2026-07-23-1038-review-fix-0723.md`）の Legacy Bridge Architect からの指摘。`src/utils/storage/types.ts:76`（現状）に `ENCRYPTION_SECRET: 'encryption_secret', // 自動生成されたランダムシークレット（Base64）[廃止予定]` という「ゾンビ非推奨ラベル」が付いている。しかし実際には `src/utils/storage/encryptionSession.ts` 等で現役で読み書きされている。将来、このラベルを見た開発者が誤って削除すると、既存の暗号化APIキーが恒久的に復号不能になるリスクがある。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "ENCRYPTION_SECRET" src/utils/storage/types.ts src/utils/storage/encryptionSession.ts
```

`ENCRYPTION_SECRET` が実際にどの程度使われているか（読み取り専用の後方互換なのか、新規書き込みも行われているのか）を確認し、「本当に廃止予定（新規生成では使われない）」なのか「実質的に現役」なのかを判断する。

## 受け入れ基準（BDD）

```gherkin
Scenario: ラベルが実態を正確に反映する
  Given ENCRYPTION_SECRETが実際に現役で使われている（読み書きされている）
  When コメントラベルを確認する
  Then 「廃止予定」ではなく「Legacy encryption key」のような中立的な説明に変更されている

Scenario: 誤削除防止の注記が追加される
  Given ENCRYPTION_SECRETを誤って削除すると復号不能になるリスクがある
  When コメントを読む
  Then 「削除すると既存の暗号化データが復号不能になる」という警告が明記されている
```

## 受け入れ基準
- [ ] `ENCRYPTION_SECRET` の実際の使用状況（読み取りのみ/読み書き両方）を確認する
- [ ] コメントラベルを実態に即した表現（例: `// Legacy encryption key — still read/written, do not remove without migration`）に変更する
- [ ] 誤削除防止のため、削除する場合は新鍵管理スキームへのマイグレーションが必要である旨をコメントに明記する

## テスト戦略

コメント変更のみのため自動テスト対象外。既存の暗号化関連テストが変更されないことを確認する。

## 実装アプローチ

1. `ENCRYPTION_SECRET` の使用箇所を洗い出し、現役かどうかを判断する
2. コメントを実態に合わせて修正する

## 見積もり

1pt

## 技術的考慮事項
- 依存関係: なし
- 非機能要件: 保守性

## Definition of Done
- [ ] コメントラベルが実態を反映した表現に修正されている
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-23-1038-review-fix-0723.md`（Legacy Bridge Architect指摘）
- 対象コード: `src/utils/storage/types.ts:76`
