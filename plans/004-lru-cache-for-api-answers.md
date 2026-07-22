# Plan 004: Add LRU eviction to apiAnswerCache to prevent memory leaks

> **Executor instructions**: Follow this plan step by step. Confirm each verification
> command result before moving on. STOP and report on any STOP condition.
> Update `plans/README.md` when done.
>
> **Drift check**: `grep -n "apiAnswerCache" d:\Projects\netacad-autoanswer\scraper.js`
> Expected: at least 3 matches (declaration, cache.has, cache.set).

## Status

- **Priority**: P2
- **Effort**: S (< 2 hours)
- **Risk**: LOW — purely replaces a Map with a drop-in size-capped equivalent
- **Depends on**: none
- **Category**: perf / tech-debt
- **Planned at**: commit `ba71b0f`, 2026-07-21

## Why this matters

`apiAnswerCache` is a module-level `Map` that stores AI responses keyed by a
question fingerprint. It is never cleared and never evicted. On a long automated
quiz run (multiple modules, many unique question sets), the Map grows without bound
for the lifetime of the tab. For a typical course with hundreds of sub-topics this
could accumulate thousands of large string entries.

An LRU cache with a fixed capacity (50 entries) handles all practical use cases —
no real quiz session will revisit 50 different unique question sets — while bounding
memory at approximately 50 × ~2KB = 100KB in the worst case.

## Current state

File: `d:\Projects\netacad-autoanswer\scraper.js`

```js
const apiAnswerCache = new Map();   // near line 8

// Used like a standard Map:
if (apiAnswerCache.has(fingerprint)) { ... }
apiAnswerCache.set(fingerprint, answers);
```

No eviction or size limit of any kind exists.

## Scope

**In scope**:
- `scraper.js`

**Out of scope** (do NOT touch):
- All other files

## Steps

### Step 1: Implement a minimal LRU cache class inline in scraper.js

Add this class near the top of `scraper.js`, before `const apiAnswerCache`:

```js
class LruCache {
  constructor(maxSize = 50) {
    this._max = maxSize;
    this._map = new Map();
  }
  has(key) { return this._map.has(key); }
  get(key) {
    if (!this._map.has(key)) return undefined;
    const val = this._map.get(key);
    // Move to end (most recently used)
    this._map.delete(key);
    this._map.set(key, val);
    return val;
  }
  set(key, val) {
    if (this._map.has(key)) this._map.delete(key);
    this._map.set(key, val);
    if (this._map.size > this._max) {
      // Evict oldest (first entry — Map preserves insertion order)
      this._map.delete(this._map.keys().next().value);
    }
  }
}
```

**Verify**: The class definition exists in `scraper.js` before `apiAnswerCache`.

### Step 2: Replace Map with LruCache

Change:

```js
const apiAnswerCache = new Map();
```

To:

```js
const apiAnswerCache = new LruCache(50);
```

**Verify**: `grep -n "new Map()" d:\Projects\netacad-autoanswer\scraper.js`
Should return 0 matches (the Map is now only used inside LruCache._map).

### Step 3: Verify all usage sites are compatible

The cache is used in three ways — confirm each call site still works with the
LruCache interface:
- `apiAnswerCache.has(fingerprint)` — `LruCache.has()` returns boolean ✓
- `apiAnswerCache.get(fingerprint)` — `LruCache.get()` returns value or undefined ✓
- `apiAnswerCache.set(fingerprint, answers)` — `LruCache.set()` stores value ✓

**Verify**: `grep -n "apiAnswerCache\." d:\Projects\netacad-autoanswer\scraper.js`
Only `.has(`, `.get(`, `.set(` should appear.

## Done criteria

- [ ] `LruCache` class defined in `scraper.js` before `apiAnswerCache`
- [ ] `apiAnswerCache` is `new LruCache(50)` not `new Map()`
- [ ] `grep -n "new Map()" scraper.js` returns 0 (no bare Map usage at top level)
- [ ] Only `scraper.js` modified
- [ ] `plans/README.md` status updated

## STOP conditions

- `apiAnswerCache` is used anywhere in the codebase outside `scraper.js` (grep first)
- Any call site uses Map methods beyond `.has()`, `.get()`, `.set()` (e.g. `.size`, `.forEach`, `.clear()`)

## Maintenance notes

- The LRU size of 50 is conservative; adjust upward only if profiling shows cache
  misses exceeding 50% across a normal session
- Do not add `.clear()` unless you have a specific use case; the eviction policy
  already handles memory
