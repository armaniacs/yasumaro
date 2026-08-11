/**
 * aiServiceFactory.test.ts
 * Direct verification of createAIService — the composition root that wires
 * LocalAIService + RemoteAIService + FallbackAIService together.
 *
 * The injection seams ({ aiClient }, { builtInAiClient }) are only exercised
 * through createBackgroundServices today; this test pins them at the factory
 * boundary so a regression in the wiring is caught without the full background
 * composition.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../aiClient.js', () => ({
  AIClient: vi.fn(),
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
vi.mock('../RemoteAIService.js', () => ({
  RemoteAIService: vi.fn(),
}));

import { AIClient } from '../../aiClient.js';
import { BuiltInAIClient } from '../../builtInAIClient.js';
import { FallbackAIService } from '../FallbackAIService.js';
import { LocalAIService } from '../LocalAIService.js';
import { RemoteAIService } from '../RemoteAIService.js';
import { createAIService } from '../aiServiceFactory.js';

const AIClientMock = AIClient as unknown as ReturnType<typeof vi.fn>;
const BuiltInAIClientMock = BuiltInAIClient as unknown as ReturnType<typeof vi.fn>;
const FallbackAIServiceMock = FallbackAIService as unknown as ReturnType<typeof vi.fn>;
const LocalAIServiceMock = LocalAIService as unknown as ReturnType<typeof vi.fn>;
const RemoteAIServiceMock = RemoteAIService as unknown as ReturnType<typeof vi.fn>;

function lastInstance(mock: ReturnType<typeof vi.fn>): unknown {
  return mock.mock.results[mock.mock.results.length - 1]!.value;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('createAIService', () => {
  it('builds the default composition: local + remote inside FallbackAIService', () => {
    const service = createAIService();

    expect(AIClientMock).toHaveBeenCalledTimes(1);
    expect(BuiltInAIClientMock).toHaveBeenCalledTimes(1);
    expect(FallbackAIServiceMock).toHaveBeenCalledTimes(1);

    const local = lastInstance(LocalAIServiceMock);
    const remote = lastInstance(RemoteAIServiceMock);
    expect(FallbackAIServiceMock).toHaveBeenCalledWith({ local, remote });
    expect(service).toBe(lastInstance(FallbackAIServiceMock));
  });

  it('uses the injected aiClient instead of constructing a new AIClient', () => {
    const injected = { fake: true } as unknown as AIClient;
    createAIService({ aiClient: injected });

    expect(AIClientMock).not.toHaveBeenCalled();
    expect(RemoteAIServiceMock).toHaveBeenCalledWith({ aiClient: injected });
  });

  it('uses the injected builtInAiClient instead of constructing a new one', () => {
    const injected = { fake: true } as unknown as BuiltInAIClient;
    createAIService({ builtInAiClient: injected });

    expect(BuiltInAIClientMock).not.toHaveBeenCalled();
    expect(LocalAIServiceMock).toHaveBeenCalledWith({ localAiClient: injected });
  });

  it('accepts both injection seams at once and wires each service to its client', () => {
    const aiClient = { fake: 'ai' } as unknown as AIClient;
    const builtInAiClient = { fake: 'builtin' } as unknown as BuiltInAIClient;
    createAIService({ aiClient, builtInAiClient });

    expect(AIClientMock).not.toHaveBeenCalled();
    expect(BuiltInAIClientMock).not.toHaveBeenCalled();
    expect(RemoteAIServiceMock).toHaveBeenCalledWith({ aiClient });
    expect(LocalAIServiceMock).toHaveBeenCalledWith({ localAiClient: builtInAiClient });
  });

  it('constructs each service exactly once per call', () => {
    createAIService();
    createAIService();

    expect(AIClientMock).toHaveBeenCalledTimes(2);
    expect(BuiltInAIClientMock).toHaveBeenCalledTimes(2);
    expect(LocalAIServiceMock).toHaveBeenCalledTimes(2);
    expect(RemoteAIServiceMock).toHaveBeenCalledTimes(2);
    expect(FallbackAIServiceMock).toHaveBeenCalledTimes(2);
  });
});
