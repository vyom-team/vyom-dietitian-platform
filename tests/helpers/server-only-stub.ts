/**
 * Stand-in for the `server-only` package under test.
 *
 * `server-only` exists to make importing a server module from a client
 * component a build error. Its real export throws when resolved outside Next's
 * server condition, which would make every service that imports it untestable.
 *
 * Aliasing it to this empty module in vitest only affects the test run. The
 * guarantee it provides in the application build is untouched, because the real
 * package is still what Next resolves.
 */
export {};
