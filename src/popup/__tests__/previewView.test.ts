// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PreviewViewImpl, DOM_IDS } from '../previewView.js';

vi.mock('../i18n.js', () => ({
  getMessage: vi.fn((key: string) => key),
}));

function createMockDoc() {
  const doc = document.implementation.createHTMLDocument();
  const modal = doc.createElement('dialog');
  modal.id = DOM_IDS.MODAL;

  const modalBody = doc.createElement('div');
  modalBody.className = 'modal-body';

  const previewContent = doc.createElement('textarea');
  previewContent.id = DOM_IDS.PREVIEW_CONTENT;

  const maskStatusMessage = doc.createElement('div');
  maskStatusMessage.id = DOM_IDS.MASK_STATUS_MESSAGE;

  const maskNav = doc.createElement('div');
  maskNav.id = DOM_IDS.MASK_NAV;

  const maskNavPrev = doc.createElement('button');
  maskNavPrev.id = DOM_IDS.MASK_NAV_PREV;

  const maskNavNext = doc.createElement('button');
  maskNavNext.id = DOM_IDS.MASK_NAV_NEXT;

  const maskNavCounter = doc.createElement('span');
  maskNavCounter.id = DOM_IDS.MASK_NAV_COUNTER;

  maskNav.appendChild(maskNavPrev);
  maskNav.appendChild(maskNavNext);
  maskNav.appendChild(maskNavCounter);

  modalBody.appendChild(previewContent);
  modalBody.appendChild(maskStatusMessage);
  modalBody.appendChild(maskNav);
  modal.appendChild(modalBody);

  doc.body.appendChild(modal);
  return doc;
}

