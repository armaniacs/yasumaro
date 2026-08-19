# PBI: ビジットレートリミッタのTTLエビクション毎回スイープ化

## ユーザーストーリー
拡張機能の開発者・保守担当者として、`visitRateLimiter` の期限切れエントリが Map サイズに関係なく確実にクリアされてほしい、なぜなら Service Worker が長時間稼働し続けるケースでメモリ内に古いエントリが無期限に残留するのを防ぎたいから

## ビジネス価値
- 長時間稼働する Service Worker でのメモリ使用量を確実に低く抑える
- コードコメント（「TTLで確実にクリアされる」）と実装の乖離を解消し、将来の誤解・再発防止

## 背景（既実装確認）

`src/background/handlers/recordingHandlers.ts` の `isRateLimitedVisit()` には既に TTL エビクションのコードが存在する（PBI `2026-08-19-05-fix-visit-rate-limiter.md` で実装済み）。しかし現在の実装は以下の条件のときのみエビクションが走る：

```ts
if (visitRateLimiter.size > VISIT_RATE_LIMIT_MAX_ENTRIES) {
    for (const [k, ts] of visitRateLimiter) {
        if (now - ts > VISIT_RATE_LIMIT_TTL_MS) visitRateLimiter.delete(k);
    }
}
```

`visitRateLimiter.size` が `VISIT_RATE_LIMIT_MAX_ENTRIES`（1000）を超えない限りスイープが一切発火せず、期限切れエントリが Map サイズ超過まで永続的に残り続ける。これは新規実装ではなく、既存実装のバグ修正である。

## BDD受け入れシナリオ

```gherkin
Scenario: サイズ上限未満でも期限切れエントリがクリアされる
  Given visitRateLimiter に998件のユニークオリジンのエントリが事前登録されている（呼び出し前 size = 998 < MAX_ENTRIES）
  And そのうち1件が VISIT_RATE_LIMIT_TTL_MS（30秒）より前に登録された
  When isRateLimitedVisit() が新規オリジンのURLに対して呼び出される（この呼び出し自体が1件setするため呼び出し後 size は最大999 < MAX_ENTRIES のまま）
  Then 期限切れの1件が visitRateLimiter から削除される
  And 呼び出し後の size が MAX_ENTRIES を超えていない（セーフガードとは無関係にTTLのみで削除されたことの確認）

Scenario: 通常のレートリミット動作が維持される
  Given 同じオリジンからの複数のビジットが発生する
  When 5秒以内に2回目のビジットが発生する
  Then 2回目のビジットがレートリミットされる
```

> **注記（なぜなぜ分析で判明した記述上の落とし穴）**: `isRateLimitedVisit()` は判定と同時に `visitRateLimiter.set()` を行う副作用を持つ（クエリとコマンドを兼ねる設計）。BDDシナリオを書く際は「呼び出し前の状態」と「呼び出しそのものが増やす1件」を区別しないと、意図せず `size > MAX_ENTRIES` のセーフガード分岐と混線し、TTL単体の効果を検証できなくなる。テスト実装時は事前登録数を明示的に `MAX_ENTRIES - 2` 以下にとどめること。

> **注記（敵対的レビューで判明した追加の考慮点、および訂正）**: 当初「TTLスイープとMAX_ENTRIESセーフガードが競合してエントリが二重に消費される」懸念を挙げていたが、実装コード（91-112行目）を精査すると「スイープ→get→set→size超過チェック」は完全な直列処理であり、両者が同時に読み書きを行う余地はない（JavaScriptはシングルスレッドであり、この関数呼び出し内に非同期の中断点も存在しない）。**「二重消費」というシナリオは構造的に発生し得ないため撤回する。** 代わりに検証すべきは、スイープでMapサイズが大きく減った直後にセーフガード分岐（`size > MAX_ENTRIES`）へ正しく入らない（誤って発火しない）ことの確認である。具体的な数値条件は下記テスト戦略に記載する。

## 受け入れ基準
- [ ] `isRateLimitedVisit()` が呼び出されるたびに、Map サイズに関係なく期限切れ（TTL超過）エントリをスイープする
- [ ] `VISIT_RATE_LIMIT_MAX_ENTRIES` によるセーフガード（想定外の急増に対する頭打ち）は維持する
- [ ] 通常のレートリミット動作（5秒以内の同一オリジン再訪問をブロック）が損なわれない
- [ ] 既存の単体テストがパスする
- [ ] 毎回全件走査によるオーバーヘッドが、想定最大サイズ（1000エントリ）で簡易ベンチマーク上、無視できる水準であることを計測で確認する（CI共有ランナーでのCPU変動・JITウォームアップによるフレーキー化を避けるため、閾値は厳しい絶対値ではなく十分に緩い絶対値（確定値: 50ms。CIの共有ランナーでの実測結果が50msを超えるようなら、閾値ではなく実装のO(n)走査自体を見直す）とする。敵対的レビューで「1ms未満は共有ランナーでフレーキー化しうる」「『例:』という表現だと実装者ごとに解釈が割れる」と指摘されたため、50msを確定値として明記する。測定条件: `performance.now()` で3回計測しその中央値を用いる（1回のみの計測による偶発的な速い/遅いサンプルを避ける））

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし（Service Worker 内部状態のため対象外）

