<div align="center">

# Spotify Scraper API

**A single-file serverless API for public Spotify metadata and embeddable player links.**

[![Cloudflare Workers](https://img.shields.io/badge/Runtime-Cloudflare%20Workers-F38020?style=for-the-badge&logo=cloudflareworkers&logoColor=white)](https://workers.cloudflare.com/)
[![JavaScript](https://img.shields.io/badge/Language-JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![No API key](https://img.shields.io/badge/API%20key-not%20required-1db954?style=for-the-badge)](#no-api-keys-really)
[![Zero dependencies](https://img.shields.io/badge/dependencies-0-5965f2?style=for-the-badge)](#project-structure)
[![Single file](https://img.shields.io/badge/deploy-paste%20one%20file-ff69b4?style=for-the-badge)](#quick-start)
[![Tests](https://img.shields.io/badge/tests-27%20passing-brightgreen?style=for-the-badge)](#testing)
[![License: MIT](https://img.shields.io/badge/License-MIT-2ea44f?style=for-the-badge)](./LICENSE)

### Tracks · Albums · Playlists · Artists · Shows · Episodes

[Features](#features) · [Quick start](#quick-start) · [Endpoints](#endpoints) · [Example response](#example-response) · [Gotchas](#the-four-spotify-behaviours-this-worker-handles) · [Deploy](#deploy-to-cloudflare-workers) · [Disclaimer](#disclaimer)

<br />

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/YOUR_GITHUB_USERNAME/spotify-metadata-scraper)

</div>

---

> **Before you publish:** update the deploy button URL above to your own
> `github.com/<username>/<repository>` path, otherwise it will deploy someone
> else's repository.

An API-only Cloudflare Worker that reads metadata from public Spotify resource
pages and Spotify's own oEmbed endpoint. It returns titles, descriptions,
artwork, artists, durations, release dates, tracklists, a 30-second preview URL
where Spotify exposes one, and embeddable player links.

It accepts the messy links that the Spotify app actually copies — including
`?si=…&utm_source=copy-link` tracking parameters and `/intl/<locale>/` path
segments — and normalises them.

> **No music ripping or DRM circumvention.** Spotify's full tracks are not
> returned or downloadable through this API. Spotify audio is licensed and
> protected; this project only provides public metadata and links to Spotify's
> own embedded player. `audio_download_url` is always `null`. A `preview_url` is
> returned only when Spotify itself publishes one in the page's `og:audio` tag —
> it is never synthesised and no access control is bypassed.

## Features

- Metadata lookup for public Spotify **tracks, albums, playlists, artists, shows and episodes**
- Dual source: Spotify **oEmbed** plus **public page metadata**, either one able to fail without breaking the response
- **Artist names and monthly listener counts**, resolved without any API key
- **Album and playlist tracklists**, with optional per-track detail (`?tracks=1`)
- **30-second preview URL** where Spotify exposes one (`og:audio`)
- **Verified artwork size variants** (640/300/64 px) — only the ones Spotify's CDN actually serves
- Share-link normalisation: `open.spotify.com`, `play.spotify.com`, `/intl/<locale>/…`, `/embed/…`, `spotify.link` short links, `spotify:track:<id>` URIs and bare 22-character ids
- `/api/parse` explains what `si`, `utm_source`, `context`, `nd` and friends actually mean, and which are safe to remove
- Edge caching through the Workers **Cache API** — no KV, D1 or Durable Object bindings
- Optional API-key protection and CORS control; **both off by default**
- GET and POST support, JSON everywhere, `Access-Control-Allow-Origin: *`
- **Zero runtime dependencies** and a **pure-ASCII source file** that pastes cleanly into the dashboard editor
- 25 automated tests that run with plain `node test.js` — no `npm install`
- MIT licensed

Third-party services and public pages can change their behaviour or apply rate
limits. No uptime guarantee is provided for upstream services.

## No API keys, really

| | |
|---|---|
| Spotify developer app | **not required** |
| OAuth / client credentials | **not required** |
| Token refresh logic | **not required** |
| KV / D1 / Durable Objects | **not required** |
| npm packages | **not required** (`wrangler` is optional, for CLI deploys only) |

Everything comes from two public endpoints: the resource page HTML that Spotify
serves to link-preview crawlers, and `open.spotify.com/oembed`.

## Quick start

**No terminal needed** — see [Deploy with the dashboard](#1-deploy-with-the-dashboard-no-terminal-needed).

```bash
# From a terminal, if you prefer - wrangler.toml already points at worker.js:
npm install --no-save wrangler@4   # only fetches Wrangler; the Worker has no deps
npx wrangler deploy
```

Then:

```bash
curl "https://spotify-metadata-scraper.dinujayathishan06.workers.dev/api/scrape?url=https://open.spotify.com/track/1kZvBIepQFlgUywAub2h56"
```

The exact link the Spotify app copies works too — tracking parameters are stripped automatically:

```bash
curl "https://spotify-metadata-scraper.dinujayathishan06.workers.dev/api/scrape?url=https%3A%2F%2Fopen.spotify.com%2Ftrack%2F1kZvBIepQFlgUywAub2h56%3Fsi%3Dcq52Cz8HRdGNhNB-P8EfiQ%26utm_source%3Dcopy-link"
```

## Endpoints

### `GET /api/scrape?url={spotify_url}` — main endpoint

Accepts any public Spotify resource link:

```text
https://open.spotify.com/{type}/{id}
```

Supported types: `track`, `album`, `playlist`, `artist`, `show`, `episode`.

### `POST /api/scrape`

```bash
curl -X POST "https://spotify-metadata-scraper.dinujayathishan06.workers.dev/api/scrape" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://open.spotify.com/track/1kZvBIepQFlgUywAub2h56"}'
```

A plain-text body containing only the URL also works.

### `GET /api/embed?url={spotify_url}`

Returns the same JSON. Add `&format=html` for a page containing only the Spotify
player iframe, ready to embed.

### `GET /api/parse?url={spotify_url}`

Breaks a share link down and explains every query parameter — see
[What is `?si=`?](#what-is-si--utm_source-copy-link).

### `GET /api/{type}/{id}`

Shortcuts for `/api/scrape`: `/api/track/1kZvBIepQFlgUywAub2h56`,
`/api/album/…`, `/api/playlist/…`, `/api/artist/…`, `/api/episode/…`, `/api/show/…`.

### `GET /` and `GET /health`

Both stay public even when an API key is set, so uptime monitors keep working.

`/` returns a **short plain-text index** — ten lines or fewer, no JSON to wade
through:

```text
Spotify Scraper API v2.3.0

GET /api/scrape?url=<spotify link>
GET /api/embed?url=<spotify link>       add &format=html for an iframe page
GET /api/parse?url=<spotify link>
GET /api/track/<id>                     also album, playlist, artist, episode, show
GET /health

options: tracks=1  limit=10  light=1  intl=es  raw=1
```

```bash
curl "https://spotify-metadata-scraper.dinujayathishan06.workers.dev/"
```

Only the index is shortened. `/api/*` responses keep every field — a track
response is still around 3.5 KB of full metadata.

`/health` returns compact JSON: status, version, `base_url`, auth mode, cache
settings and supported types.

```json
{
  "success": true,
  "name": "Spotify Scraper API",
  "version": "2.3.0",
  "base_url": "https://spotify-metadata-scraper.dinujayathishan06.workers.dev",
  "api_index": "https://spotify-metadata-scraper.dinujayathishan06.workers.dev/",
  "requires_api_key": false,
  "auth": "public",
  "cache": "on (pages 21600s, responses 3600s)",
  "supported_types": ["track", "album", "playlist", "artist", "episode", "show"],
  "license": "MIT (c) Thishan Dinujaya"
}
```

### Query options

| Option | Effect |
| --- | --- |
| `?tracks=1&limit=10` | For albums/playlists: fetch each track's page for title, artists, duration and preview. `limit` is capped at 25. |
| `?light=1` | Skip artist-page lookups. Fastest response; `artists[].name` stays `null`. |
| `?intl=es` | Force a locale. Also detected automatically from `/intl/<locale>/` links. |
| `?raw=1` | Include `raw_meta`: every `<meta>` tag scraped from the page. Useful for debugging. |

## Example response

```json
{
  "success": true,
  "platform": "spotify",
  "resource_type": "track",
  "resource_id": "1kZvBIepQFlgUywAub2h56",
  "url": "https://open.spotify.com/track/1kZvBIepQFlgUywAub2h56",
  "uri": "spotify:track:1kZvBIepQFlgUywAub2h56",
  "locale": null,
  "title": "TURAN 2 - Slowed",
  "description": "ASTXR, zxguss · TURAN 2 · Song · 2026",
  "thumbnail": "https://image-cdn-fa.spotifycdn.com/image/ab67616d00001e02…",
  "content_type": "music.song",
  "page_url": "https://open.spotify.com/track/1kZvBIepQFlgUywAub2h56",
  "embed_url": "https://open.spotify.com/embed/track/1kZvBIepQFlgUywAub2h56?utm_source=oembed",
  "embed_width": 456,
  "embed_height": 152,
  "embed_html": "<iframe …></iframe>",
  "preview_url": "https://p.scdn.co/mp3-preview/378fab2b081dddadfb4ffbf3251c25a768a932ca",
  "audio_download_url": null,
  "metadata": {
    "kind": "Song",
    "artists_text": "ASTXR, zxguss",
    "artists": [
      { "id": "0rBrjQPcLqHj1Jk8Jvw7Xj", "name": "ASTXR",  "monthly_listeners": 933200, "monthly_listeners_text": "933.2K" },
      { "id": "3RmsXE6ZPyE1hLXyR2VvNa", "name": "zxguss", "monthly_listeners": 59500,  "monthly_listeners_text": "59.5K"  }
    ],
    "album": { "id": "4ntJgEVBlc3K4SWfKCQ7PS", "name": "TURAN 2", "track_number": 2 },
    "duration": { "seconds": 102, "ms": 102000, "formatted": "1:42" },
    "release_date": "2026-10-16",
    "available_in": ["AR", "AU", "AT", "…185 countries"],
    "images": { "url": "…", "large": "…640px", "medium": "…300px", "small": "…64px" },
    "isrc": null,
    "popularity": null,
    "explicit": null,
    "deep_links": { "app": "spotify:track:1kZvBIepQFlgUywAub2h56" }
  },
  "engine": "Spotify oEmbed + public page metadata",
  "scraped_with": "facebookexternalhit",
  "cached": true,
  "requires_api_key": false,
  "note": "This API returns public metadata and Spotify embed links only. It does not provide full-track downloads or bypass DRM."
}
```

A captured copy lives in [`example-response.json`](./example-response.json).
Some fields are `null` when Spotify does not expose them for that resource.

## What is `?si=` / `utm_source=copy-link`?

Short version: **tracking noise that you can delete.**

| Parameter | What it is | Safe to remove? |
| --- | --- | --- |
| `si` | **Share Identifier** — a random token Spotify generates when you tap "Copy Link", used for share analytics. It has no effect on the resource or its metadata. | Yes |
| `utm_source` | Where the link was shared from (`copy-link`, `whatsapp`, `instagram`, …). A marketing/analytics tag. | Yes |
| `utm_medium` / `utm_campaign` / `utm_term` / `utm_content` | More analytics tags. | Yes |
| `context` | The in-app context the track was played from (which playlist, etc.). | Yes |
| `nd`, `sp_cid`, `referrer` | Share destination / share context id / referrer. | Yes |
| `intl=es` | **Locale override — functional.** It can change the metadata returned. | No, keep it |
| `go=1`, `autoplay=1` | **Functional** — start playback / autoplay the embed. | No, keep it |

Ask the API instead of guessing:

```bash
curl "https://spotify-metadata-scraper.dinujayathishan06.workers.dev/api/parse?url=https%3A%2F%2Fopen.spotify.com%2Ftrack%2F1kZvBIepQFlgUywAub2h56%3Fsi%3Dcq52Cz8HRdGNhNB-P8EfiQ%26utm_source%3Dcopy-link"
```

```json
{
  "success": true,
  "valid": true,
  "resource_type": "track",
  "resource_id": "1kZvBIepQFlgUywAub2h56",
  "clean_url": "https://open.spotify.com/track/1kZvBIepQFlgUywAub2h56",
  "params": {
    "all": { "si": "cq52Cz8HRdGNhNB-P8EfiQ", "utm_source": "copy-link" },
    "tracking": [
      { "param": "si", "note": "Share Identifier - a random token Spotify generates when you tap \"Copy Link\". Analytics only; it does not affect the resource or its metadata, so it can be removed." },
      { "param": "utm_source", "note": "Where the link was shared from (copy-link, whatsapp, instagram...). A marketing/analytics tag; it can be removed." }
    ],
    "meaningful": [],
    "safe_to_remove": ["si", "utm_source"]
  },
  "summary": "This link carries 2 tracking parameter(s) (si, utm_source). Removing them and using https://open.spotify.com/track/1kZvBIepQFlgUywAub2h56 returns exactly the same metadata."
}
```

## The four Spotify behaviours this worker handles

Each of these was found by probing Spotify directly. Every one of them breaks a
naive scraper **silently** — you get HTTP 200 and no data, or a multi-second hang.

### 1. A browser User-Agent gets an empty app shell

Spotify serves its client-side SPA shell to things that look like real browsers.
That shell has **no `og:title`, no `music:*` tags and no `og:audio`**. Link-preview
crawlers get the fully pre-rendered SEO page instead.

| User-Agent | `og:title` | `music:duration` | `og:audio` |
| --- | --- | --- | --- |
| `Mozilla/5.0 … Chrome/125.0.0.0 Safari/537.36` | ❌ none | ❌ | ❌ |
| `facebookexternalhit/1.1` | ✅ | ✅ `102` | ✅ |
| `Twitterbot/1.0` | ✅ | ✅ | ✅ |
| `Googlebot/2.1` | ✅ | ✅ | ✅ |

Handled by `BOT_USER_AGENTS`, `looksLikeSeoPage()` detection, and automatic
retry with the next user agent if a shell comes back.

### 2. `/intl/<locale>/…` links return 404 to a fetch

```text
https://open.spotify.com/intl/es/track/<id>   ->  404
https://open.spotify.com/track/<id>?intl=es   ->  200
```

Browsers open the path form fine, but a server-side fetch of it fails. The locale
is parsed out of the path and re-sent as a query parameter, with a canonical-URL
fallback if that also fails.

### 3. oEmbed hangs for 5 seconds on `intl` URLs

```text
/oembed?url=…/intl/es/track/<id>   ->  HTTP 504 after 5.08s
/oembed?url=…/track/<id>           ->  HTTP 200 after 0.16s
```

oEmbed is always called with the canonical URL. This single fix took a request
from **5290 ms to 246 ms**.

### 4. Artwork size variants do not exist for every prefix

A Spotify image id is `prefix(8) + sizeCode(8) + hash(24)`, and the size codes
are **not interchangeable between prefixes**. Constructing the wrong one gives a
404. Verified with `curl -I`:

| Prefix | Type | `b273` 640px | `1e02` 300px | `4851` 64px | `e5eb` 750px | `f178` 160px |
| --- | --- | --- | --- | --- | --- | --- |
| `ab67616d` | album / track art | ✅ | ✅ | ✅ | — | — |
| `ab676161` | artist | ❌ 404 | ❌ 404 | ❌ 404 | ✅ | ✅ |
| `ab67706f` | playlist cover | ❌ 404 | ❌ 404 | ❌ 404 | — | — |

`VERIFIED_SIZE_CODES` emits only URLs that actually resolve. For an unknown
prefix the response contains `{ "url": … }` alone rather than invented dead links.

### Also worth knowing

- **A non-existent id returns HTTP 200 from the page**, not 404. oEmbed is the
  reliable not-found oracle — it 404s properly.
- **Album `og:title` is wrapped**: `"Listen to TURAN 2 - EP by ASTXR | Spotify"`.
  The JSON-LD `name` is the clean one (`"TURAN 2"`), so `bestTitle()` prefers it.

## Embed the player

Use the returned `embed_url` or `embed_html` in your own application, subject to
Spotify's applicable developer and brand guidelines:

```html
<iframe
  src="https://open.spotify.com/embed/track/1kZvBIepQFlgUywAub2h56"
  width="100%"
  height="152"
  loading="lazy"
  allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
  allowfullscreen>
</iframe>
```

Or point an iframe straight at `/api/embed?url=…&format=html`.

## Errors

```json
{ "success": false, "error": "Spotify has no track with id '0000000000000000000000'.", "code": "not_found" }
```

| Status | `code` | Meaning |
| --- | --- | --- |
| `200` | — | Metadata lookup succeeded |
| `400` | `invalid_input` | Not a Spotify URL, URI or id |
| `400` | `unsupported_type` | Resource type is not one of the six supported |
| `400` | `invalid_id` | Id is not 22 base62 characters |
| `400` | `missing_url` | No `url` parameter or body |
| `400` | `bad_json` | POST body was not valid JSON |
| `401` | `unauthorized` | An `API_KEY` secret is set and was not supplied |
| `404` | `not_found` | Spotify has no such resource |
| `405` | `method_not_allowed` | Use GET, POST or OPTIONS |
| `429` | `rate_limited` | Spotify throttled the upstream request — retry shortly |
| `502` | `upstream_error` | Spotify returned an unexpected status |
| `504` | `upstream_timeout` | Spotify did not respond in time |

A response containing `"degraded": true` means Spotify served only its app shell,
so you received oEmbed data (title and artwork) and nothing more. Retry — the
user-agent rotation usually resolves it.

## Deploy to Cloudflare Workers

### 1. Deploy with the dashboard (no terminal needed)

1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Create Worker**
2. Name it (for example `spotify-metadata-scraper`) → **Create**
3. Click **Quick edit**, delete the template code, **paste the entire contents of [`worker.js`](./worker.js)** → **Deploy**
4. Copy your new URL: `https://spotify-metadata-scraper.dinujayathishan06.workers.dev`

That is the whole deployment. There is nothing to install and nothing to build,
and `worker.js` is pure ASCII so the dashboard editor detects it as valid
JavaScript without complaint.

### 2. Deploy button / GitHub integration (Workers Builds)

Click **Deploy to Cloudflare Workers** at the top of this README, or connect the
repository yourself via **Workers & Pages → Create → Import from Git**. Cloudflare
clones the repo, installs dependencies, and runs `npx wrangler deploy`.

Remember to update the button's repository URL to your own before publishing. If
your repository is private the button cannot reach it — use the dashboard or
Wrangler instead.

This repository already contains the two files that build needs:

| File | Why it is required |
| --- | --- |
| `wrangler.toml` | Tells Wrangler **which file to upload** (`main = "worker.js"`), which Worker name to deploy to, and which `compatibility_date` to use |
| `package.json` | Pins `wrangler@^4` so the build does not install an outdated 3.x release |

Without `wrangler.toml` the build fails like this:

```text
Executing user deploy command: npx wrangler deploy

✘ [ERROR] Missing entry-point to Worker script or to assets directory

  If there is code to deploy, you can either:
  - Specify an entry-point to your Worker script via the command line
    (ex: `npx wrangler deploy src/index.ts`)
  - Or create a "wrangler.jsonc" file containing: …

Failed: error occurred while running deploy command
```

That error means Wrangler found no configuration and no positional argument, so
it does not know that `worker.js` is the Worker. Add the `wrangler.toml` from this
repository (or set the build command to `npx wrangler deploy worker.js`).

A second trap in the same build log: Cloudflare installed **wrangler 3.114.17**,
which is old. If `compatibility_date` is set to a date newer than that release's
runtime supports, the Worker fails to start instead of deploying. This repository
therefore pins `compatibility_date = "2025-01-01"`, which works on both wrangler
3.x and 4.x, and the Worker uses no feature that needs a newer date.

Both combinations are verified:

| wrangler | `deploy --dry-run` | runtime starts | scrape works |
| --- | --- | --- | --- |
| 3.114.17 (what Workers Builds installed) | ✅ 37.33 KiB / gzip 10.86 KiB | ✅ | ✅ 200 in 0.59 s |
| 4.86.0 | ✅ | ✅ | ✅ |

> Nothing else is needed. There is still no build step, no bundler config and no
> runtime dependency — `package.json` exists only so the CI build picks a modern
> Wrangler. If you deploy by pasting into the dashboard you can ignore both files.

### 3. Deploy with Wrangler

Node.js 18 or newer is enough; no `package.json` and no `npm install` are needed.

```bash
npx wrangler login
npx wrangler deploy
```

`wrangler.toml` already sets `main = "worker.js"`, `name` and a
`compatibility_date` that works on both Wrangler 3.x and 4.x, so no flags are
needed. To deploy without that file at all, pass everything on the command line:

```bash
npx wrangler deploy worker.js --name spotify-metadata-scraper --compatibility-date 2025-01-01
```

Run it locally first:

```bash
npx wrangler dev            # reads wrangler.toml, serves http://localhost:8787
```

```bash
curl "http://localhost:8785/health"
curl "http://localhost:8785/api/scrape?url=https%3A%2F%2Fopen.spotify.com%2Ftrack%2F1kZvBIepQFlgUywAub2h56"
```

> **⚠️ `compatibility_date` gotcha.** If the date is newer than the runtime your
> installed Wrangler ships with, the Worker **never starts at all** and every
> request fails with a connection error — which looks exactly like a broken
> scraper even though your code never ran:
>
> ```text
> ✘ [ERROR] This Worker requires compatibility date "2026-10-27", but the newest
>   date supported by this server binary is "2026-05-03".
> ✘ [ERROR] The Workers runtime failed to start.
> ```
>
> Fix either side — `npm install -D wrangler@latest`, or use a date your Wrangler
> supports. An older date always works. Deploying through the dashboard avoids
> this entirely, because Cloudflare picks the date for you.

### Optional: protect your deployment

**Dashboard → your Worker → Settings → Variables and Secrets → Add**, type
**Secret**, name it `API_KEY`, give it a value, and save. Clients must then send:

```bash
curl "https://spotify-metadata-scraper.dinujayathishan06.workers.dev/api/scrape?url=…" -H "x-api-key: YOUR_SECRET"
```

`Authorization: Bearer YOUR_SECRET` and `?key=YOUR_SECRET` also work. With no
secret set, the API is public. `/` and `/health` remain public either way.

Other settings live as constants at the top of `worker.js`: `PAGE_TTL` (6 h),
`RESPONSE_TTL` (1 h), `MAX_TRACKS` (25), `CORS_ORIGIN` (`*`), `CACHE_ON` (`true`).

## Testing

`node:test` and `node:assert` ship with Node itself, so the tests need no install:

```bash
node test.js
```

```text
# tests 27
# pass 27
# fail 0
```

Part 1 runs offline (routing, link parsing, CORS, error codes, and an assertion
that the source file stays pure ASCII). Part 2 makes real requests to public
Spotify pages, so it can fail if Spotify changes its markup or throttles you —
re-run before concluding that the worker is broken.

## Project structure

```text
spotify-metadata-scraper/
├── worker.js              the entire API - paste this into Cloudflare
├── wrangler.toml          entry point + compatibility date (needed for CLI/Git deploys)
├── package.json           pins wrangler@^4 for CI builds; adds npm scripts
├── .gitignore
├── test.js                25 tests, run with `node test.js`
├── example-response.json  a real captured response
├── README.md
└── LICENSE
```

The Worker itself has **no runtime dependencies, no build step and no bindings**.
`wrangler.toml` and `package.json` exist purely so that `wrangler deploy` and
Cloudflare's Git-integrated builds know what to upload and which Wrangler to use —
if you paste `worker.js` into the dashboard you never need them.

`npm install` is only ever needed to get Wrangler locally; `node test.js` works
without it.

## Limitations

These fields are **not present in Spotify's public HTML**, so a keyless scraper
cannot supply them:

| Returned | Not available without the official Web API |
| --- | --- |
| title, description, artwork (+ verified sizes) | `isrc` |
| artists with monthly listener counts | `popularity` |
| album, track number, release date | `explicit` |
| duration (seconds / ms / `m:ss`) | `genres` |
| 30-second preview URL (`og:audio`) | search (results are rendered client-side) |
| embed URL, dimensions and iframe HTML | full-track audio (**DRM is never bypassed**) |
| album / playlist tracklists (up to 30) | playlists longer than 30 tracks |
| availability by country (`available_in`) | lyrics (login or Premium only) |

`isrc`, `popularity` and `explicit` are returned as explicit `null`s so client
code stays stable, and so a fork can fill them in later by adding
`SPOTIFY_CLIENT_ID` / `SPOTIFY_CLIENT_SECRET` without changing the response shape.

If you need those fields, or you are building something commercial, use the
[official Spotify Web API](https://developer.spotify.com/documentation/web-api) —
it is free, stable, and the intended route.

## Disclaimer

This is an independent, unofficial project and is not affiliated with,
authorized by, endorsed by, or sponsored by Spotify AB or any third-party
service. Spotify names, marks, artwork, audio, and other content belong to their
respective rights holders. This API provides public metadata and links to
Spotify's own embed player; it does not own, license, host, or provide downloads
of Spotify audio. No DRM, paywall, or access control is bypassed.

Use this software in compliance with applicable laws, Spotify's terms and
policies, and the terms of all upstream services. Do not use it to infringe
copyright or other rights. You are responsible for how you use the software and
any returned metadata or links. The software is provided "as is," without
warranties; the maintainers are not responsible for misuse, service
interruptions, or claims arising from use. This notice is informational and is
not legal advice.

If you deploy this publicly, please leave caching enabled (it is on by default)
so you are not hammering Spotify on other people's behalf.

## Author

**Thishan Dinujaya**

## License

MIT License (c) Thishan Dinujaya. See [`LICENSE`](./LICENSE).
