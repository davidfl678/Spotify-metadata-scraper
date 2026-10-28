/**
 * test.js - zero-dependency test runner.
 *
 * Run it with plain Node, no npm install required:
 *
 *     node test.js
 *
 * `node:test` and `node:assert` ship with Node itself (18+), and the worker
 * has no runtime dependencies - which is why the whole project can also be
 * pasted straight into the Cloudflare dashboard.
 *
 * Two parts:
 *   PART 1 - offline unit tests (no network)
 *   PART 2 - live tests (real requests to public Spotify pages)
 *
 * MIT License (c) Thishan Dinujaya
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from './worker.js';

const ID = '1kZvBIepQFlgUywAub2h56';
const SHARE = `https://open.spotify.com/track/${ID}?si=cq52Cz8HRdGNhNB-P8EfiQ&utm_source=copy-link`;

/** Send a request through the worker and parse the JSON response. */
async function call(path, method = 'GET') {
  const res = await worker.fetch(new Request('https://spotify-api.local' + path, { method }), {}, {});
  const text = await res.text();
  let body;
  try { body = JSON.parse(text); } catch { body = { _raw: text.slice(0, 300) }; }
  return { status: res.status, body, res };
}

/* =============== PART 1 - offline (no network needed) =============== */

test('/ returns a JSON API index with absolute URLs and examples', async () => {
  const { status, body, res } = await call('/');
  assert.equal(status, 200);
  assert.equal(res.headers.get('content-type'), 'application/json; charset=utf-8');
  assert.equal(body.requires_api_key, false);
  assert.equal(body.base_url, 'https://spotify-api.local');
  assert.equal(body.license, 'MIT (c) Thishan Dinujaya');

  /* Endpoints are a structured list, each with its own absolute URL + example. */
  assert.ok(Array.isArray(body.endpoints), 'endpoints is an array');
  assert.ok(body.endpoints.length >= 5, 'at least 5 documented endpoints');
  for (const e of body.endpoints) {
    assert.ok(e.name && e.path && e.url, `endpoint ${e.name} has name/path/url`);
    assert.ok(e.url.startsWith('https://spotify-api.local/'), `${e.name} url is absolute: ${e.url}`);
    assert.ok(e.example?.startsWith('https://'), `${e.name} example is an absolute URL: ${e.example}`);
    assert.ok(e.description, `${e.name} has a description`);
  }
  const scrape = body.endpoints.find((e) => e.name === 'scrape');
  assert.ok(scrape.example.includes('url=https%3A%2F%2Fopen.spotify.com'), 'scrape example carries an encoded Spotify link');
  assert.ok(scrape.curl.startsWith('curl "http'), 'scrape ships a copy-paste curl command');
  assert.ok(scrape.options.length >= 4, 'query options documented');
  for (const o of scrape.options) assert.ok(o.example.startsWith('https://'), `option ${o.param} has an example URL`);

  /* "try_these" is a ready-to-click list. */
  assert.ok(body.try_these.length >= 6);
  for (const t of body.try_these) {
    assert.ok(t.label && t.url.startsWith('https://spotify-api.local/'), `try_these entry is absolute: ${t.label}`);
  }

  assert.deepEqual(body.supported_types, ['track', 'album', 'playlist', 'artist', 'episode', 'show']);
  assert.ok(body.accepted_inputs.some((s) => s.includes('spotify.link')), 'short links documented');
  assert.ok(body.response_shape.preview_url, 'response fields documented');
});

test('/ is pretty-printed so it is readable in a browser', async () => {
  const res = await worker.fetch(new Request('https://spotify-api.local/'), {}, {});
  const text = await res.text();
  assert.ok(text.includes('\n  "name"'), 'indented JSON');
});

test('/health reports the base URL and stays public', async () => {
  const { status, body } = await call('/health');
  assert.equal(status, 200);
  assert.equal(body.base_url, 'https://spotify-api.local');
  assert.equal(body.auth, 'public');
});

