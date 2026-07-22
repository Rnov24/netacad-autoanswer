# Plan 001: Fix isScrapeInFlight race condition and unawaited recursive retry

> **Executor instructions**: Follow this plan step by step. Run every verification
> command and confirm the expected result before moving to the next step. If anything
> in the "STOP conditions" section occurs, stop and report — do not improvise. When
> done, update the status row for this plan in `plans/README.md`.
>
> **Drift check (run first)**: Open `scraper.js` and confirm the excerpts in
> "Current state" match the live code. If they do not, STOP and report.

## Status

- **Priority**: P1
- **Effort**: S (< 1 hour)
- **Risk**: LOW — changes isolated to `scraper.js`
- **Depends on**: none
- **Category**: bug
- **Planned at**: commit `ba71b0f`, 2026-07-21

## Why this matters

`scrapeData()` guards concurrent runs with the `isScrapeInFlight` flag, but the
flag is only set to `true` near the bottom of the function — after the cache check,
API-key check, and a loop iterating over all question elements. Any second call
that enters the function in that window bypasses the guard, causes duplicate
concurrent API calls, and injects duplicate AI answer panels into the page.

Additionally, when no questions are found on attempt N, the function calls itself
recursively inside `setTimeout`. `setTimeout` is fire-and-forget: the caller
(`runAutonomousLoop`) receives `false` immediately and proceeds, while the retry
runs asynchronously in the background. The autopilot can therefore advance to the
next question tab before the retry for the current tab completes.

## Current state

File: `d:\Projects\netacad-autoanswer\scraper.js`

Lock guard is near the top of `scrapeData` — but the flag assignment comes ~130 lines
later (only around the batch API call section):

```js
// Top of scrapeData — the only check:
if (isScrapeInFlight) { return false; }

// ... ~130 lines of logic including awaits ...

// Flag is set HERE — far too late:
isScrapeInFlight = true;
try { ... } finally { isScrapeInFlight = false; }
```

Retry block (fire-and-forget setTimeout):

```js
if (currentAttempt < MAX_SCRAPE_ATTEMPTS) {
  setTimeout(() => {
    const scrapeFn = ...;
    if (scrapeFn) scrapeFn(currentAttempt + 1);
  }, SCRAPE_RETRY_DELAY_MS);
  return false;    // caller sees false immediately; retry runs async
}
```

The `waitMs` async helper already exists in `scraper.js`:

```js
async function waitMs(ms) { ... }
```

## Scope

**In scope** (only file to modify):
- `scraper.js`

**Out of scope** (do NOT touch):
- `ui.js`, `content.js`, `api.js`, `background.js`, `popup.js`

## Steps

### Step 1: Move isScrapeInFlight = true to the top of the function

Immediately after the early-return guard (the `if (isScrapeInFlight) return false;`
check), set `isScrapeInFlight = true` and open a `try` block that wraps the entire
rest of the function body. The matching `finally { isScrapeInFlight = false; }` must
be the last thing in the function.

Target shape:

```js
async function scrapeData(currentAttempt = 1) {
  if (isScrapeInFlight) {
    console.debug("...");
    return false;
  }
  isScrapeInFlight = true;   // <-- moved here
  try {
    // ... all existing logic ...
  } finally {
    isScrapeInFlight = false;
  }
}
```

**Verify**: Search for `isScrapeInFlight = true` in the modified file. Confirm it
appears within the first 5 lines of the function body and is NOT inside any nested
`if` or `for` block.

### Step 2: Replace setTimeout retry with an awaitable recursion

Replace:

```js
if (currentAttempt < MAX_SCRAPE_ATTEMPTS) {
  setTimeout(() => {
    const scrapeFn = ...;
    if (scrapeFn) scrapeFn(currentAttempt + 1);
  }, SCRAPE_RETRY_DELAY_MS);
  return false;
}
```

With:

```js
if (currentAttempt < MAX_SCRAPE_ATTEMPTS) {
  isScrapeInFlight = false;   // release lock before waiting
  await new Promise((r) => setTimeout(r, SCRAPE_RETRY_DELAY_MS));
  return scrapeData(currentAttempt + 1);
}
```

Note: The lock must be released before the delay so that the guard at the top
of the next recursive call does not immediately return false.

**Verify**: Search `scraper.js` for `setTimeout` inside `scrapeData`. The ONLY
`setTimeout` usage inside the function should now be `new Promise(r => setTimeout(r, ...))`.

## Done criteria

- [ ] `isScrapeInFlight = true` is the first statement after the guard check in `scrapeData`
- [ ] A single `try/finally` wraps all remaining logic and resets the flag
- [ ] Retry block uses `await new Promise(...) + return scrapeData(n+1)` — no `setTimeout` wrapper
- [ ] `isScrapeInFlight = false` appears before the retry delay
- [ ] Only `scraper.js` is modified (`git diff --name-only`)
- [ ] `plans/README.md` status updated to DONE

## STOP conditions

- The lock variable name in the live file differs from `isScrapeInFlight`
- The retry section is already using `await` recursion (already fixed — update README only)
- The change requires touching any file outside the in-scope list

## Maintenance notes

- `isScrapeInFlight` is module-level mutable state shared with the scraper loop;
  if the scraper is ever run in a Worker context, this will need to be a proper mutex
- Holding the lock during the retry delay is intentional (prevents a second caller
  from re-entering during the wait); the explicit release-before-delay in Step 2
  is the only safe unlock point
