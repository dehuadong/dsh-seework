/**
 * Vitest setup: React 18 refuses to run `act()` — and warns on every call —
 * unless the environment declares itself a test environment. `process.env`
 * alone does not reach the check (it reads `globalThis`), so set it here once.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
