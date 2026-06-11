# 記録されたことが、開かなくてもわかるようになりました ── 自動保存バッジ

ページを読み終えたあと、「これ、記録されたのかな」とポップアップを開いて確認することがありました。

タブを切り替えて、アイコンをクリックして、ステータスパネルを確認する。それだけのことですが、読書の流れが途切れます。

v4.2 から、自動保存が完了したタブのアイコンに青色の `◎` バッジを表示するようにしました。ポップアップを開かなくても、記録されたことがわかります。

---

## どう見えるか

ページが自動記録されると、ツールバーアイコンの右下に青色（`#3B82F6`）の `◎` が表示されます。

バッジはそのタブにいる間は表示し続けます。別のタブに移動して戻ってきても `◎` のままです。同じタブで別のページに遷移したとき（つまり「次のページ」を読み始めたとき）に消えます。

---

## `setTimeout` を使わなかった理由

最初の実装では `setTimeout` で3秒後にバッジを消していました。

問題は、3秒という数字に根拠がないことです。ページをゆっくり読んでいるユーザーには短すぎますし、すぐ次のページに移動するユーザーには長すぎます。

「記録されたページを読んでいる間」という状態をバッジで示す、というほうが自然です。消えるタイミングは「そのページを離れたとき」にすべきです。

---

## タブIDを Set で管理する

バッジを「そのタブにいる間だけ」表示するために、表示中のタブIDを `Set` で追跡しています。

```typescript
// 自動保存成功バッジを表示中のタブIDセット
const autoSavedBadgeTabs = new Set<number>();
```

自動保存が成功したとき：

```typescript
if (result.success && sender.tab.id) {
    const savedTabId = sender.tab.id;
    autoSavedBadgeTabs.add(savedTabId);
    chrome.action.setBadgeText({ text: '◎', tabId: savedTabId });
    chrome.action.setBadgeBackgroundColor({ color: '#3B82F6', tabId: savedTabId });
}
```

ページ遷移が完了したとき（`onUpdated`）：

```typescript
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status !== 'complete' || !tab.url) return;
    // ページ遷移完了時は自動保存バッジをクリア（新しいページのため）
    autoSavedBadgeTabs.delete(tabId);
    // ...以降、プライバシーバッジの処理
});
```

タブ切り替え時（`onActivated`）：

```typescript
chrome.tabs.onActivated.addListener(async (activeInfo) => {
    // 自動保存バッジ表示中のタブは ◎ を維持
    if (autoSavedBadgeTabs.has(activeInfo.tabId)) {
        chrome.action.setBadgeText({ text: '◎', tabId: activeInfo.tabId });
        chrome.action.setBadgeBackgroundColor({ color: '#3B82F6', tabId: activeInfo.tabId });
        return;
    }
    // ...以降、プライバシーバッジの処理
});
```

---

## プライバシーバッジ `!` との共存

同じツールバーアイコンに、プライバシー検出の `!`（オレンジ）もあります。

優先順位はシンプルです。`onActivated` でタブを切り替えたとき、`autoSavedBadgeTabs` に含まれていれば `◎` を表示して処理を終わらせます。含まれていなければ、プライバシーキャッシュを参照して `!` か空かを判断します。

自動保存バッジが表示されているとき、そのページはプライベートページではありません（プライベートページは記録がスキップされるため）。実際には両者が同時に表示されることはありませんが、コードの構造としても `◎` が先に判定されるようにしています。

---

## バッジの意味と使い分け

| バッジ | 色 | 意味 |
|-------|----|------|
| `!` | オレンジ | プライバシーヘッダー検出。自動記録が止まっている |
| `◎` | 青 | 自動記録が完了した |
| （なし） | — | 通常状態（記録済みでも未記録でも） |

`!` は「何かある」を知らせる警告で、`◎` は「完了した」を知らせる確認です。役割が違うので、色も記号も変えました。

---

## まとめ

| タイミング | バッジの動作 |
|-----------|------------|
| 自動保存完了時 | `◎`（青）をセット |
| タブを切り替えて戻ったとき | `◎` を維持 |
| 同タブで別ページに遷移したとき | クリア |

記録されたことをポップアップなしで確認できる。それだけのことですが、読んでいる流れを止めずに済みます。

---

**GitHub**: [obsidian-weave](https://github.com/armaniacs/obsidian-weave)