### 統合テスト
- Service Worker ライフサイクルシミュレーションでの長時間稼働テスト（既存があれば拡張）

### 単体テスト
- `isRateLimitedVisit()` を size < MAX_ENTRIES の状態（事前登録は `MAX_ENTRIES - 2` 件以下）で呼び出し、TTL超過エントリが削除されることを検証
- size > MAX_ENTRIES のセーフガードが引き続き機能することを検証
- 通常のレートリミット判定（5秒以内ブロック）が回帰しないことを検証
- 簡易ベンチマーク: 1000件のエントリを持つ Map に対して `isRateLimitedVisit()` を3回連続呼び出し、各回の所要時間の中央値が50ms未満であることをアサートするテスト（`performance.now()` で計測）。フレーキー化を避けるため、閾値は「明らかな性能劣化（O(n)化の見落とし等）だけを検知できればよい」という粒度に留める（50msは確定値。「例」ではない）
- TTLスイープ後のセーフガード誤発火防止: `MAX_ENTRIES + 100` 件のエントリを事前登録し、そのうち `MAX_ENTRIES - 50` 件をTTL超過状態にした上で `isRateLimitedVisit()` を1回呼び出す。呼び出し後、スイープにより size が `MAX_ENTRIES` 未満まで縮小していれば、セーフガード分岐（oldestKey削除）が実行されないこと（削除されるのはTTLスイープ分のみで、セーフガードによる追加削除が発生しないこと）を、呼び出し前後のエントリ数を厳密に数えてアサートする

## 実装アプローチ
- **Outside-In**: 単体テストを先に書き、現状の実装で失敗することを確認してから修正
- **Red-Green-Refactor**: TDDサイクルを適用

## 見積もり
0.25ストーリーポイント

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: `Date.now()` のモックが必要（既存テストのパターンに準拠）
- 非機能要件: 毎回全件走査になる。1000エントリ程度なら一般的には無視できるコストだが、この関数は「ページ訪問のたびに毎回」呼ばれる高頻度パスであるため、定性的な推測だけでなく簡易ベンチマークで実測し、DoDに含める（なぜなぜ分析の結論: 性能影響を定性評価のみで済ませず検証手段を用意する）
- 参考（3周目の敵対的レビューで指摘・記録のみ）: `getRateLimitKey` はURLのオリジン単位でキーを生成するため、悪意あるページが人為的に大量のユニークオリジンを生成し高頻度アクセスさせ続けるとMapが1000件上限に張り付き、毎回のO(n)走査コストが積み重なる可能性が理論上ある。ただし `VALID_VISIT` メッセージはコンテンツスクリプト経由でのみ送信され、Webページから任意のタイミングで直接叩ける経路ではないため、実際の脅威度は低いと判断し本PBIのスコープには含めない（将来メッセージ送信頻度自体に制限がないことが問題になった場合は別PBIで扱う）
- **ロールバック手段が未定義（3周目の敵対的レビューで指摘）**: 本番投入後に体感遅延等の問題が発覚した場合の切り戻し手段（feature flag、`chrome.storage.local`経由の無効化スイッチ等）がない。Chrome Web Store配布はロールバックに審査待ち・ユーザー手動更新のタイムラグが生じるため、影響が軽微と判断される本PBIでは追加のロールバック機構は設けないが、この判断自体をここに明記しておく（将来同種の指摘が来た場合の参照用）

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
grep -n "visitRateLimiter\|VISIT_RATE_LIMIT" src/background/handlers/recordingHandlers.ts
```

### 実装手順
1. `isRateLimitedVisit()` 内で、size チェックの条件分岐を外し、関数呼び出しのたびに無条件でTTL超過エントリをスイープするようにする
2. スイープ処理の後段に、`VISIT_RATE_LIMIT_MAX_ENTRIES` によるセーフガード（旧来の "oldest entry eviction" ロジック）を残す
3. 単体テストで、size が上限未満の状態でも TTL 超過エントリが消えることを確認する

```ts
function isRateLimitedVisit(url: string): boolean {
    const now = Date.now();
    const key = getRateLimitKey(url);

    // Sweep expired entries on every check so stale entries never persist
    // past TTL, regardless of Map size.
    for (const [k, ts] of visitRateLimiter) {
        if (now - ts > VISIT_RATE_LIMIT_TTL_MS) visitRateLimiter.delete(k);
    }

    const last = visitRateLimiter.get(key);
    if (last !== undefined && now - last < VISIT_RATE_LIMIT_MS) return true;
    visitRateLimiter.set(key, now);

    // Safety net: even if TTL sweep somehow falls behind, cap growth.
    if (visitRateLimiter.size > VISIT_RATE_LIMIT_MAX_ENTRIES) {
        const oldestKey = visitRateLimiter.keys().next().value as string | undefined;
        if (oldestKey !== undefined) visitRateLimiter.delete(oldestKey);
    }
    return false;
}
```

### 落とし穴
- 毎回全件走査に変えるため、テストで巨大な Map を作って性能劣化を懸念する必要はないが、`VISIT_RATE_LIMIT_MAX_ENTRIES` を極端に大きくする変更は避ける
- `Date.now()` を使ったテストでは `vi.useFakeTimers()` 等で時間を制御し、TTL境界値（29999ms/30001ms）をテストすること

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（該当箇所のコメントが実装と一致していることを確認）
