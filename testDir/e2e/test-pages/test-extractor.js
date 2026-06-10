// Minimal test extractor
console.log('[OWeave-Test] Minimal extractor loaded');
(window as any).__OW_TEST_STATE = {
  maxScrollPercentage: 0,
  isValidVisitReported: false,
  startTime: Date.now(),
  minVisitDuration: 5,
  minScrollDepth: 50,
  duration: 0,
};
console.log('[OWeave-Test] __OW_TEST_STATE set');
