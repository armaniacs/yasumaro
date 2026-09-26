/**
 * Bans Playwright's fixed-duration wait in test and benchmark code:
 *
 *   await page.waitForTimeout(500);
 *
 * This is the E2E twin of `no-test-sleep`. A fixed wait cannot fail, so it
 * proves nothing; it only burns wall time, and on a loaded machine it is the
 * difference between green and flaky. Waiting for a condition is also the only
 * version that survives a slow CI runner: the assertion retries until the
 * state it names is true, instead of hoping the constant was big enough.
 *
 * Only member calls are matched, because that is the whole Playwright surface
 * (`Page`, `Frame`, `Locator`, `Worker`, `JSHandle` all expose the same
 * `waitForTimeout`). A bare `setTimeout` sleep is `no-test-sleep`'s business,
 * not this rule's, so the two can be enabled on different file sets without
 * double reporting.
 *
 * Every call is reported, whatever the duration: unlike a sleep there is no
 * threshold to tune, because no duration of `waitForTimeout` expresses a
 * condition. Opt out only with a stated reason, per AGENTS.md:
 *   // eslint-disable-next-line local/no-fixed-wait -- <why no condition exists>
 *
 * See dev-docs/TEST_RULE.md § 実時間待ちの禁止と代替手段
 */
export default {
  meta: {
    type: 'problem',
    docs: {
      description: 'Disallow fixed-duration waits (waitForTimeout) in Playwright tests; wait for a condition instead.',
    },
    schema: [],
    messages: {
      fixedWait:
        'waitForTimeout() sleeps for a fixed duration, so it cannot fail and only costs wall time. Wait for the condition instead (expect(locator).toBeVisible(), expect.poll(() => ...), or page.waitForFunction()), or disable this line with a stated reason.',
    },
  },
  create(context) {
    /**
     * `page.waitForTimeout(500)` and `page['waitForTimeout'](500)` name the
     * same API, so both are matched; any other computed key is ignored rather
     * than guessed at.
     */
    function calledMethodName(node) {
      if (!node.computed) return node.property.type === 'Identifier' ? node.property.name : null;
      return node.property.type === 'Literal' && typeof node.property.value === 'string' ? node.property.value : null;
    }

    return {
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type !== 'MemberExpression') return;
        if (calledMethodName(callee) !== 'waitForTimeout') return;
        context.report({ node, messageId: 'fixedWait' });
      },
    };
  },
};