describe('PreviewViewImpl', () => {
  it('constructs with default document', () => {
    const view = new PreviewViewImpl();
    expect(view.doc).toBe(document);
  });

  it('constructs with injected document', () => {
    const doc = createMockDoc();
    const view = new PreviewViewImpl(doc);
    expect(view.doc).toBe(doc);
  });

  it('getModal returns element or null', () => {
    const doc = createMockDoc();
    const view = new PreviewViewImpl(doc);
    expect(view.getModal()).not.toBeNull();

    const emptyDoc = document.implementation.createHTMLDocument();
    const emptyView = new PreviewViewImpl(emptyDoc);
    expect(emptyView.getModal()).toBeNull();
  });

  it('getPreviewContent returns element or null', () => {
    const doc = createMockDoc();
    const view = new PreviewViewImpl(doc);
    expect(view.getPreviewContent()).not.toBeNull();

    const emptyDoc = document.implementation.createHTMLDocument();
    expect(new PreviewViewImpl(emptyDoc).getPreviewContent()).toBeNull();
  });

  it('getMaskStatusMessage returns element or null', () => {
    const doc = createMockDoc();
    const view = new PreviewViewImpl(doc);
    expect(view.getMaskStatusMessage()).not.toBeNull();

    const emptyDoc = document.implementation.createHTMLDocument();
    expect(new PreviewViewImpl(emptyDoc).getMaskStatusMessage()).toBeNull();
  });

  it('setPreviewContent sets textarea value when element exists', () => {
    const doc = createMockDoc();
    const view = new PreviewViewImpl(doc);
    view.setPreviewContent('hello');
    expect(view.getPreviewContent()?.value).toBe('hello');
  });

  it('setPreviewContent does nothing when element missing', () => {
    const emptyDoc = document.implementation.createHTMLDocument();
    const view = new PreviewViewImpl(emptyDoc);
    expect(() => view.setPreviewContent('hello')).not.toThrow();
  });

  it('show opens modal with showModal when available', () => {
    const doc = createMockDoc();
    const view = new PreviewViewImpl(doc);
    const modal = view.getModal() as HTMLDialogElement;
    let called = false;
    modal.showModal = () => { called = true; };
    view.show('<b>html</b>');
    expect(called).toBe(true);
  });

  it('show falls back to open=true when showModal throws', () => {
    const doc = createMockDoc();
    const view = new PreviewViewImpl(doc);
    const modal = view.getModal() as HTMLDialogElement;
    modal.showModal = () => { throw new Error('not allowed'); };
    view.show('<b>html</b>');
    expect((modal as any).open).toBe(true);
  });

  it('show handles missing modal gracefully', () => {
    const emptyDoc = document.implementation.createHTMLDocument();
    const view = new PreviewViewImpl(emptyDoc);
    expect(() => view.show('html')).not.toThrow();
  });

  it('onConfirm and onCancel register handlers', () => {
    const view = new PreviewViewImpl();
    const h1 = vi.fn();
    const h2 = vi.fn();
    view.onConfirm(h1);
    view.onCancel(h2);
    expect(view.getConfirmHandlers()).toContain(h1);
    expect(view.getCancelHandlers()).toContain(h2);
  });

  it('clearHandlers removes all handlers', () => {
    const view = new PreviewViewImpl();
    view.onConfirm(vi.fn());
    view.onCancel(vi.fn());
    view.clearHandlers();
    expect(view.getConfirmHandlers()).toHaveLength(0);
    expect(view.getCancelHandlers()).toHaveLength(0);
  });

  it('ensureMaskStatusElement returns existing element', () => {
    const doc = createMockDoc();
    const view = new PreviewViewImpl(doc);
    expect(view.ensureMaskStatusElement()).not.toBeNull();
  });

  it('ensureMaskStatusElement creates element when missing', () => {
    const doc = createMockDoc();
    doc.getElementById(DOM_IDS.MASK_STATUS_MESSAGE)?.remove();
    const view = new PreviewViewImpl(doc);
    const el = view.ensureMaskStatusElement();
    expect(el).not.toBeNull();
    expect(el?.id).toBe(DOM_IDS.MASK_STATUS_MESSAGE);
  });

  it('ensureMaskStatusElement returns null when modal and body missing', () => {
    const emptyDoc = document.implementation.createHTMLDocument();
    const view = new PreviewViewImpl(emptyDoc);
    expect(view.ensureMaskStatusElement()).toBeNull();
  });

  it('updateMaskStatus updates text and visibility', () => {
    const doc = createMockDoc();
    const view = new PreviewViewImpl(doc);
    view.updateMaskStatus('status', true);
    const el = doc.getElementById(DOM_IDS.MASK_STATUS_MESSAGE) as HTMLElement;
    expect(el.textContent).toBe('status');
    expect(el.style.display).toBe('');

    view.updateMaskStatus('status', false);
    expect(el.textContent).toBe('');
    expect(el.style.display).toBe('none');
  });

  it('updateMaskStatus does nothing when element cannot be ensured', () => {
    const emptyDoc = document.implementation.createHTMLDocument();
    const view = new PreviewViewImpl(emptyDoc);
    expect(() => view.updateMaskStatus('x', true)).not.toThrow();
  });

  it('resetBodyWidth sets width', () => {
    const doc = document.implementation.createHTMLDocument();
    const view = new PreviewViewImpl(doc);
    view.resetBodyWidth();
    expect(doc.body.style.width).toBe('320px');
  });

  it('focusPreview does not throw when element missing', () => {
    const emptyDoc = document.implementation.createHTMLDocument();
    const view = new PreviewViewImpl(emptyDoc);
    expect(() => view.focusPreview()).not.toThrow();
  });

  it('jumpToPosition sets selection and counter', () => {
    const doc = createMockDoc();
    const view = new PreviewViewImpl(doc);
    const el = view.getPreviewContent() as HTMLTextAreaElement;
    el.value = 'hello world';
    view.jumpToPosition({ start: 2, end: 5 }, 1, 3);
    expect(el.selectionStart).toBe(2);
    expect(el.selectionEnd).toBe(5);
    expect(doc.getElementById(DOM_IDS.MASK_NAV_COUNTER)?.textContent).toBe('2/3');
  });

  it('jumpToPosition handles missing preview content', () => {
    const emptyDoc = document.implementation.createHTMLDocument();
    const view = new PreviewViewImpl(emptyDoc);
    expect(() => view.jumpToPosition({ start: 0, end: 1 }, 0, 1)).not.toThrow();
  });

  it('setNavCounter updates counter text', () => {
    const doc = createMockDoc();
    const view = new PreviewViewImpl(doc);
    view.setNavCounter(2, 5);
    expect(doc.getElementById(DOM_IDS.MASK_NAV_COUNTER)?.textContent).toBe('3/5');
  });

  it('setNavCounter does nothing when counter missing', () => {
    const emptyDoc = document.implementation.createHTMLDocument();
    const view = new PreviewViewImpl(emptyDoc);
    expect(() => view.setNavCounter(0, 1)).not.toThrow();
  });

  it('buildNavigation creates nav when missing', () => {
    const doc = createMockDoc();
    const view = new PreviewViewImpl(doc);
    doc.getElementById(DOM_IDS.MASK_NAV)?.remove();
    const onPrev = vi.fn();
    const onNext = vi.fn();
    view.buildNavigation([{ start: 0, end: 1 }], onPrev, onNext);
    const nav = doc.getElementById(DOM_IDS.MASK_NAV) as HTMLElement;
    expect(nav).not.toBeNull();
    expect(nav.style.display).toBe('flex');
  });

  it('buildNavigation hides nav when no positions', () => {
    const doc = createMockDoc();
    const view = new PreviewViewImpl(doc);
    const onPrev = vi.fn();
    const onNext = vi.fn();
    view.buildNavigation([], onPrev, onNext);
    const nav = doc.getElementById(DOM_IDS.MASK_NAV) as HTMLElement;
    expect(nav.style.display).toBe('none');
  });

  it('buildNavigation wires button clicks', () => {
    const doc = createMockDoc();
    const view = new PreviewViewImpl(doc);
    doc.getElementById(DOM_IDS.MASK_NAV)?.remove();
    const onPrev = vi.fn();
    const onNext = vi.fn();
    view.buildNavigation([{ start: 0, end: 1 }], onPrev, onNext);
    const prevBtn = doc.getElementById(DOM_IDS.MASK_NAV_PREV) as HTMLButtonElement;
    const nextBtn = doc.getElementById(DOM_IDS.MASK_NAV_NEXT) as HTMLButtonElement;
    prevBtn.click();
    expect(onPrev).toHaveBeenCalled();
    nextBtn.click();
    expect(onNext).toHaveBeenCalled();
  });

  it('buildNavigation does nothing when no container found', () => {
    const emptyDoc = document.implementation.createHTMLDocument();
    const view = new PreviewViewImpl(emptyDoc);
    expect(() => view.buildNavigation([], vi.fn(), vi.fn())).not.toThrow();
  });

  it('buildNavigation uses maskNavAnchor when present', () => {
    const doc = createMockDoc();
    doc.getElementById(DOM_IDS.MASK_NAV)?.remove();
    const anchor = doc.createElement('div');
    anchor.id = 'maskNavAnchor';
    doc.body.appendChild(anchor);
    const view = new PreviewViewImpl(doc);
    const onPrev = vi.fn();
    const onNext = vi.fn();
    view.buildNavigation([{ start: 0, end: 1 }], onPrev, onNext);
    expect(anchor.querySelector(`#${DOM_IDS.MASK_NAV}`)).not.toBeNull();
  });
});
