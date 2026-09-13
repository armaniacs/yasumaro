# PBI: attachTriggerに多重登録防止ガードを追加

## ユーザーストーリー
拡張機能の開発者として、`createIssueReportModalController`の`attachTrigger`メソッド自身に同一ボタンへの多重登録防止ガードを持たせたい、なぜなら現在は`NavigationRegistry`の`mountedPanels`によるmount-once保証に安全性を委ねる暗黙の依存があり、そちらの実装が変わればクリック1回で`chrome.tabs.create`が複数回呼ばれ複数タブが開く事故に直結するため。

## 優先度
- 順位: 01 / 4
- RICEスコア: 16.0（Reach=開発者(月数回の変更頻度) × Impact=2 × Confidence=100% / Effort=0.5人日）
- 根拠: adversarial-code-reviewで裏取り済み。実装コストが最小で恒久的にリスクを解消できる。依存関係なし。

## 制約
- `diagnosticsPanel.ts`・`dashboard.ts`からの既存呼び出しAPI（`attachTrigger(btn)`のシグネチャ）は変更しない
- 共有モーダルのCancel/Close/Openの既存動作は変えない
- 「異なるボタンを渡すケース」（診断パネル・サイドバー双方への配線）は引き続き正しく動作させる

---

## 実装ガイド（調査済み・そのまま着手可）

### 現状のコード（`src/dashboard/panels/diagnostic/issueReportLink.ts:130-142`）

```typescript
  return {
    attachTrigger(reportBtn: HTMLButtonElement | null): void {
      if (!reportBtn || !previewModal || !previewContent || !openBtn) return;

      reportBtn.addEventListener('click', async () => {
        const snapshot = await collectSnapshot();
        const recentLogs = await getLogs();
        previewContent.value = buildIssueReportBody(snapshot, recentLogs);
        pendingUrl = buildIssueReportUrl(snapshot, recentLogs);
        previewModal.showModal();
      });
    },
  };
```

`reportBtn`に対して無条件で`addEventListener`しており、同一要素が2回渡されるとリスナーが2つ付く。

### 変更方針

`createIssueReportModalController`の関数スコープ（`let pendingUrl` と同じ階層、`issueReportLink.ts:111`付近）に`WeakSet`を1つ置き、`attachTrigger`の冒頭で判定する。`WeakSet`を使う理由は、DOM要素が差し替えられた場合にエントリがGCされ、古い要素への参照が残らないため。

```typescript
  let pendingUrl: string | null = null;
  // 既に配線済みのボタンを記録し、同一要素への二重 addEventListener を防ぐ。
  // WeakSet なのでボタンが DOM から外れれば自動的にエントリも消える。
  const wiredTriggers = new WeakSet<HTMLButtonElement>();
```

`attachTrigger`の早期returnの直後に追加:

```typescript
      if (!reportBtn || !previewModal || !previewContent || !openBtn) return;
      if (wiredTriggers.has(reportBtn)) return;
      wiredTriggers.add(reportBtn);
```

### 既存テストの問題（要修正）

`src/dashboard/panels/diagnostic/__tests__/issueReportLink.wire.test.ts:145-167` の
`'reentrancy guard: two controllers over the same modal do not double-fire open/cancel listeners'`
は**名前と実装が一致していない**。コメント（149-153行目）は「controllerを2回作った場合」を説明しているが、実際に生成しているのは`controllerA`のみで、`controllerB`は存在せず、同一ボタンへの再`attachTrigger`もしていない。実質的に他のテストと同じことを検証している。

このテストは以下のいずれかにすること:
- 本来意図していた「同一モーダルに対して controller を2つ作る」シナリオを実装する、または
- 削除して、下記の新規テスト2件に置き換える

### 追加すべきテスト

`issueReportLink.wire.test.ts`に追加（既存の`buildDom()`/`makeSnapshot()`ヘルパーがそのまま使える）:

