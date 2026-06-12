# Tests

Mirrors the homei test setup.

```
tests/
├── unit/             # pure-logic tests, jsdom env, no DB        → pnpm test:unit
├── integration/      # hit a real Postgres on :54322            → pnpm test:integration
├── e2e/              # Playwright, drives the running app        → pnpm test:e2e
├── fixtures/         # static test data
├── helpers/          # shared test utilities
├── stubs/            # module stubs (e.g. server-only)
└── setup-integration.ts   # boots schema stubs + migrations, truncates between tests
```

## Running

```bash
# unit (fast, no infra)
pnpm test:unit

# integration — start the throwaway Postgres first
pnpm test:db:up
pnpm test:integration
pnpm test:db:down

# e2e
pnpm test:e2e
```

Integration tests **refuse to run** unless `DATABASE_URL` points at `localhost`
(gated by `.env.test`) so they can never touch a real database.
