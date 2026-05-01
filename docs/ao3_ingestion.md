# AO3 chapter ingestion

How Auralia fetches and parses a single AO3 chapter URL into a cleaned
document, what trade-offs the current implementation makes, and which upgrades
are worth considering when we outgrow it.

Source: `apps/api/src/auralia_api/ingestion/ao3.py`.

## Scope

The ingest endpoint accepts exactly one shape of URL:

```
https://archiveofourown.org/works/<work_id>/chapters/<chapter_id>
```

Anything else (http, a different host, a work-level URL without a chapter, an
unknown path) is rejected as `AO3ValidationError` before any network call.

One URL = one chapter = one `documents` row. Multi-chapter works are handled by
ingesting each chapter individually; `previous_chapter_url` and
`next_chapter_url` are captured in `source_metadata` so that a future crawler
can walk a work without re-parsing the chapter body.

## Fetching

### Cloudflare and the User-Agent

AO3 sits behind Cloudflare. Requests with a minimal User-Agent (e.g. the
default `Python-urllib/3.x`, or our earlier `Auralia/0.1`) are met with
`HTTP 525` — nominally "SSL handshake failed", in practice Cloudflare bot
rejection. Sending a browser-shaped header set gets through:

```
User-Agent:        Mozilla/5.0 (X11; Linux x86_64; rv:122.0) Gecko/20100101 Firefox/122.0
Accept:            text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8
Accept-Language:   en-US,en;q=0.5
Accept-Encoding:   identity
```

`Accept-Encoding: identity` keeps the response uncompressed so we can decode it
directly without pulling in a gzip/brotli path.

### Rate gate

A process-global 2-second minimum interval between fetches is enforced by
`_respectful_gate()` (a lock + `time.monotonic()` timestamp). This is a
politeness floor, not a rate limiter — it prevents the ingest endpoint from
hammering AO3 if called in a tight loop, but it does not coordinate across
processes or machines.

### Response limits

- `timeout=15` seconds on the urlopen call (surfaced as `AO3FetchError:
  timed out`).
- `_MAX_HTML_BYTES = 2_000_000` — responses above 2 MB are rejected. Real AO3
  chapter pages are well under this.
- `Content-Type` must contain `html`, otherwise we reject.

### Restricted-work redirect detection

AO3 silently 302s chapters that are archive-locked, registered-only, or
deleted to the site homepage. The response looks successful but is not a
chapter page. We check `response.geturl()` after the redirect chain resolves
and require the final path to start with `/works/`. Anything else produces a
specific `AO3FetchError` mentioning the likely causes.

## Parsing

`html.parser.HTMLParser` is used directly — no BeautifulSoup, no lxml. The
parser is stateful: it tracks its current depth and whether it is inside each
region of interest.

### Selectors

| Region              | Selector                                   |
|---------------------|--------------------------------------------|
| Chapter body        | `div#chapters div.userstuff.module`        |
| Chapter title       | `div#chapters h3.title`                    |
| Work title          | `h2.title.heading` (outside `#chapters`)   |
| Authors             | `a[rel="author"]` (anywhere on the page)   |
| Previous chapter    | `li.chapter.previous a[href*="/chapters/"]`|
| Next chapter        | `li.chapter.next a[href*="/chapters/"]`    |

The chapter-body region is captured as raw HTML (including start and end
tags) and only cleaned afterwards by `clean_prose_text`. This keeps the
paragraph/line structure intact through the parse, and delegates prose
cleaning (HTML strip, entity decode, whitespace, typographic normalization)
to a single shared pipeline shared with the plain-text endpoint.

### Scoping work title vs chapter title

The page contains two heading-like strings: the work title (in the preface,
outside `#chapters`) and the chapter title (inside `#chapters`). The parser
tracks `_chapters_depth` and only captures `h3.title` as the chapter title
when the current depth is inside `#chapters`; conversely, `h2.title.heading`
is only captured as the work title when not inside `#chapters`. Without this
scoping the two can collide on pages that reuse heading classes.

### Author URLs

`a[rel="author"]` hrefs on AO3 are relative (`/users/JaneAuthor/pseuds/JaneAuthor`).
They are absolutized against `https://archiveofourown.org/` before being
returned so that `source_metadata` contains fully-qualified URLs and downstream
consumers don't need to know the origin.

### Post-parse touch-ups

After `clean_prose_text`:

- A generic leading `"Chapter Text\n\n"` is stripped (AO3 inserts this as a
  heading for chapters that have no author-provided title).
- If a chapter title was parsed and the cleaned body doesn't already start
  with it, the title is prepended with a blank line separator. This makes the
  stored `text` self-contained.

## Persisted shape

A successful AO3 ingest writes:

- A `documents` row with `id`, `source_id = "ao3:work:<work_id>"`,
  `chapter_id = "ch_<chapter_id>"`, cleaned `text`, `text_length`,
  `normalization` flags, and `source_metadata` (JSON).
