/**
 * `RuleTester` wrapper that keeps ESLint rule tests green under
 * `vitest --repeats`.
 *
 * ESLint's `RuleTester` allocates its duplicate-case registry inside the
 * `describe` body (`node_modules/eslint/lib/rule-tester/rule-tester.js`, the
 * `const seenTestCases = new Set()` lines under `describe("valid")` and
 * `describe("invalid")`). `vitest --repeats` re-runs the `it` body in-process
 * without re-running the `describe` body, so every repetition after the first
 * re-enters the registry the previous repetition filled and dies with
 * "detected duplicate test case".
 *
 * `RuleTester.describe` / `RuleTester.it` exist as settable statics precisely so
 * a test runner can substitute its own registration functions. This module
 * substitutes them with proxies that remember each `describe` tree, then
 * re-executes those trees once per test so that every repetition gets its own
 * registry. The rule cases stay untouched: each registered `it` still runs the
 * real `RuleTester` assertion body, so no assertion is reimplemented or lost.
 */
import { afterAll, beforeEach } from 'vitest';
import { RuleTester } from 'eslint';
import type { Linter } from 'eslint';

/** The body `RuleTester` hands to `it`; it carries the whole rule assertion. */
type RuleCaseBody = () => void | Promise<void>;

type DescribeRegistration = (name: string, body: () => void) => unknown;
type CaseRegistration = (name: string, body: RuleCaseBody) => void;
type RunMethod = RuleTester['run'];

/** A top-level `RuleTester.run` call: the rule-name suite and its body. */
interface RuleRun {
    name: string;
    body: () => void;
}

const rootRuns: RuleRun[] = [];
/** Case bodies in registration order; index is the case key. */
const collectionBodies: RuleCaseBody[] = [];
let iterationBodies: RuleCaseBody[] = [];

/**
 * Set while `RuleTester.run` is executing, so the next `describe` call is known
 * to be the root suite. Nesting depth cannot answer this: vitest defers a
 * `describe` body, which returns the call depth to zero before the body reaches
 * the nested `describe("valid") / describe("invalid")` calls.
 */
let awaitingRootDescribe = false;
/** True while re-executing the `describe` trees purely to harvest fresh bodies. */
let harvesting = false;
/** Monotonic case counter, reset to 0 at the start of every harvest pass. */
let nextCaseOrdinal = 0;

const realRun = RuleTester.prototype.run;
const realDescribe = RuleTester.describe as DescribeRegistration;
const realIt = RuleTester.it as CaseRegistration;
const realItOnly = RuleTester.itOnly as CaseRegistration;

RuleTester.prototype.run = function repeatSafeRun(
    this: RuleTester,
    ...args: Parameters<RunMethod>
): ReturnType<RunMethod> {
    awaitingRootDescribe = true;
    try {
        return realRun.apply(this, args);
    } finally {
        awaitingRootDescribe = false;
    }
};

/**
 * Runs the registered case for the current iteration, refusing to fall back to
 * the body captured at collection time. Falling back would silently restore the
 * shared registry, so it fails loudly instead.
 */
function runRegisteredCase(ordinal: number, caseName: string): RuleCaseBody {
    return () => {
        const fresh = iterationBodies[ordinal];
        if (fresh === undefined) {
            throw new Error(
                `[repeatSafeRuleTester] no body was rebuilt for case "${caseName}" (#${ordinal}). ` +
                    'The describe trees registered at collection time no longer replay to the same cases.',
            );
        }
        if (fresh === collectionBodies[ordinal]) {
            throw new Error(
                `[repeatSafeRuleTester] case "${caseName}" replayed its collection-time body, so its ` +
                    'duplicate-case registry was shared across repeats.',
            );
        }
        return fresh();
    };
}

function registerCase(caseName: string, body: RuleCaseBody, register: CaseRegistration): void {
    if (!harvesting && rootRuns.length === 0) {
        throw new Error('[repeatSafeRuleTester] RuleTester registered a case outside any describe body');
    }
    const ordinal = nextCaseOrdinal;
    nextCaseOrdinal += 1;

    if (harvesting) {
        iterationBodies[ordinal] = body;
        return;
    }
    collectionBodies[ordinal] = body;
    register(caseName, runRegisteredCase(ordinal, caseName));
}

/**
 * The `describe` proxy. Kept as a named binding as well as the installed static
 * so a harvest can re-enter it directly: on a worker that shares the module
 * registry a previously loaded file's `afterAll` has already restored
 * `RuleTester.describe`, and going through the static would then call the real
 * suite function from inside a test.
 */
const describeProxy = ((name: string, body: () => void) => {
    if (awaitingRootDescribe) {
        awaitingRootDescribe = false;
        rootRuns.push({ name, body });
    }
    if (harvesting) {
        body();
        return undefined;
    }
    return realDescribe(name, body);
}) as typeof RuleTester.describe;

RuleTester.describe = describeProxy;

RuleTester.it = ((name: string, body: RuleCaseBody) => {
    registerCase(name, body, realIt);
    return undefined;
}) as typeof RuleTester.it;

RuleTester.itOnly = ((name: string, body: RuleCaseBody) => {
    registerCase(name, body, realItOnly);
    return undefined;
}) as typeof RuleTester.itOnly;

/**
 * Re-executes every `describe` tree registered by `RuleTester.run` and returns
 * the per-case bodies that execution produced, in registration order. Each call
 * makes `RuleTester` allocate a fresh duplicate-case registry, which is what
 * lets a second iteration pass where the first one already fails.
 *
 * `beforeEach` calls this once per test; it is exported so the mechanism itself
 * can be tested inside a single-repetition run.
 */
export function rebuildRuleCaseBodiesForIteration(): RuleCaseBody[] {
    const rebuilt: RuleCaseBody[] = [];
    const previousBodies = iterationBodies;
    const previousOrdinal = nextCaseOrdinal;
    iterationBodies = rebuilt;
    nextCaseOrdinal = 0;
    harvesting = true;
    try {
        for (const run of [...rootRuns]) {
            describeProxy(run.name, run.body);
        }
    } finally {
        harvesting = false;
        nextCaseOrdinal = previousOrdinal;
        iterationBodies = previousBodies;
    }

    if (rebuilt.length !== collectionBodies.length) {
        throw new Error(
            `[repeatSafeRuleTester] replaying the describe trees produced ${rebuilt.length} cases but ` +
                `${collectionBodies.length} were registered at collection time.`,
        );
    }
    iterationBodies = rebuilt;
    return rebuilt;
}

beforeEach(() => {
    rebuildRuleCaseBodiesForIteration();
});

afterAll(() => {
    RuleTester.prototype.run = realRun;
    RuleTester.describe = realDescribe;
    RuleTester.it = realIt;
    RuleTester.itOnly = realItOnly;
});

/**
 * Builds a `RuleTester` whose cases survive `vitest --repeats`. Import the
 * factory instead of `new RuleTester` and keep the case lists as they are.
 */
export function createRepeatSafeRuleTester(config?: Linter.Config): RuleTester {
    return new RuleTester(config);
}
