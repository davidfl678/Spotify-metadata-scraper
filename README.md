<div align="center">

# Spotify Scraper API

**A small serverless API for public Spotify metadata and embeddable player links.**

[![Cloudflare Workers](https://img.shields.io/badge/Runtime-Cloudflare%20Workers-F38020?style=for-the-badge)](https://workers.cloudflare.com/)
[![JavaScript](https://img.shields.io/badge/Language-JavaScript-F7DF1E?style=for-the-badge)](https://developer.mozilla.org/en-US/docs/Web/JavaScript)
[![License: MIT](https://img.shields.io/badge/License-MIT-2ea44f?style=for-the-badge)](./LICENSE)
[![API only](https://img.shields.io/badge/Product-API%20only-5965f2?style=for-the-badge)](#endpoints)

### Tracks · Albums · Playlists · Artists · Shows · Episodes

[Features](#features) · [Quick start](#quick-start) · [Endpoints](#endpoints) · [Deploy](#deploy-to-cloudflare-workers) · [Disclaimer](#disclaimer)

<br />

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/davidfl678/spotify-scraper-api)

</div>

---

> **Project status:** Testing in progress. Update the deployment button URL if this repository is published under a different GitHub account or repository name.

An API-only Cloudflare Worker that reads metadata from public Spotify resource pages and Spotify's oEmbed endpoint. It returns titles, descriptions, artwork, resource types, and embeddable player URLs.

> **No music ripping or DRM circumvention:** Spotify's full tracks are not returned or downloadable through this API. Spotify audio is licensed and protected; this project only provides public metadata and links to Spotify's own embedded player. A preview URL is returned only if an upstream source explicitly makes one available; the current implementation returns `null` rather than inventing or bypassing access.

## Features

- Metadata lookup for public Spotify tracks, albums, playlists, artists, shows, and episodes
- Spotify oEmbed lookup with public page metadata as a fallback
- Title, description, artwork thumbnail, canonical page URL, resource type and ID
- Spotify embed URL and suggested embed dimensions
- GET and POST request support
- Cloudflare Workers runtime; standard Fetch APIs and no browser binaries
- No API keys required for the current implementation
- MIT licensed

Third-party services and public pages can change their behavior or apply rate limits. No uptime guarantee is provided for upstream services.

## Quick start

```bash
curl "https://YOUR-WORKER.workers.dev/api/scrape?url=https%3A%2F%2Fopen.spotify.com%2Ftrack%2F4iV5W9uYEdYUVa79Axb7Rh"
```

The example resource is a public Spotify track used to demonstrate metadata lookup; availability may vary by region and over time.

## Endpoints

### `GET /` or `GET /health`

Returns API status and available routes.

```bash
curl "https://YOUR-WORKER.workers.dev/health"
```

### `GET /api/scrape?url={spotify_url}`

Accepts a public Spotify resource link in this form:

```text
https://open.spotify.com/{type}/{id}
```

Supported resource types: `track`, `album`, `playlist`, `artist`, `show`, and `episode`.

```bash
curl "https://YOUR-WORKER.workers.dev/api/scrape?url=https%3A%2F%2Fopen.spotify.com%2Ftrack%2F4iV5W9uYEdYUVa79Axb7Rh"
```

### `POST /api/scrape`

```bash
curl -X POST "https://YOUR-WORKER.workers.dev/api/scrape" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh"}'
```

### `GET /api/embed?url={spotify_url}`

Returns the same metadata response, including `embed_url`, for use by clients that only need the Spotify player link.

### Example response

```json
{
  "success": true,
  "platform": "spotify",
  "resource_type": "track",
  "resource_id": "4iV5W9uYEdYUVa79Axb7Rh",
  "url": "https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh",
  "title": "Prelude for Piano No. 11 in F-Sharp Minor",
  "description": "Artist and release information when supplied by the public page",
  "thumbnail": "https://image-cdn-fa.spotifycdn.com/image/...",
  "embed_url": "https://open.spotify.com/embed/track/4iV5W9uYEdYUVa79Axb7Rh?utm_source=oembed",
  "embed_width": 456,
  "embed_height": 152,
  "page_url": "https://open.spotify.com/track/4iV5W9uYEdYUVa79Axb7Rh",
  "content_type": "music.song",
  "preview_url": null,
  "audio_download_url": null,
  "engine": "Spotify oEmbed + public page metadata",
  "note": "This API returns public metadata and Spotify embed links only. It does not provide full-track downloads or bypass DRM."
}
```

Some fields may be `null` when Spotify does not expose them for the requested resource. The API does not return track files or bypass Spotify playback restrictions.

## Embed the player

Use the returned `embed_url` in an iframe in your own application, subject to Spotify's applicable developer and brand guidelines:

```html
<iframe
  src="https://open.spotify.com/embed/track/4iV5W9uYEdYUVa79Axb7Rh"
  width="100%"
  height="152"
  loading="lazy"
  allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
  allowfullscreen>
</iframe>
```

## Errors

```json
{
  "success": false,
  "error": "The link must point to a Spotify track, album, playlist, episode, show, or artist."
}
```

| Status | Meaning |
| --- | --- |
| `200` | Metadata lookup succeeded |
| `400` | Invalid or unsupported Spotify URL |
| `404` | Route not found |
| `405` | HTTP method not supported |
| `502` | Spotify metadata services could not be reached |

## Deploy to Cloudflare Workers

### Deploy button

Click **Deploy to Cloudflare Workers** at the top of this README, sign in to Cloudflare, review the Worker settings, and confirm deployment. Cloudflare will show the production Worker URL after deployment. If the GitHub repository is private, the deploy button may not be able to access it; use Wrangler below instead.

### Deploy with Wrangler

1. Install Node.js and npm.
2. Clone the repository and enter its folder:

   ```bash
   git clone https://github.com/davidfl678/spotify-scraper-api.git
   cd spotify-scraper-api
   ```

3. Install dependencies:

   ```bash
   npm install
   ```

4. Sign in to Cloudflare:

   ```bash
   npx wrangler login
   ```

   Complete the browser authorization for the Cloudflare account that will own the Worker.

5. Run it locally:

   ```bash
   npm run dev
   ```

   Wrangler starts a local server at port `8785`. Test its health route and a public item:

   ```bash
   curl "http://localhost:8785/health"
   curl "http://localhost:8785/api/scrape?url=https%3A%2F%2Fopen.spotify.com%2Ftrack%2F4iV5W9uYEdYUVa79Axb7Rh"
   ```

6. Deploy:

   ```bash
   npm run deploy
   ```

7. Copy the production `workers.dev` URL from **Cloudflare Dashboard → Workers & Pages → your Worker**, then use it in the examples above.

No API credentials or secrets are required by the default configuration.

## Project structure

```text
spotify-scraper-api/
├── src/
│   └── index.js
├── LICENSE
├── package.json
├── README.md
└── wrangler.toml
```

## Disclaimer

This is an independent, unofficial project and is not affiliated with, authorized by, endorsed by, or sponsored by Spotify AB or any third-party service. Spotify names, marks, artwork, audio, and other content belong to their respective rights holders. This API provides public metadata and links to Spotify's own embed player; it does not own, license, host, or provide downloads of Spotify audio. No DRM, paywall, or access control is bypassed.

Use this software in compliance with applicable laws, Spotify's terms and policies, and the terms of all upstream services. Do not use it to infringe copyright or other rights. You are responsible for how you use the software and any returned metadata or links. The software is provided “as is,” without warranties; the maintainers are not responsible for misuse, service interruptions, or claims arising from use. This notice is informational and is not legal advice.

## License

MIT License. See [`LICENSE`](./LICENSE).
