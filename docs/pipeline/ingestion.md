# Ingestion & cleaning

Ingestion accepts a single AO3 chapter URL or a block of plain text and produces a cleaned, normalized `documents` row ready for segmentation.

## Source types

Two ingestion paths share the same cleaning pipeline:

- **`POST /api/ingest/text`** — accepts raw text (plain or markdown) in the request body.
- **`POST /api/ingest/ao3`** — accepts a single AO3 chapter URL, fetches the HTML, extracts the chapter body, then passes it through the shared cleaner.

Both produce the same output shape and both write an `ingestion_jobs` row tracking status and any error message.

## Text cleaning pipeline

`cleaning.py` runs a multi-pass normalization over the raw text before storage:

1. HTML tag stripping + HTML entity decoding.
2. Markdown heading/formatting removal.
3. Whitespace normalization (collapse runs, trim lines, strip excess blank lines).
4. Typographic normalization:
   - Curly/angle double quotes → ASCII `"`
   - En/em dashes → `--`
   - Ellipsis characters → `...`

All normalization passes are flagged in a `normalization` JSON column on the `documents` row so downstream stages know what was changed.

## AO3 fetching

### URL validation

Only `https://archiveofourown.org/works/<work_id>/chapters/<chapter_id>` URLs are accepted. Any other scheme, host, or path raises `AO3ValidationError` (HTTP 400) before any network call is made.

### Cloudflare

AO3 rejects requests with non-browser User-Agents (HTTP 525). Auralia sends a Firefox-shaped header set to get through:

```
User-Agent:      Mozilla/5.0 (X11; Linux x86_64; rv:122.0) Gecko/20100101 Firefox/122.0
Accept:          text/html,application/xhtml+xml,...
Accept-Encoding: identity
```

`Accept-Encoding: identity` keeps responses uncompressed to avoid a gzip/brotli dependency.

### Rate gate

A process-global 2-second minimum interval between AO3 fetches is enforced by `_respectful_gate()` (a lock + `time.monotonic()` timestamp). This is a politeness floor for single-user local use, not a production-grade rate limiter.

### Response limits

- 15-second timeout on the HTTP call.
- 2 MB maximum response size.
- `Content-Type` must contain `html`.
- After any redirect chain, the final URL must start with `/works/`. Silent redirects to the AO3 homepage (deleted, restricted, or archive-locked works) produce a descriptive `AO3FetchError` (HTTP 502).

## AO3 parsing

`ao3.py` uses Python's stdlib `html.parser.HTMLParser` directly — no BeautifulSoup or lxml. The parser is stateful: it tracks depth and whether it is currently inside each region of interest.

### Selectors

| Region           | Selector                                         |
|------------------|--------------------------------------------------|
| Chapter body     | `div#chapters div.userstuff.module`              |
| Chapter title    | `div#chapters h3.title`                          |
| Work title       | `h2.title.heading` (outside `#chapters`)         |
| Authors          | `a[rel="author"]` (anywhere on page)             |
| Previous chapter | `li.chapter.previous a[href*="/chapters/"]`      |
| Next chapter     | `li.chapter.next a[href*="/chapters/"]`          |

The chapter body is captured as raw HTML and handed to `clean_prose_text` afterwards. This preserves paragraph structure through the parse and delegates all normalization to the single shared cleaning pipeline.

The parser tracks `_chapters_depth` to prevent the two heading-like strings on a chapter page (work title and chapter title) from colliding — AO3 reuses heading class names across both regions.

Author hrefs are relative on AO3; the parser absolutizes them against `https://archiveofourown.org/` before returning.

### Post-parse touch-ups

After cleaning:
- A generic `"Chapter Text\n\n"` leading prefix (added by AO3 for untitled chapters) is stripped.
- If the chapter has a parsed title and it's not already at the start of the cleaned text, the title is prepended with a blank line separator so the stored text is self-contained.

## Data stored

A successful ingestion writes:

- A `documents` row: `id`, `source_id`, `chapter_id`, `title`, `text` (cleaned), `text_length`, `normalization` (JSON flags), `source_metadata` (JSON, AO3 only).
- An `ingestion_jobs` row: `status = "completed"` or `"failed"` with `error_message`.

AO3 `source_metadata` shape:

```json
{
  "source": "ao3",
  "work_id": "52818466",
  "work_title": "Title",
  "authors": [{ "name": "AuthorName", "url": "https://archiveofourown.org/users/..." }],
  "chapter_id": "133596877",
  "chapter_title": "Chapter 1",
  "previous_chapter_url": "...",
  "next_chapter_url": "..."
}
```

`previous_chapter_url` / `next_chapter_url` are `null` at the ends of a work. These are captured to support a future chapter crawler.

## Error handling

| Condition                            | Exception            | HTTP |
|--------------------------------------|----------------------|------|
| Bad scheme / host / path             | `AO3ValidationError` | 400  |
| Timeout, 5xx, silent redirect        | `AO3FetchError`      | 502  |
| Body region missing / empty after parse | `AO3ParseError`   | 422  |

## Code structure

```
apps/api/src/auralia_api/ingestion/
  __init__.py
  schemas.py      # Pydantic request/response models
  ao3.py          # AO3 fetch + stateful HTML parse
  cleaning.py     # multi-pass text normalization
  service.py      # orchestration: fetch/parse → clean → persist
  storage.py      # SQLite inserts (mirrors Drizzle schema)
```

Tests: `tests/ingestion/` — `test_cleaning.py`, `test_text_ingestion_api.py`, `test_ao3_adapter.py`, `test_ao3_ingestion_api.py`.

## Known limitations and future work

- **TLS fingerprinting:** Cloudflare can check TLS ClientHello fingerprints (JA3/JA4) beyond the User-Agent. If the current header approach stops working, `curl_cffi` (which impersonates browser TLS at the connection layer) is the cleanest fix.
- **Transient 525s:** occasional sporadic failures on rapid back-to-back requests. A small retry loop with backoff would improve hit rate.
- **Multi-chapter crawling:** `next_chapter_url` is captured and ready; a crawler just needs a `works` table to own work-level identity and a queue mechanism to walk chapters.
- **Registered-only works:** currently redirect to the homepage and fail cleanly. Supporting them requires AO3 session cookies — a policy decision before a technical one.
- **Adult-content interstitial:** `?view_adult=true` query param would unlock explicit-flagged works without auth.
- **Chapter position:** AO3's `<select id="selected_id">` dropdown contains canonical chapter ordering and total count, which is more reliable than prev/next link walking.