test('/health reports a public deployment with no API key', async () => {
  const { status, body } = await call('/health');
  assert.equal(status, 200);
  assert.equal(body.auth, 'public');
  assert.equal(body.requires_api_key, false);
  assert.equal(body.supported_types.length, 6);
});

test('CORS preflight answers 204 with permissive headers', async () => {
  const { status, res } = await call('/api/scrape', 'OPTIONS');
  assert.equal(status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.match(res.headers.get('access-control-allow-methods'), /POST/);
});

test('unsupported method returns 405', async () => {
  const { status, body } = await call('/api/scrape', 'PUT');
  assert.equal(status, 405);
  assert.equal(body.code, 'method_not_allowed');
});

test('missing url parameter returns 400 with an example', async () => {
  const { status, body } = await call('/api/scrape');
  assert.equal(status, 400);
  assert.equal(body.code, 'missing_url');
  assert.ok(body.example.includes('/api/scrape?url='));
});

test('non-Spotify host is rejected with 400', async () => {
  const { status, body } = await call('/api/scrape?url=' + encodeURIComponent('https://evil.example/track/' + ID));
  assert.equal(status, 400);
  assert.equal(body.success, false);
});

test('unknown route returns 404 JSON with hints', async () => {
  const { status, body } = await call('/api/nope');
  assert.equal(status, 404);
  assert.ok(Array.isArray(body.try));
});

test('/api/parse explains si and utm_source (offline)', async () => {
  const { status, body } = await call('/api/parse?url=' + encodeURIComponent(SHARE));
  assert.equal(status, 200);
  assert.equal(body.valid, true);
  assert.equal(body.resource_type, 'track');
  assert.equal(body.resource_id, ID);
  assert.equal(body.clean_url, `https://open.spotify.com/track/${ID}`);
  assert.deepEqual(body.params.safe_to_remove, ['si', 'utm_source']);
  assert.match(body.params.tracking[0].note, /Share Identifier/);
  assert.match(body.summary, /2 tracking parameter/);
  assert.match(body.summary, /exactly the same metadata/);
});

test('/api/parse reads intl from the path and treats it as functional', async () => {
  const { body } = await call('/api/parse?url=' + encodeURIComponent(`https://open.spotify.com/intl/es/track/${ID}?si=x&intl=es`));
  assert.equal(body.locale, 'es');
  assert.ok(body.params.meaningful.some((p) => p.param === 'intl'));
  assert.ok(!body.params.safe_to_remove.includes('intl'), 'intl must not be stripped');
});

test('/api/parse flags spotify.link short links for redirect resolution', async () => {
  const { body } = await call('/api/parse?url=' + encodeURIComponent('https://spotify.link/AbCdEf'));
  assert.equal(body.valid, false);
  assert.equal(body.needs_redirect_resolution, true);
});

test('worker source is pure ASCII (safe to paste in the dashboard editor)', async () => {
  const res = await import('node:fs/promises');
  const src = await res.readFile(new URL('./worker.js', import.meta.url), 'utf8');
  const nonAscii = [...src].filter((ch) => ch.charCodeAt(0) > 127);
  assert.deepEqual(nonAscii, [], `found non-ASCII characters: ${JSON.stringify([...new Set(nonAscii)])}`);
});

/* ================== PART 2 - live (real Spotify) ================== */

test('share link with ?si= and utm_source returns full metadata', async () => {
  const { status, body } = await call('/api/scrape?url=' + encodeURIComponent(SHARE));
  assert.equal(status, 200);
  assert.equal(body.success, true);
  assert.equal(body.resource_type, 'track');
  assert.equal(body.resource_id, ID);
  assert.equal(body.title, 'TURAN 2 - Slowed');
  assert.ok(body.thumbnail, 'thumbnail present');
  assert.ok(body.embed_url, 'embed_url present');
  assert.match(body.embed_html, /<iframe/, 'embed_html present');
  assert.match(body.preview_url, /^https:\/\/p\.scdn\.co\/mp3-preview\//, 'free 30s preview MP3');
  assert.equal(body.metadata.duration.seconds, 102);
  assert.equal(body.metadata.duration.formatted, '1:42');
  assert.equal(body.metadata.album.id, '4ntJgEVBlc3K4SWfKCQ7PS');
  assert.equal(body.metadata.album.track_number, 2);
  assert.ok(body.metadata.release_date, 'release_date present');
  assert.ok(body.metadata.available_in.length > 50, 'available_in countries');
  assert.ok(body.metadata.artists.some((a) => a.name), 'artist names filled in');
  assert.ok(body.metadata.artists.some((a) => a.monthly_listeners > 0), 'monthly listeners parsed');
  assert.ok(body.metadata.images.small, 'verified image size variants');
  assert.equal(body.requires_api_key, false);
  assert.match(body.scraped_with, /facebookexternalhit|twitterbot|googlebot/i, 'R1: a crawler UA was used');
  assert.equal(body.engine, 'Spotify oEmbed + public page metadata');
  assert.equal(body.degraded, undefined, 'not degraded');
});

test('R2: an /intl/es/ path link still works (path 404s, query form 200s)', async () => {
  const { status, body } = await call('/api/scrape?url=' + encodeURIComponent(`https://open.spotify.com/intl/es/track/${ID}`));
  assert.equal(status, 200);
  assert.equal(body.locale, 'es');
  assert.equal(body.locale_applied, true);
  assert.equal(body.title, 'TURAN 2 - Slowed');
  assert.ok(body.preview_url, 'preview survives the intl path');
  assert.match(body.engine, /oEmbed/, 'R4: oEmbed called with the canonical URL, so no 504');
  assert.equal(body.degraded, undefined);
});

test('album returns a clean JSON-LD title plus a tracklist', async () => {
  const { status, body } = await call('/api/scrape?url=https://open.spotify.com/album/4ntJgEVBlc3K4SWfKCQ7PS&light=1');
  assert.equal(status, 200);
  assert.equal(body.resource_type, 'album');
  assert.equal(body.title, 'TURAN 2', 'not "Listen to TURAN 2 - EP by ASTXR | Spotify"');
  assert.equal(body.metadata.album_type, 'ep');
  assert.equal(body.metadata.total_tracks, 6);
  assert.equal(body.metadata.tracks.length, 6);
  assert.equal(body.metadata.tracks[1].id, ID, 'track order preserved');
  assert.equal(body.metadata.tracks[0].position, 1);
});

test('artist returns parsed monthly listeners and correct image sizes', async () => {
  const { status, body } = await call('/api/artist/0rBrjQPcLqHj1Jk8Jvw7Xj');
  assert.equal(status, 200);
  assert.equal(body.resource_type, 'artist');
  assert.equal(body.title, 'ASTXR');
  assert.ok(body.metadata.monthly_listeners > 10000, 'monthly_listeners parsed');
  assert.equal(body.metadata.monthly_listeners_text, '933.2K');
  /* Artist artwork uses prefix ab676161: e5eb=750 and f178=160 exist, 300px does not. */
  assert.equal(body.metadata.images.prefix, 'ab676161');
  assert.match(body.metadata.images.large, /0000e5eb/);
  assert.match(body.metadata.images.small, /0000f178/);
  assert.equal(body.metadata.images.medium, undefined, 'no 300px variant for artists (it would 404)');
});

test('playlist with ?tracks=1 expands tracks including previews', async () => {
  const { status, body } = await call('/api/scrape?url=https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M&tracks=1&limit=3&light=1');
  assert.equal(status, 200);
  assert.equal(body.resource_type, 'playlist');
  assert.equal(body.metadata.tracks.length, 30, "Spotify's HTML exposes 30");
  assert.equal(body.metadata.tracks_detail.length, 3, 'limit respected');
  assert.ok(body.metadata.tracks_detail[0].title, 'track title');
  assert.ok(body.metadata.tracks_detail[0].preview_url, 'track preview');
  assert.ok(body.metadata.tracks_detail[0].duration.formatted, 'track duration');
  assert.ok(body.metadata.tracks_detail[0].artists_text, 'track artists');
});

test('spotify: URIs and bare id shortcut routes both work', async () => {
  const a = await call('/api/scrape?url=' + encodeURIComponent(`spotify:track:${ID}`));
  assert.equal(a.status, 200);
  assert.equal(a.body.title, 'TURAN 2 - Slowed');

  const b = await call(`/api/track/${ID}?light=1`);
  assert.equal(b.status, 200);
  assert.equal(b.body.resource_id, ID);
  assert.equal(b.body.resource_type, 'track');
});

test('R3: a non-existent id returns 404 even though the page returns 200', async () => {
  const { status, body } = await call('/api/scrape?url=https://open.spotify.com/track/0000000000000000000000');
  assert.equal(status, 404);
  assert.equal(body.success, false);
  assert.equal(body.code, 'not_found');
});

test('/api/embed?format=html returns a paste-ready iframe page', async () => {
  const res = await worker.fetch(
    new Request(`https://spotify-api.local/api/embed?url=${encodeURIComponent(`https://open.spotify.com/track/${ID}`)}&format=html`),
    {}, {}
  );
  const text = await res.text();
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/html/);
  assert.match(text, /<iframe/);
  assert.match(text, new RegExp('open\\.spotify\\.com/embed/track/' + ID));
});

test('?raw=1 exposes every scraped meta tag', async () => {
  const { status, body } = await call(`/api/track/${ID}?raw=1&light=1`);
  assert.equal(status, 200);
  assert.ok(body.raw_meta['og:title'], 'raw og:title');
  assert.ok(body.raw_meta['music:duration'], 'raw music:duration');
  assert.ok(body.raw_meta['og:audio'], 'raw og:audio');
});

test('repeat requests are served stably and carry an x-cache header', async () => {
  const p = `/api/track/${ID}?light=1`;
  await call(p);
  const second = await call(p);
  assert.equal(second.status, 200);
  assert.equal(second.body.title, 'TURAN 2 - Slowed');
  /* Node has no Cache API, so this is always MISS here; on Workers it flips to HIT. */
  assert.ok(['HIT', 'MISS'].includes(second.res.headers.get('x-cache')));
});

test('POST with a JSON body works', async () => {
  const res = await worker.fetch(
    new Request('https://spotify-api.local/api/scrape', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: `https://open.spotify.com/track/${ID}` }),
    }),
    {}, {}
  );
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.title, 'TURAN 2 - Slowed');
});

