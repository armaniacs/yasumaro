/**
 * aiServiceFactory.test.ts
 * Direct verification of createAIService — the composition root that wires
 * LocalAIService + RemoteAIService + FallbackAIService together.
 *
 * The injection seams ({ remoteAiService }, { builtInAiClient }) are exercised
 * through createBackgroundServices today; this test pins them at the factory
 * boundary so a regression in the wiring is caught without the full background
 * composition.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../RemoteAIService.js', () => ({
  RemoteAIService: vi.fn(),
}));
vi.mock('../../builtInAIClient.js', () => ({
  BuiltInAIClient: vi.fn(),
}));
vi.mock('../FallbackAIService.js', () => ({
  FallbackAIService: vi.fn(),
}));
vi.mock('../LocalAIService.js', () => ({
  LocalAIService: vi.fn(),
}));

import { RemoteAIService } from '../RemoteAIService.js';
import { BuiltInAIClient } from '../../builtInAIClient.js';
import { FallbackAIService } from '../FallbackAIService.js';
import { LocalAIService } from '../LocalAIService.js';
import { createAIService } from '../aiServiceFactory.js';

const RemoteAIServiceMock = RemoteAIService as unknown as ReturnType<typeof vi.fn>;
const BuiltInAIClientMock = BuiltInAIClient as unknown as ReturnType<typeof vi.fn>;
const FallbackAIServiceMock = FallbackAIService as unknown as ReturnType<typeof vi.fn>;
const LocalAIServiceMock = LocalAIService as unknown as ReturnType<typeof vi.fn>;

function lastInstance(mock: ReturnType<typeof vi.fn>): unknown {
  return mock.mock.results[mock.mock.results.length - 1]!.value;
}

beforeEach(() => {
  vi.clearAllMocks();
  // RemoteAIService must be constructable with `new`; give each instance a fake
  // so FallbackAIService receives a truthy remote without constructing a real one.
  RemoteAIServiceMock.mockImplementation(function RemoteAIServiceMockCtor() {
    return { fakeRemote: true };
  });
});

describe('createAIService', () => {
  it('builds the default composition: local + remote inside FallbackAIService', () => {
    const service = createAIService();

    expect(RemoteAIServiceMock).toHaveBeenCalledTimes(1);
    expect(BuiltInAIClientMock).toHaveBeenCalledTimes(1);
    expect(FallbackAIServiceMock).toHaveBeenCalledTimes(1);

    const remoteInstance = lastInstance(RemoteAIServiceMock);
    const local = lastInstance(LocalAIServiceMock);
    expect(FallbackAIServiceMock).toHaveBeenCalledWith({
      local,
      remote: remoteInstance,
    });
    expect(service).toBe(lastInstance(FallbackAIServiceMock));
  });

  it('uses the injected remoteAiService instead of constructing a new RemoteAIService', () => {
    const injected = { injectedRemote: true } as unknown as RemoteAIService;
    createAIService({ remoteAiService: injected });

    expect(RemoteAIServiceMock).not.toHaveBeenCalled();
    expect(FallbackAIServiceMock).toHaveBeenCalledWith({
      local: expect.anything(),
      remote: injected,
    });
  });

  it('uses the injected builtInAiClient instead of constructing a new one', () => {
    const injected = { fake: true } as unknown as BuiltInAIClient;
    createAIService({ builtInAiClient: injected });

    expect(BuiltInAIClientMock).not.toHaveBeenCalled();
    expect(LocalAIServiceMock).toHaveBeenCalledWith({ localAiClient: injected });
  });

  it('accepts both injection seams at once and wires each service to its client', () => {
    const remoteAiService = { fakeRemote: 'ai' } as unknown as RemoteAIService;
    const builtInAiClient = { fake: 'builtin' } as unknown as BuiltInAIClient;
    createAIService({ remoteAiService, builtInAiClient });

    expect(RemoteAIServiceMock).not.toHaveBeenCalled();
    expect(BuiltInAIClientMock).not.toHaveBeenCalled();
    expect(FallbackAIServiceMock).toHaveBeenCalledWith({
      local: expect.anything(),
      remote: remoteAiService,
    });
    expect(LocalAIServiceMock).toHaveBeenCalledWith({ localAiClient: builtInAiClient });
  });

  it('constructs each service exactly once per call', () => {
    createAIService();
    createAIService();

    expect(RemoteAIServiceMock).toHaveBeenCalledTimes(2);
    expect(BuiltInAIClientMock).toHaveBeenCalledTimes(2);
    expect(LocalAIServiceMock).toHaveBeenCalledTimes(2);
    expect(FallbackAIServiceMock).toHaveBeenCalledTimes(2);
  });
});
