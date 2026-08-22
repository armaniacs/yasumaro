import { vi, describe, it, expect, beforeEach } from 'vitest';
import { MessageHandlerRegistry } from '../MessageHandlerRegistry.js';
import { ValidVisitValidator, DashboardSqliteValidator } from '../../../messaging/validators.js';

describe('MessageHandlerRegistry — validator integration', () => {
  let registry: MessageHandlerRegistry;

  beforeEach(() => {
    registry = new MessageHandlerRegistry('test-id');
  });

  it('calls validator before handler and rejects invalid VALID_VISIT', () => {
    const handler = vi.fn();
    const validator = new ValidVisitValidator();
    registry.register('VALID_VISIT', handler, 'content-script-allowed', validator as unknown as import('../../../messaging/validators.js').MessageValidator<unknown>);

    const sendResponse = vi.fn();
    const sender = { id: 'test-id', tab: { id: 1, url: 'https://example.com' } } as unknown as chrome.runtime.MessageSender;

    // Invalid: missing content
    const invalidMsg = { type: 'VALID_VISIT', payload: {}, protocolVersion: 1 };
    const result = registry.dispatch('VALID_VISIT', invalidMsg, sender, sendResponse);

    expect(result).toBe(false); // validator error is sync response, consistent with trust rejection
    expect(handler).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  it('passes valid VALID_VISIT through validator to handler', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const validator = new ValidVisitValidator();
    registry.register('VALID_VISIT', handler, 'content-script-allowed', validator as unknown as import('../../../messaging/validators.js').MessageValidator<unknown>);

    const sendResponse = vi.fn();
    const sender = { id: 'test-id', tab: { id: 1, url: 'https://example.com' } } as unknown as chrome.runtime.MessageSender;
    const validMsg = { type: 'VALID_VISIT', payload: { content: 'hello' }, protocolVersion: 1 };

    registry.dispatch('VALID_VISIT', validMsg, sender, sendResponse);
    await vi.waitFor(() => expect(handler).toHaveBeenCalled());
    expect(sendResponse).not.toHaveBeenCalledWith(expect.objectContaining({ success: false, error: expect.stringContaining('content') }));
  });

  it('rejects invalid DASHBOARD_SQLITE subtype', () => {
    const handler = vi.fn();
    const validator = new DashboardSqliteValidator();
    registry.register('DASHBOARD_SQLITE', handler, 'extension-only', validator as unknown as import('../../../messaging/validators.js').MessageValidator<unknown>);

    const sendResponse = vi.fn();
    const sender = { id: 'test-id' } as unknown as chrome.runtime.MessageSender;

    const invalid = { type: 'DASHBOARD_SQLITE', payload: { subtype: 'unknown_op' }, protocolVersion: 1 };
    registry.dispatch('DASHBOARD_SQLITE', invalid, sender, sendResponse);

    expect(handler).not.toHaveBeenCalled();
    expect(sendResponse).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
  });

  it('passes valid DASHBOARD_SQLITE through', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const validator = new DashboardSqliteValidator();
    registry.register('DASHBOARD_SQLITE', handler, 'extension-only', validator as unknown as import('../../../messaging/validators.js').MessageValidator<unknown>);

    const sendResponse = vi.fn();
    const sender = { id: 'test-id' } as unknown as chrome.runtime.MessageSender;
    const valid = { type: 'DASHBOARD_SQLITE', payload: { subtype: 'status' }, protocolVersion: 1 };

    registry.dispatch('DASHBOARD_SQLITE', valid, sender, sendResponse);
    await vi.waitFor(() => expect(handler).toHaveBeenCalled());
  });

  it('handler without validator still works (backward compat)', async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    registry.register('PING', handler, 'content-script-allowed');

    const sendResponse = vi.fn();
    const sender = { id: 'test-id' } as unknown as chrome.runtime.MessageSender;
    registry.dispatch('PING', { type: 'PING', protocolVersion: 1 }, sender, sendResponse);
    await vi.waitFor(() => expect(handler).toHaveBeenCalled());
  });
});