test('POST with invalid JSON returns 400 bad_json', async () => {
  const res = await worker.fetch(
    new Request('https://spotify-api.local/api/scrape', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{oops',
    }),
    {}, {}
  );
  const body = await res.json();
  assert.equal(res.status, 400);
  assert.equal(body.code, 'bad_json');
});

test('POST with a plain-text body works', async () => {
  const res = await worker.fetch(
    new Request('https://spotify-api.local/api/scrape', {
      method: 'POST',
      body: `https://open.spotify.com/track/${ID}`,
    }),
    {}, {}
  );
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.resource_id, ID);
});

test('the optional API_KEY secret is enforced when set', async () => {
  const env = { API_KEY: 'sekret123' };

  const denied = await worker.fetch(new Request(`https://x/api/track/${ID}?light=1`), env, {});
  assert.equal(denied.status, 401);
  assert.equal((await denied.json()).code, 'unauthorized');

  const allowed = await worker.fetch(
    new Request(`https://x/api/track/${ID}?light=1`, { headers: { 'x-api-key': 'sekret123' } }),
    env, {}
  );
  assert.equal(allowed.status, 200);

  const bearer = await worker.fetch(
    new Request(`https://x/api/track/${ID}?light=1`, { headers: { authorization: 'Bearer sekret123' } }),
    env, {}
  );
  assert.equal(bearer.status, 200);

  /* '/' and '/health' stay public so uptime monitors keep working. */
  const health = await worker.fetch(new Request('https://x/health'), env, {});
  assert.equal(health.status, 200);
  assert.equal((await health.json()).auth, 'api_key');

  const index = await worker.fetch(new Request('https://x/'), env, {});
  assert.equal(index.status, 200);
});
