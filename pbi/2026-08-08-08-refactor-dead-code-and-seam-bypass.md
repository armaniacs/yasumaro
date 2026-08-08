# PBI: 死蔵コードと seam 迂回を整理する

**作成日**: 2026-08-08
**優先度**: 中
**見積もり**: 🟢低（1pt目安）
**副作用**: 🟢なし（未使用コードの削除と既存 seam への寄せ）
**種別**: 🔧非機能追加（refactor）

---

## 背景

アーキテクチャレビュー（2026-08-08）で、小粒だが確実な3点が見つかった。

### 1. `createBackgroundServices.ts` はテストのためだけに存在する

```bash
grep -rn "createBackgroundServices" src/ entrypoints/ --include="*.ts" | grep -v "createBackgroundServices.ts"
# → src/background/__tests__/createBackgroundServices.test.ts のみ（99行）
```

45行のモジュールに対し99行のテストがあるが、**本番コードは1箇所も呼んでいない**。`service-worker.ts` は181-213行で自前に11個の singleton を `new` している。

さらに設計上の欠陥がある：`BackgroundServices`（18行）は `aiClient: AIClient` を返すが `aiService` を返さない（31行でローカルに作って捨てている）。**利用者は `AIService` を取り出せない**ため、ADR 2026-07-27 の方針（`AIService` に統一）と整合しない。

これは PBI `2026-08-07-13`（サービス配線統合）で作られたが本番配線には至らなかったもの。同PBIは「🔶部分実装」として残っている。

**判断**: 削除か本番採用かを決める。本PBIでは**削除を提案**する。理由：
- 現状 `service-worker.ts` の配線は動作しており、置き換えは候補1（dashboard 整理）より優先度が低い
- `aiService` を返さない設計のままでは採用しても ADR と不整合
- テストのためだけのコードは deletion test で「純減」

ただし PBI `2026-08-07-13` の意図（配線の一元化）は正しいため、**削除する場合はその旨を PBI 側に記録**し、将来やり直せるようにする。

### 2. `src/popup/__tests__/` に移動元の残骸テストがある

commit `317716c` で `src/popup/ublockImport/` → `src/dashboard/settings/ublockImport/` へ移動したが、`src/popup/__tests__/` に `ublockImport-*.test.ts` が7件残っている。移動先にも2件ある。

**要確認**: 残骸なのか、移動先とは別の対象をテストしているのか。両方が同じ実装をテストしているなら重複。

### 3. `chrome.i18n.getMessage` の直接呼び出しが seam を迂回している

共有 seam `src/utils/i18n.ts::getMessage` が存在し3ファイルが使用しているが、**8ファイルが `chrome.i18n.getMessage` を直接呼んでいる**。

とくに `sqliteHistoryPanel.ts:33-35` は独自の `t()` ラッパーを定義している：

```typescript
// 共有 seam を import せず、独自ラッパーを定義
```

### 削除テスト

| 対象 | deletion test |
|---|---|
| `createBackgroundServices.ts` | 削除 → 複雑度は**純減**（本番が使っていない） |
| 残骸テスト | 削除 → 純減（重複の場合） |
| 独自 `t()` ラッパー | 削除して共有 seam へ → **複雑度が集中する** |

---

## 実装者向け注記: 現状の確認

```bash
# createBackgroundServices の利用状況
grep -rn "createBackgroundServices\|BackgroundServices" src/ --include="*.ts"

# popup 側の残骸テストと移動先テストの比較
ls src/popup/__tests__/ | grep ublock
ls src/dashboard/settings/ublockImport/__tests__/
# 両者が何を import しているか確認（同じ実装なら重複）
grep -n "^import" src/popup/__tests__/ublockImport-*.test.ts | grep "from"

# chrome.i18n 直接呼び出し（dashboard 配下）
grep -rn "chrome.i18n.getMessage" src/dashboard/ | grep -v __tests__
```

**重要**: 残骸テストは**削除前に import 先を必ず確認**する。移動元の実装がまだ存在する場合、テストは残骸ではなく現役である。