- An `ingestion_jobs` row with `status = "completed"` referencing the
  document, or `status = "failed"` with `error_message` if anything upstream
  raised.

`source_metadata` shape for AO3:

```json
{
  "source": "ao3",
  "work_id": "52818466",
  "work_title": "Hogwarts and All That",
  "authors": [
    {
      "name": "JaneAuthor",
      "url": "https://archiveofourown.org/users/JaneAuthor/pseuds/JaneAuthor"
    }
  ],
  "chapter_id": "133596877",
  "chapter_title": "Chapter 1: Year 1",
  "previous_chapter_url": "https://archiveofourown.org/works/52818466/chapters/133596876",
  "next_chapter_url": "https://archiveofourown.org/works/52818466/chapters/133596878"
}
```

`previous_chapter_url` / `next_chapter_url` are `null` at the ends of a work.

## Error mapping

| Condition                           | Exception            | HTTP |
|-------------------------------------|----------------------|------|
| Bad scheme / host / path            | `AO3ValidationError` | 400  |
| Timeout, URL error, 5xx, redirect   | `AO3FetchError`      | 502  |
| Body region missing / empty         | `AO3ParseError`      | 422  |

## Future upgrades

These are ordered roughly by "most likely to matter first".

### TLS fingerprint resilience (`curl_cffi`)

Cloudflare can and occasionally does tighten bot detection beyond the UA
string — checking TLS ClientHello fingerprints (JA3/JA4). `urllib` sits on
Python's `ssl` module, which produces a distinctive fingerprint. When a UA
swap stops being enough, the cleanest fix is `curl_cffi`, which impersonates
Chrome/Firefox/Safari at the TLS layer. This is the most robust mitigation
short of running a real browser, and it's still a drop-in HTTP client.

### Retry with backoff on transient 525

Even with the browser UA we occasionally see sporadic 525s on rapid
back-to-back requests. A small retry loop (e.g. 3 attempts, 1s / 4s / 10s
backoff, only on 525 and 502) would improve hit rate without materially
slowing the happy path.

### Full-work crawler

With `next_chapter_url` already captured, walking a full work is mostly
plumbing: enqueue the next chapter from each completed job, de-duplicate on
`chapter_id`, stop when `next_chapter_url is null`. What's missing is a
`works` table to own the work-level identity (title, authors, last-seen
chapter count, crawl status) — today those fields live denormalized inside
every `documents.source_metadata`. When we actually implement crawling we
should lift them into a proper parent row and have `documents` reference it.

### Registered-only works

Chapters gated to logged-in users currently redirect to the homepage and we
reject them cleanly. Supporting them means authenticating — an AO3 session
cookie after a real login. This is a policy decision (ToS, storage of user
credentials, per-user vs shared session) before it is a technical one.

### Adult-content warning interstitial

Works flagged as explicit show an interstitial that requires clicking through.
This is controlled by the `view_adult=true` query parameter (or a cookie).
Adding it to the fetch would unlock adult-flagged works without needing auth.
Again: policy decision first.

### Full-work endpoint

AO3 supports `?view_full_work=true`, which returns every chapter of a
single-file work in one response. For works chosen to be rendered as one
audiobook this avoids N requests and N rate-gate waits. Downside: one very
large HTML page, and our chapter/document identity model currently assumes
one chapter per document. Worth revisiting once crawling is in place.

### Chapter position from `<select id="selected_id">`

Multi-chapter works include a chapter dropdown. Parsing it yields the total
chapter count and the canonical ordering, which is more reliable than walking
prev/next links for detecting "we've seen everything".

### httpx instead of urllib

`urllib` is fine for one-shot synchronous fetches. If we move ingest behind a
queue or start crawling concurrently, `httpx` (async, connection pooling,
HTTP/2, better error surface) is a less painful foundation. Not urgent.

### Richer AO3 test fixtures

Tests currently use hand-rolled minimal HTML. Capturing a handful of real AO3
responses (stripped of PII) as fixtures would catch regressions in selector
matching when AO3 changes its markup — which it does, occasionally.

### Extra metadata (tags, summary, relationships)

The preface block on chapter 1 carries fandom, relationship, and character
tags plus the work summary. None of it is needed for synthesis today, but
it's cheap to capture and useful for library/search UX later. Add as optional
fields on `source_metadata`; no schema change needed.

### robots.txt and ToS posture

AO3's `robots.txt` doesn't forbid reading individual work pages, but the ToS
restricts scraping and redistribution. The current 2-second rate gate is a
reasonable posture for human-in-the-loop personal use. Any move toward
crawling or batch ingestion should be paired with an explicit check of the
current ToS and a respectful-crawler mode (robots.txt honoring,
Retry-After-aware, clearly-identified UA).
