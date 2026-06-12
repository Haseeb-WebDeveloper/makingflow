// Stub for the `server-only` package in tests. The real package is meant
// to throw in non-server contexts to prevent leaking server code into
// client bundles. In tests, that protection is irrelevant — we want to
// import server modules directly to verify their pure logic.
export {}
