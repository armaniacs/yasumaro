/**
 * domEnv.mjs — instrumented jsdom environment for micro benchmarks.
 *
 * Provides a jsdom window wired onto globalThis plus counters the harness
 * reports as algorithmic-cost proxies:
 *
 *   - qsa         : querySelectorAll calls (Element + Document prototypes)
 *   - treeWalker  : nodes visited via createTreeWalker().nextNode()/currentNode walk
 *   - reflow      : reads of layout-coupled getters (innerText, offsetWidth/Height,
 *                   getBoundingClientRect, getComputedStyle, scrollHeight...).
 *                   jsdom does not lay out, so this counts *access opportunities*,
 *                   which is still a meaningful regression signal.
 *   - clone       : cloneNode(true) calls
 *
 * Every patch is restored by teardown() so consecutive benches don't leak
 * counts into each other. Adapted from scripts/benchmark-cleansing.mjs.
 */
import { JSDOM } from 'jsdom';

const DOM_GLOBALS = [
  'window',
  'document',
  'navigator',
  'Node',
  'Element',
  'HTMLElement',
  'HTMLIFrameElement',
  'DocumentFragment',
  'ShadowRoot',
  'NodeFilter',
  'Blob',
  'DOMParser',
  'MutationObserver',
  'getComputedStyle',
  'requestAnimationFrame',
  'cancelAnimationFrame',
];

const REFLOW_GETTERS = [
  'innerText',
  'offsetWidth',
  'offsetHeight',
  'offsetTop',
  'offsetLeft',
  'scrollWidth',
  'scrollHeight',
  'clientWidth',
  'clientHeight',
];

/**
 * @param {string} bodyHtml  markup placed inside <body>
 * @param {{ url?: string, countReflow?: boolean }} [opts]
 */
export function setupDom(bodyHtml = '', opts = {}) {
  const { url = 'https://bench.local/', countReflow = true } = opts;

  const saved = {};
  for (const key of DOM_GLOBALS) {
    saved[key] = Object.getOwnPropertyDescriptor(globalThis, key);
  }

  /** Assign onto globalThis even when an existing prop is a getter-only accessor. */
  const setGlobal = (key, value) => {
    try {
      Object.defineProperty(globalThis, key, {
        value,
        writable: true,
        configurable: true,
        enumerable: false,
      });
      return true;
    } catch {
      return false;
    }
  };

  const dom = new JSDOM(`<!DOCTYPE html><html><head></head><body>${bodyHtml}</body></html>`, {
    url,
    pretendToBeVisual: true,
  });
  const { window } = dom;

  for (const key of DOM_GLOBALS) {
    if (key in window) {
      setGlobal(key, window[key]);
    }
  }

  const counters = { qsa: 0, treeWalker: 0, reflow: 0, clone: 0 };
  const restorers = [];

  // --- querySelectorAll ---
  for (const proto of [window.Element.prototype, window.Document.prototype, window.DocumentFragment.prototype]) {
    const orig = proto.querySelectorAll;
    proto.querySelectorAll = function patchedQSA(...args) {
      counters.qsa++;
      return orig.apply(this, args);
    };
    restorers.push(() => {
      proto.querySelectorAll = orig;
    });
  }

  // --- cloneNode(true) ---
  {
    const orig = window.Node.prototype.cloneNode;
    window.Node.prototype.cloneNode = function patchedClone(deep) {
      if (deep) counters.clone++;
      return orig.call(this, deep);
    };
    restorers.push(() => {
      window.Node.prototype.cloneNode = orig;
    });
  }

  // --- createTreeWalker traversal ---
  {
    const origCreate = window.Document.prototype.createTreeWalker;
    window.Document.prototype.createTreeWalker = function patchedCreateTreeWalker(...args) {
      const walker = origCreate.apply(this, args);
      const origNext = walker.nextNode.bind(walker);
      const origPrev = walker.previousNode.bind(walker);
      walker.nextNode = () => {
        const n = origNext();
        if (n) counters.treeWalker++;
        return n;
      };
      walker.previousNode = () => {
        const n = origPrev();
        if (n) counters.treeWalker++;
        return n;
      };
      return walker;
    };
    restorers.push(() => {
      window.Document.prototype.createTreeWalker = origCreate;
    });
  }

  // --- reflow-coupled getters ---
  if (countReflow) {
    for (const prop of REFLOW_GETTERS) {
      const desc = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, prop);
      if (!desc || typeof desc.get !== 'function') continue;
      const origGet = desc.get;
      Object.defineProperty(window.HTMLElement.prototype, prop, {
        ...desc,
        get() {
          counters.reflow++;
          return origGet.call(this);
        },
      });
      restorers.push(() => {
        Object.defineProperty(window.HTMLElement.prototype, prop, desc);
      });
    }
    const origGCS = window.getComputedStyle.bind(window);
    const patchedGCS = function patchedGCS(...args) {
      counters.reflow++;
      return origGCS(...args);
    };
    try {
      window.getComputedStyle = patchedGCS;
    } catch {
      /* jsdom may expose it read-only */
    }
    setGlobal('getComputedStyle', patchedGCS);
    restorers.push(() => {
      try {
        window.getComputedStyle = origGCS;
      } catch {
        /* noop */
      }
    });

    const rectDesc = Object.getOwnPropertyDescriptor(window.Element.prototype, 'getBoundingClientRect');
    if (rectDesc && typeof rectDesc.value === 'function') {
      const origRect = rectDesc.value;
      window.Element.prototype.getBoundingClientRect = function patchedRect(...args) {
        counters.reflow++;
        return origRect.apply(this, args);
      };
      restorers.push(() => {
        window.Element.prototype.getBoundingClientRect = origRect;
      });
    }
  }

  return {
    dom,
    window,
    document: window.document,
    counters,
    resetCounters() {
      counters.qsa = 0;
      counters.treeWalker = 0;
      counters.reflow = 0;
      counters.clone = 0;
    },
    snapshotCounters() {
      return { ...counters };
    },
    teardown() {
      for (const restore of restorers.reverse()) {
        try {
          restore();
        } catch {
          /* best-effort */
        }
      }
      for (const key of DOM_GLOBALS) {
        try {
          if (saved[key]) {
            Object.defineProperty(globalThis, key, saved[key]);
          } else {
            delete globalThis[key];
          }
        } catch {
          /* best-effort */
        }
      }
      dom.window.close();
    },
  };
}
