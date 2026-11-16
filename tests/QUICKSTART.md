# Quick Start Guide - TimeTrack E2E Tests

> **Forældet.** Dette dokument beskriver den gamle Playwright-suite, som nu er `test.skip` (se `tests/e2e/README.md` for det aktuelle kernesæt). Tallene og filerne nedenfor passer ikke længere.


## First Time Setup

1. **Install Playwright browsers** (one-time setup):

   ```bash
   npx playwright install
   ```

2. **Start the database**:

   ```bash
   npm run docker:up
   ```

3. **Start the development server**:

   ```bash
   npm run dev
   ```

   (Or let Playwright start it automatically)

## Running Tests

### Run all tests

```bash
npx playwright test
```

### Run specific test files

```bash
# Authentication tests
npx playwright test auth.spec.ts

# Client management tests
npx playwright test clients.spec.ts

# Project tests
npx playwright test projects.spec.ts

# Time tracking tests
npx playwright test time-tracking.spec.ts

# Klippekort tests
npx playwright test klippekort.spec.ts

# Dashboard tests
npx playwright test dashboard.spec.ts
```

### Interactive UI mode (Recommended!)

```bash
npx playwright test --ui
```
This opens a nice GUI where you can:
- See all tests in a tree view
- Run specific tests
- Watch tests execute in real-time
- Time-travel through test execution
- Inspect DOM and network

### Watch mode (for development)

```bash
npx playwright test --ui
```

### Run in headed mode (see the browser)

```bash
npx playwright test --headed
```

### Debug a specific test

```bash
npx playwright test --debug -g "should register a new user"
```

## View Test Results

After running tests, view the HTML report:
```bash
npx playwright show-report
```

## Test Structure

```
tests/e2e/
├── helpers.ts              # Shared utilities and Danish test data
├── auth.spec.ts           # 20 authentication tests
├── clients.spec.ts        # 24 client management tests
├── projects.spec.ts       # 25 project management tests
├── time-tracking.spec.ts  # 23 time tracking tests
├── klippekort.spec.ts     # 23 klippekort tests
└── dashboard.spec.ts      # 44 dashboard & UI tests
```

**Total: 159 comprehensive E2E tests**

## What's Tested?

- ✅ User registration and login
- ✅ Client CRUD operations with search/filter
- ✅ Project management with status tracking
- ✅ Time tracking with timer functionality
- ✅ Klippekort (prepaid packages) management
- ✅ Dashboard stats and navigation
- ✅ Mobile responsive design
- ✅ Form validation
- ✅ Error handling
- ✅ Danish localization

## Common Commands

```bash
# Run tests matching a pattern
npx playwright test -g "should create"

# Run tests in a specific file
npx playwright test clients.spec.ts

# Run only failed tests
npx playwright test --last-failed

# Update snapshots (if you add visual tests)
npx playwright test --update-snapshots

# Generate code by interacting with the app
npx playwright codegen http://localhost:3000
```

## Tips for Development

1. **Use UI Mode** (`--ui`) - It's the best way to develop and debug tests
2. **Run specific tests** - Don't run all 159 tests while developing
3. **Use debug mode** - Step through tests line by line
4. **Check the traces** - Playwright captures screenshots and videos on failure

## Troubleshooting

### Tests won't start

- Make sure database is running: `npm run docker:up`
- Make sure dev server is running: `npm run dev`
- Clear Playwright cache: `npx playwright clean`

### Tests are flaky

- Tests use `waitForDataLoad()` to wait for data
- Each test creates unique users to avoid conflicts
- Tests are designed to be independent

### Need to see what's happening

- Run with `--headed` flag to see the browser
- Run with `--debug` flag to step through tests
- Use `page.pause()` in test code to stop and inspect

## Next Steps

1. Read the full documentation: `tests/e2e/README.md`
2. Check the test summary: `tests/TEST_SUMMARY.md`
3. Start with UI mode: `npx playwright test --ui`
4. Run a single test file to get familiar
5. Check out helper functions in `helpers.ts`

## Adding New Tests

See `tests/e2e/README.md` for detailed guidelines on:
- Using helper functions
- Following test patterns
- Using Danish test data
- Ensuring test isolation
- Best practices

Happy Testing! 🎭
