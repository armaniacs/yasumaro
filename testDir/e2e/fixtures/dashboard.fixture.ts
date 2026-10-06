import { expect } from '@playwright/test';
import { createDashboardFixture } from './dashboard-shared.fixture.js';

// 'synthesize': no flat ai_provider_priority_list here — the SW's
// deferred migration synthesizes the priority list from ai_provider
// (see ProviderPriorityListSeed in launchExtensionContext.ts).
export const testInteraction = createDashboardFixture({
  seedPolicy: {
    consent: true,
    breakingChangesShown: true,
    provider: { name: 'gemini', layout: 'a', priorityList: 'synthesize' },
  },
});
export { expect };