```typescript
  it('attaching the same button twice only wires one click listener', async () => {
    const dom = buildDom();
    const collectSnapshot = vi.fn().mockResolvedValue(makeSnapshot());

    const controller = createIssueReportModalController(
      { previewModal: dom.previewModal, previewContent: dom.previewContent, cancelBtn: dom.cancelBtn, closeBtn: dom.closeBtn, openBtn: dom.openBtn },
      collectSnapshot,
    );
    controller.attachTrigger(dom.sidebarReportBtn);
    controller.attachTrigger(dom.sidebarReportBtn); // 2回目 — 無視されること

    dom.sidebarReportBtn.click();
    await Promise.resolve();
    await Promise.resolve();

    // リスナーが1つだけなら collectSnapshot も1回だけ呼ばれる
    expect(collectSnapshot).toHaveBeenCalledTimes(1);

    dom.openBtn.click();
    const create = (globalThis as unknown as { chrome: { tabs: { create: ReturnType<typeof vi.fn> } } }).chrome.tabs.create;
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('attachTrigger(null) is a no-op and does not throw', () => {
    const dom = buildDom();
    const controller = createIssueReportModalController(
      { previewModal: dom.previewModal, previewContent: dom.previewContent, cancelBtn: dom.cancelBtn, closeBtn: dom.closeBtn, openBtn: dom.openBtn },
      vi.fn().mockResolvedValue(makeSnapshot()),
    );
    expect(() => controller.attachTrigger(null)).not.toThrow();
  });
```

**注意**: `collectSnapshot`の呼び出し回数で二重登録を検出するのが最も確実。`chrome.tabs.create`の回数だけを見ると、`pendingUrl`が同じ値で上書きされるため二重登録でも1回しか呼ばれず、検出できない。

### 検証コマンド

```bash
npm run type-check
npx vitest run src/dashboard/panels/diagnostic/__tests__/issueReportLink.wire.test.ts
npx vitest run src/dashboard   # 回帰確認（2230件程度）
```

### 触ってはいけないもの

- `diagnosticsPanel.ts:580-582` の `getIssueReportModalController()?.attachTrigger(...)` 呼び出し — 変更不要
- `dashboard.ts` の controller 生成部分 — 変更不要
- `buildIssueReportBody` / `buildIssueReportUrl` — サニタイズ契約があるため一切触らない

---

## BDD受け入れシナリオ

```gherkin
Scenario: 同一ボタンに対しattachTriggerを複数回呼んでもリスナーは1つだけ登録される
  Given controller が生成されている
  When 同一のreportBtn要素に対して attachTrigger(btn) を2回呼ぶ
  Then そのボタンのクリックで collectSnapshot が1回だけ呼ばれる

Scenario: 異なる2つのボタンにattachTriggerした場合は両方とも正しく動作する
  Given controller が生成されている
  When 診断パネルのボタンとサイドバーのボタンにそれぞれ attachTrigger(btn) を呼ぶ
  Then 両方のボタンのクリックがそれぞれ独立して chrome.tabs.create を1回ずつ呼ぶ

Scenario: reportBtnがnullの場合は何もしない
  Given controller が生成されている
  When attachTrigger(null) を呼ぶ
  Then 例外を投げずに何もしない
```

## 受け入れ基準
- [ ] `createIssueReportModalController`の関数スコープに`WeakSet<HTMLButtonElement>`を追加し、`attachTrigger`が配線済みボタンへの再呼び出しで`addEventListener`をスキップする
- [ ] 異なるボタン要素への`attachTrigger`は引き続き独立して正しく配線される（診断パネル・サイドバーの2箇所を壊さない）
- [ ] `issueReportLink.wire.test.ts`に「同一ボタンへの複数回`attachTrigger`で`collectSnapshot`が1回だけ呼ばれる」テストを追加する
- [ ] 名前と実装が乖離していた既存の`reentrancy guard`テスト（145-167行目）を、実態に合う内容に修正するか削除する
- [ ] `npx vitest run src/dashboard` が全件green

## テスト戦略
- E2E: 既存のissue報告導線E2E（`testDir/e2e/usability/dashboard-issue-report.spec.ts`）をそのまま再実行し回帰がないことを確認
- 統合: なし（controller単体のユニットテストで代替）
- 単体: 同一ボタンへの複数回`attachTrigger`、異なるボタンへの`attachTrigger`、null安全性

## 見積もり
1ポイント（要チームでの見積もり）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み
