# PBI: setUrlFallbackTriggeredをOptimistic Lockとurl正規化に統一する

**作成日**: 2026-08-01
**優先度**: High
**見積もり**: 🟢低（1pt目安）
**副作用**: 🟡軽微（既存の`savedUrlsWithTimestamps`データ構造は変えない。関数内部の書き込み方式のみ変更）

---

## 背景

Checking Team レビュー（`plans/2026-08-01-1903-review-yasumaro.md`）の Data Integrity Expert からの High指摘。事実確認の結果、**指摘内容は完全に正確**と確認済み（誇張・誤りなし）。

`src/utils/urlMetadata.ts` 内で `savedUrlsWithTimestamps` を扱うsetterは29箇所すべて `withOptimisticLock('savedUrlsWithTimestamps', ...)` を使うが、`setUrlFallbackTriggered`（547-558行）だけが `chrome.storage.local.get` → 配列内エントリ変更 → `chrome.storage.local.set` という素のget-modify-setパターンになっている。

```ts
export async function setUrlFallbackTriggered(url: string, fallbackTriggered: boolean): Promise<void> {
    const validUrl = url.split('#')[0];
    const result = await chrome.storage.local.get('savedUrlsWithTimestamps');
    const entries = (result.savedUrlsWithTimestamps as SavedUrlEntry[]) || [];
    const entry = entries.find(e => e.url === validUrl);
    if (entry) {
        entry.fallbackTriggered = fallbackTriggered;
        await chrome.storage.local.set({ savedUrlsWithTimestamps: entries });
    }
}
```

問題は2つ複合している:
1. **Optimistic Lock未使用**: `get`から`set`の間に他の並行書き込み（別setterや別タブの記録処理）が割り込むと、その更新を握りつぶして上書きする lost update が発生する。
2. **URL正規化の不整合**: この関数だけが `url.split('#')[0]` でハッシュフラグメントを除去してから照合するが、他の28個のsetterは生の `url` をそのまま照合する（正規化なし）。呼び出し元 `saveMetadataStep.ts:182` は他のsetter呼び出しと同じ非正規化の `url` を渡すため、フラグメント付きURLで保存されたエントリに対してはこの関数だけが該当エントリを見つけられず、エラーも出さずサイレントにno-opする。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "withOptimisticLock('savedUrlsWithTimestamps'" src/utils/urlMetadata.ts | wc -l
grep -n "setUrlFallbackTriggered" src/utils/urlMetadata.ts src/background/pipeline/steps/saveMetadataStep.ts
```

`withOptimisticLock`の使用箇所数（29件のはず）と、`setUrlFallbackTriggered`が唯一の例外であることを再確認してから着手する。他のsetterのURL照合パターン（正規化の有無）も1つ確認しておくこと。

## 受け入れ基準（BDD）

```gherkin
Scenario: 並行書き込みが発生してもfallbackTriggeredの更新が失われない
  Given savedUrlsWithTimestampsに複数のURLエントリが保存されている
  When setUrlFallbackTriggered()と別のsetter（例: setUrlSummary()）がほぼ同時に異なるエントリを更新する
  Then 両方の更新が失われることなくストレージに反映される

Scenario: フラグメント付きURLでもエントリが正しく更新される
  Given "https://example.com/page#section1"というURLでエントリが保存されている
  When setUrlFallbackTriggered("https://example.com/page#section1", true)を呼ぶ
  Then 該当エントリのfallbackTriggeredがtrueに更新される（サイレントno-opしない）

Scenario: 既存のfallbackTriggered関連テストが回帰しない
  Given 変更後のsetUrlFallbackTriggered()
  When 既存のurlMetadata関連テストを実行する
  Then 全てパスする
```

## 受け入れ基準
- [ ] `setUrlFallbackTriggered()` を `withOptimisticLock('savedUrlsWithTimestamps', ...)` に統一する
- [ ] URL照合ロジックを他の28個のsetterと同じ方式（正規化なし、生のurlで照合）に揃える
- [ ] 上記変更により、フラグメント付きURLの扱いが他のsetterと矛盾しなくなることをテストで検証する
- [ ] 既存の `urlMetadata` 関連テストが全てパスする

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象外（内部ストレージロジックのため単体・統合テストで十分カバー可能）

### 統合テスト
- `setUrlFallbackTriggered` と他のsetter（例: `setUrlSummary`）を並行呼び出しし、両方の更新が反映されることを確認

### 単体テスト
- `withOptimisticLock` 経由で書き込まれることを確認（モックで検証）
- フラグメント付きURLで保存されたエントリが正しく見つかり更新されることを確認
- 存在しないURLを指定した場合に何も起きないこと（従来の安全な挙動）を確認

## 実装アプローチ
- **Outside-In**: 並行書き込みの統合テストから開始し失敗を確認 → 単体テストで `withOptimisticLock` 利用を確認 → 実装
- **Red-Green-Refactor**: 各テストレイヤーでTDDサイクルを適用

## 見積もり

1pt（既存の `withOptimisticLock` パターンへの置き換えのみ。新規ロジック追加なし）

## 技術的考慮事項
- 依存関係: `src/utils/urlMetadata.ts`, `src/background/pipeline/steps/saveMetadataStep.ts`（呼び出し元、変更不要）
- テスタビリティ: 既存の `withOptimisticLock` テストヘルパーがあれば流用可能
- 非機能要件: データ整合性（lost update防止）

## 落とし穴
- URL正規化を「除去」する方向で揃えるか、逆に他のsetter全てにフラグメント除去を追加するかは設計判断が必要。本PBIでは影響範囲最小化のため `setUrlFallbackTriggered` 側を他のsetterに合わせる（正規化を削除する）方針とする。将来的にフラグメント差異を無視したい場合は別PBIで全setter統一を検討する。

## Definition of Done
- [ ] `setUrlFallbackTriggered()` が `withOptimisticLock` を使用している
- [ ] URL照合ロジックが他のsetterと一致している
- [ ] 並行書き込みテストがパスする
- [ ] 全テストがパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-08-01-1903-review-yasumaro.md`（Data Integrity Expert指摘、High #5）
- 対象コード: `src/utils/urlMetadata.ts:547-558`、呼び出し元 `src/background/pipeline/steps/saveMetadataStep.ts:182`
- 事実確認: 指摘内容は完全に正確（誇張・誤りなし）と確認済み