---

## 設計

### 対応方針

| # | 対象 | 方針 |
|---|---|---|
| 1 | `createBackgroundServices.ts` + テスト | 削除。PBI `2026-08-07-13` に「配線一元化は未達／再挑戦時は `aiService` も返す設計にすること」を記録 |
| 2 | `src/popup/__tests__/ublockImport-*.test.ts` | import 先を確認し、移動先と重複していれば削除 |
| 3 | `chrome.i18n.getMessage` 直接呼び出し | `src/utils/i18n.ts::getMessage` へ寄せる。`sqliteHistoryPanel.ts` の独自 `t()` も置換 |

### #3 の注意

`src/utils/i18n.ts::getMessage` が `chrome.i18n.getMessage` と**完全に同じシグネチャ・挙動か**を確認する。フォールバック処理や引数の扱いが異なる場合、置換で挙動が変わる。異なる場合は置換範囲を限定する。

---

## 受け入れ基準（BDD）

```gherkin
Scenario: テストのためだけのモジュールが無くなる
  Given createBackgroundServices は本番コードから呼ばれていない
  When 削除する
  Then 本番の振る舞いが変わらず、テスト数が減る

Scenario: i18n が単一の seam を通る
  Given src/utils/i18n.ts に共有 getMessage が存在する
  When dashboard 配下のファイルが翻訳を取得する
  Then chrome.i18n.getMessage を直接呼ばない

Scenario: 既存テストが全てパスする
  When 変更を完了する
  Then npm run validate が成功する
```

## 受け入れ基準

- [ ] `createBackgroundServices.ts` と `__tests__/createBackgroundServices.test.ts` を削除
- [ ] PBI `2026-08-07-13` に削除の経緯と再挑戦時の設計注意を追記
- [ ] `src/popup/__tests__/ublockImport-*.test.ts` の import 先を確認し、重複なら削除（現役なら残す判断を記録）
- [ ] `src/utils/i18n.ts::getMessage` と `chrome.i18n.getMessage` の挙動差を確認
- [ ] dashboard 配下の `chrome.i18n.getMessage` 直接呼び出しを共有 seam へ置換
- [ ] `sqliteHistoryPanel.ts` の独自 `t()` ラッパーを共有 seam へ置換
- [ ] `npm run validate` が成功する

## テスト戦略

### 回帰テスト
- 全既存テスト（削除により件数が減ることを確認）
- i18n の置換後、翻訳が引けていることを既存の i18n テストで確認

### 新規テストは作らない
本PBIは削除と既存 seam への寄せのみ。新規の振る舞いは追加しない。

## 実装アプローチ

1. 残骸テストの import 先を確認（削除可否の判断）
2. `createBackgroundServices` を削除
3. `i18n.ts::getMessage` の挙動を確認
4. dashboard 配下の直接呼び出しを置換
5. `npm run validate`

## 見積もり
1pt（削除2件 + 機械的な置換）

## 技術的考慮事項

- `createBackgroundServices` の削除は PBI `2026-08-07-13` の成果物を消すことになる。**同PBIに理由を残す**ことで、次に配線一元化をやる人が同じ設計ミス（`aiService` を返さない）を繰り返さないようにする
- 残骸テストの判断を誤ると現役テストを消してしまう。`git log --follow` で移動履歴を確認するのも有効
- i18n の置換は機械的だが、`utils/i18n.ts` がフォールバック（キー未定義時の挙動）を持つ場合は挙動が変わる可能性がある

## 関連

- アーキテクチャレビュー（2026-08-08）小粒指摘
- 関連PBI: `2026-08-07-13-refactor-service-wiring-backend-consolidation.md`（🔶部分実装。`createBackgroundServices` の出自）
- 先行作業: commit `317716c`（ublockImport の移動）
- 対象: `src/background/createBackgroundServices.ts`, `src/popup/__tests__/ublockImport-*.test.ts`, `src/dashboard/**`
