const PAGE_TTL = 21600;
const RESPONSE_TTL = 3600;
const MAX_TRACKS = 25;
const CORS_ORIGIN = '*';
const CACHE_ON = true;

const BOT_USER_AGENTS = [
  'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)',
  'Twitterbot/1.0',
  'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
];

const RESOURCE_TYPES = new Set(['track', 'album', 'playlist', 'artist', 'episode', 'show']);
const ID_RE = /^[0-9A-Za-z]{22}$/;
const VERSION = '2.3.0';

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0',
  ndash: '\u2013', mdash: '\u2014', hellip: '\u2026', middot: '\u00b7',
  rsquo: '\u2019', lsquo: '\u2018', rdquo: '\u201d', ldquo: '\u201c',
};

function decodeHtml(value = '') {
  return String(value)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => codePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => codePoint(parseInt(d, 10)))
    .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, n) => ENTITIES[n.toLowerCase()] ?? m);
}

function codePoint(n) {
  if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) return '';
  try { return String.fromCodePoint(n); } catch { return ''; }
}

function extractMetas(html) {
  const out = new Map();
  if (typeof html !== 'string') return out;
  for (const tag of html.match(/<meta\b[^>]*>/gi) || []) {
    const k = tag.match(/\b(?:name|property|http-equiv)\s*=\s*("([^"]*)"|'([^']*)')/i);
    const v = tag.match(/\bcontent\s*=\s*("([^"]*)"|'([^']*)')/i);
    if (!k || !v) continue;
    const key = decodeHtml(k[2] ?? k[3] ?? '').trim().toLowerCase();
    if (!key) continue;
    const value = decodeHtml(v[2] ?? v[3] ?? '');
    const list = out.get(key);
    if (list) list.push(value); else out.set(key, [value]);
  }
  return out;
}

const metaOne = (m, k) => m.get(String(k).toLowerCase())?.[0] ?? null;
const metaAll = (m, k) => m.get(String(k).toLowerCase()) ?? [];

function extractJsonLd(html) {
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    try { const p = JSON.parse(m[1].trim()); if (p && typeof p === 'object') return p; } catch {  }
  }
  return null;
}

function bestTitle(metas, ld, html) {
  const fromLd = typeof ld?.name === 'string' ? ld.name.trim() : '';
  if (fromLd) return fromLd;
  const og = metaOne(metas, 'og:title');
  if (og) {
    return String(og)
      .replace(/\s*[|\u2013\u2014-]\s*(Spotify|spotify\.com)\s*$/i, '')
      .replace(/^Listen to\s+(.+?)\s+on Spotify.*$/i, '$1')
      .replace(/^Listen to\s+(.+?)\s+by\s+.+$/i, '$1')
      .trim();
  }
  const t = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return t ? decodeHtml(t[1]).replace(/\s*[|-]\s*Spotify.*$/i, '').trim() : null;
}

function formatDuration(total) {
  const s = Math.max(0, Math.floor(Number(total) || 0));
  const pad = (n) => String(n).padStart(2, '0');
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

function parseCount(text) {
  if (text == null) return null;
  const m = String(text).match(/([\d.,]+)\s*([KMB])?/i);
  if (!m) return null;
  const n = parseFloat(m[1].replace(/,/g, ''));
  if (!Number.isFinite(n)) return null;
  return Math.round(n * ({ k: 1e3, m: 1e6, b: 1e9 }[(m[2] || '').toLowerCase()] || 1));
}

const splitDescription = (d) =>
  d ? String(d).split(/\s*[\u00b7\u2022]\s*/).map((s) => s.trim()).filter(Boolean) : [];

const VERIFIED_SIZE_CODES = {
  ab67616d: { large: '0000b273', medium: '00001e02', small: '00004851' },
  ab676161: { large: '0000e5eb', small: '0000f178' },
};
const IMAGE_URL_RE =
  /^(https:\/\/[^/]*(?:i\.scdn\.co|spotifycdn\.com)\/(?:cdn\/)?image\/)(ab[0-9a-f]{6})(0000[0-9a-f]{4})([0-9a-f]{24})$/i;

function imageSizes(url) {
  if (!url || typeof url !== 'string') return null;
  const out = { url };
  const m = url.trim().match(IMAGE_URL_RE);
  if (!m) return out;
  const [, base, prefix, sizeCode, hash] = m;
  out.prefix = prefix.toLowerCase();
  out.size_code = sizeCode.toLowerCase();
  const sizes = VERIFIED_SIZE_CODES[out.prefix];
  if (!sizes) return out;
  for (const [name, code] of Object.entries(sizes)) out[name] = `${base}${prefix}${code}${hash}`;
  return out;
}

const pageUrl = (type, id, locale) =>
  locale ? `https://open.spotify.com/intl/${locale}/${type}/${id}` : `https://open.spotify.com/${type}/${id}`;
const embedUrl = (type, id) => `https://open.spotify.com/embed/${type}/${id}`;
const spotifyUri = (type, id) => `spotify:${type}:${id}`;

const PARAM_NOTES = {
  si: 'Share Identifier - a random token Spotify generates when you tap "Copy Link". Analytics only; it does not affect the resource or its metadata, so it can be removed.',
  utm_source: 'Where the link was shared from (copy-link, whatsapp, instagram...). A marketing/analytics tag; it can be removed.',
  utm_medium: 'How it was shared (share, story, post...). Analytics; it can be removed.',
  utm_campaign: 'Campaign name. Analytics; it can be removed.',
  utm_term: 'Analytics; it can be removed.',
  utm_content: 'Analytics; it can be removed.',
  context: 'The in-app context the track was played from (for example which playlist). Analytics; it can be removed.',
  nd: 'Share destination (1 = Instagram Stories and similar). Analytics; it can be removed.',
  sp_cid: 'Share context id. Analytics; it can be removed.',
  referrer: 'Analytics; it can be removed.',
  intl: 'Locale override (for example intl=es). This one is functional: it can change the metadata returned, so keep it.',
  go: 'When set to 1 the link starts playback as soon as it is opened. Functional; keep it.',
  autoplay: 'When set to 1 the embedded player autoplays. Functional; keep it.',
};
const TRACKING_PARAMS = new Set(['si', 'context', 'nd', 'referrer', 'sp_cid']);

function parseSpotifyLink(input) {
  const raw = String(input || '').trim();
  if (!raw) return null;

  if (ID_RE.test(raw)) return { type: null, id: raw, locale: null, params: {}, raw };

  const u = raw.match(/^spotify:([a-z]+):([0-9A-Za-z]{22})$/i);
  if (u && RESOURCE_TYPES.has(u[1].toLowerCase())) {
    return { type: u[1].toLowerCase(), id: u[2], locale: null, params: {}, raw };
  }

  let url;
  try { url = new URL(raw); } catch { return null; }
  if (!/^https?:$/.test(url.protocol)) return null;

  const host = url.hostname.replace(/^www\./, '').toLowerCase();
  const params = Object.fromEntries(url.searchParams);

  if (host === 'spotify.link') {
    return { type: null, id: null, locale: null, params, raw, host, shortLink: url.href, needsRedirectResolution: true };
  }

  const isSpotify = ['open.spotify.com', 'play.spotify.com', 'spotify.com'].includes(host) || host.endsWith('.spotify.com');
  if (!isSpotify) return { type: null, id: null, locale: null, params, raw, host, unsupportedHost: host };

  let parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent);
  if (parts[0] === 'embed' || parts[0] === 'embed-v1') parts = parts.slice(1);

  let locale = null;
  if (parts[0] === 'intl' && parts[1] && /^[a-z]{2}(-[A-Za-z0-9]{2,})?$/i.test(parts[1])) {
    locale = parts[1].toLowerCase();
    parts = parts.slice(2);
  }

  const type = parts[0]?.toLowerCase() ?? null;
  const id = parts[1] ?? null;
  return { type, id, locale, params, raw, host };
}

class ScrapeError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    Object.assign(this, extra);
  }
}

const NOOP_CACHE = { match: async () => undefined, put: async () => {} };

async function openCache(name = 'spotify-scraper-v1') {
  try {
    if (!CACHE_ON || typeof caches === 'undefined' || !caches?.default) return NOOP_CACHE;
    return await caches.open(name);
  } catch { return NOOP_CACHE; }
}

async function cachedFetch(ctx, { key, url, headers, ttl, timeout = 15000 }) {
  const cache = await openCache();
  const hit = await cache.match(key).catch(() => undefined);
  if (hit) return { body: await hit.text(), status: 200, cached: true, url };

  const res = await fetch(url, {
    headers,
    redirect: 'follow',
    cf: { cacheTtl: ttl, cacheEverything: true },
    signal: AbortSignal.timeout(timeout),
  });
  const body = (await res.text()).slice(0, 3_000_000);

  if (res.ok && body) {
    const entry = new Response(body, {
      status: 200,
      headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': `max-age=${ttl}` },
    });
    const p = cache.put(key, entry).catch(() => {});
    if (ctx?.waitUntil) ctx.waitUntil(p); else await p;
  }
  return { body, status: res.status, cached: false, url: res.url || url };
}

async function normalizeInput(input) {
  let parsed = parseSpotifyLink(input);
  if (!parsed) {
    throw new ScrapeError(400, 'Provide a valid Spotify URL, a spotify: URI, or a link containing a 22-character Spotify id.', { code: 'invalid_input' });
  }

  if (parsed.needsRedirectResolution) {
    let resolved;
    try {
      const r = await fetch(parsed.shortLink, {
        headers: { 'user-agent': BOT_USER_AGENTS[0] },
        redirect: 'follow',
        signal: AbortSignal.timeout(10000),
      });
      resolved = r.url;
    } catch (e) {
      throw new ScrapeError(502, `Could not resolve the spotify.link short URL: ${e.message}`, { code: 'shortlink_failed' });
    }
    const again = parseSpotifyLink(resolved);
    if (!again?.type || !again?.id) {
      throw new ScrapeError(400, 'The short link did not resolve to a Spotify resource page.', { code: 'shortlink_unresolved', resolved });
    }
    parsed = { ...again, resolvedFrom: parsed.shortLink };
  }

  if (!parsed.type && parsed.id) {
    throw new ScrapeError(400, 'A bare id was supplied but the resource type is unknown - send a full link such as https://open.spotify.com/track/<id>.', { code: 'type_required', id: parsed.id });
  }
  if (!RESOURCE_TYPES.has(parsed.type)) {
    throw new ScrapeError(400, `Unsupported Spotify resource type: '${parsed.type}'. Supported: ${[...RESOURCE_TYPES].join(', ')}.`, { code: 'unsupported_type' });
  }
  if (!ID_RE.test(parsed.id || '')) {
    throw new ScrapeError(400, `That does not look like a Spotify id (22 characters expected): '${parsed.id}'.`, { code: 'invalid_id' });
  }

  return {
    type: parsed.type,
    id: parsed.id,
    locale: parsed.locale || null,
    url: pageUrl(parsed.type, parsed.id, parsed.locale),
    resolvedFrom: parsed.resolvedFrom || null,
  };
}

const fetchUrlFor = (r) =>
  r.locale ? `${pageUrl(r.type, r.id)}?intl=${encodeURIComponent(r.locale)}` : pageUrl(r.type, r.id);

function looksLikeSeoPage(html) {
  if (typeof html !== 'string' || html.length < 500) return false;
  if (/<title[^>]*>\s*Spotify\s*[\u2013-]\s*Web Player/i.test(html)) return false;
  return /property=["']og:title["']/.test(html) || /name=["']music:duration["']/.test(html) || /application\/ld\+json/.test(html);
}

async function getOEmbed(resource, ctx) {

  const canonical = pageUrl(resource.type, resource.id);
  const url = `https://open.spotify.com/oembed?url=${encodeURIComponent(canonical)}`;
  const r = await cachedFetch(ctx, {
    key: `https://cache.internal/oembed/${resource.type}/${resource.id}`,
    url,
    headers: { accept: 'application/json', 'user-agent': BOT_USER_AGENTS[0] },
    ttl: 86400,
    timeout: 8000,
  });

  if (r.status === 404) throw new ScrapeError(404, `Spotify has no ${resource.type} with id '${resource.id}'.`, { code: 'not_found', upstream: 404 });
  if (r.status !== 200) throw new ScrapeError(502, `Spotify oEmbed returned HTTP ${r.status}.`, { code: 'upstream_error', upstream: r.status });

  let data;
  try { data = JSON.parse(r.body); } catch { throw new ScrapeError(502, 'Spotify oEmbed returned invalid JSON.', { code: 'bad_oembed' }); }

  return {
    title: data.title || null,
    thumbnail: data.thumbnail_url || null,
    embed_url: data.iframe_url || null,
    embed_width: data.width || null,
    embed_height: data.height || null,
    embed_html: data.html || null,
    _cached: r.cached,
  };
}

async function getPage(resource, ctx, ttl = PAGE_TTL) {
  const candidates = [{ url: fetchUrlFor(resource), localeApplied: Boolean(resource.locale) }];
  if (resource.locale) candidates.push({ url: pageUrl(resource.type, resource.id), localeApplied: false });

  let lastStatus = 0;
  let shellOnly = null;

  for (const cand of candidates) {
    for (const ua of BOT_USER_AGENTS) {
      const uaTag = ua.split('/')[0].split(' ')[0].toLowerCase();
      let r;
      try {
        r = await cachedFetch(ctx, {
          key: `https://cache.internal/page/${resource.type}/${resource.id}/${cand.localeApplied ? resource.locale || 'x' : 'none'}/${uaTag}`,
          url: cand.url,
          headers: { accept: 'text/html', 'user-agent': ua },
          ttl,
        });
      } catch (e) {
        if (/abort|timeout/i.test(String(e?.message))) {
          throw new ScrapeError(504, `Spotify did not respond in time (${cand.url}).`, { code: 'upstream_timeout' });
        }
        continue;
      }

      lastStatus = r.status;
      if (r.status === 404 || r.status === 410) break;
      if (r.status === 429) throw new ScrapeError(429, 'Spotify rate limited this request - please retry in about a minute.', { code: 'rate_limited', upstream: 429 });
      if (r.status >= 400) continue;

      if (looksLikeSeoPage(r.body)) {
        return { html: r.body, cached: r.cached, localeApplied: cand.localeApplied, user_agent: uaTag, degraded: false };
      }

      if (!shellOnly) shellOnly = { html: r.body, cached: r.cached, localeApplied: cand.localeApplied, user_agent: uaTag };
    }
  }

  if (lastStatus === 404 || lastStatus === 410) {
    throw new ScrapeError(404, `Spotify has no ${resource.type} with id '${resource.id}'.`, { code: 'not_found', upstream: lastStatus });
  }
  if (shellOnly) return { ...shellOnly, degraded: true };
  throw new ScrapeError(502, `Could not read the Spotify page for ${resource.type}/${resource.id} (last HTTP ${lastStatus}).`, { code: 'upstream_error', upstream: lastStatus });
}

function idsFromUrls(urls, want) {
  const out = [], seen = new Set();
  for (const raw of urls || []) {
    const m = String(raw).match(/open\.spotify\.com\/(?:intl\/[^/]+\/)?([a-z]+)\/([0-9A-Za-z]{22})/i);
    if (!m) continue;
    const type = m[1].toLowerCase();
    if (want && type !== want) continue;
    if (seen.has(m[2])) continue;
    seen.add(m[2]);
    out.push({ id: m[2], type, url: pageUrl(type, m[2]), uri: spotifyUri(type, m[2]) });
  }
  return out;
}

function durationFrom(metas) {
  const raw = metaOne(metas, 'music:duration') || metaOne(metas, 'og:video:duration') || metaOne(metas, 'video:duration');
  const seconds = raw != null && raw !== '' ? Math.round(Number(raw)) : null;
  return seconds != null && Number.isFinite(seconds)
    ? { seconds, ms: seconds * 1000, formatted: formatDuration(seconds) }
    : { seconds: null, ms: null, formatted: null };
}

function buildTrack(resource, html) {
  const metas = extractMetas(html);
  const ld = extractJsonLd(html);
  const parts = splitDescription(metaOne(metas, 'og:description'));
  const album = idsFromUrls([metaOne(metas, 'music:album')], 'album')[0] || null;
  const artists = idsFromUrls(metaAll(metas, 'music:musician'), 'artist');
  const trackNumber = parseInt(metaOne(metas, 'music:album:track') || '', 10);

  return {
    title: bestTitle(metas, ld, html),
    description: metaOne(metas, 'og:description') || null,
    thumbnail: metaOne(metas, 'og:image') || metaOne(metas, 'twitter:image') || null,
    content_type: metaOne(metas, 'og:type') || 'music.song',
    page_url: metaOne(metas, 'og:url') || resource.url,

    preview_url: metaOne(metas, 'og:audio') || null,
    audio_download_url: null,

    metadata: {
      kind: parts[2] || null,
      artists_text: parts[0] || metaOne(metas, 'music:musician_description') || null,
      artists: artists.map((a) => ({ ...a, name: null })),
      album: album ? { ...album, name: parts[1] || null, track_number: Number.isFinite(trackNumber) ? trackNumber : null } : null,
      duration: durationFrom(metas),
      release_date: metaOne(metas, 'music:release_date') || ld?.datePublished || null,
      available_in: metaAll(metas, 'og:restrictions:country:allowed'),
      images: imageSizes(metaOne(metas, 'og:image')),

      isrc: null,
      popularity: null,
      explicit: null,
      lyrics: /lyrics/i.test(String(ld?.abstract || '')) ? 'login_or_premium_only' : null,
      deep_links: {
        app: spotifyUri('track', resource.id),
        android: `android-app://com.spotify.music/spotify/track/${resource.id}/play`,
      },
    },
  };
}

function buildAlbum(resource, html) {
  const metas = extractMetas(html);
  const ld = extractJsonLd(html);
  const desc = metaOne(metas, 'og:description') || '';
  const parts = splitDescription(desc);
  const tracks = idsFromUrls(metaAll(metas, 'music:song'), 'track');
  const countMatch = parts.find((p) => /[\d.,]+\s*(songs?|tracks?)/i.test(p))?.match(/([\d.,]+)\s*(songs?|tracks?)/i);

  return {
    title: bestTitle(metas, ld, html),
    description: desc || null,
    thumbnail: metaOne(metas, 'og:image') || null,
    content_type: metaOne(metas, 'og:type') || 'music.album',
    page_url: metaOne(metas, 'og:url') || resource.url,
    preview_url: null,
    audio_download_url: null,
    metadata: {
      artists_text: parts[0] || null,
      artists: idsFromUrls([...metaAll(metas, 'music:musician'), ...metaAll(metas, 'music:album:artist')], 'artist'),
      album_type: parts.find((p) => /^(album|ep|single|compilation)$/i.test(p))?.toLowerCase() ?? null,
      release_date: metaOne(metas, 'music:release_date') || ld?.datePublished || null,
      total_tracks: countMatch ? parseInt(countMatch[1].replace(/,/g, ''), 10) : tracks.length || null,
      tracks: tracks.map((t, i) => ({ position: i + 1, ...t })),
      tracks_note: tracks.length >= 30
        ? "Spotify's HTML exposes at most 30 tracks. Add ?tracks=1&limit=N for per-track detail on those."
        : null,
      available_in: metaAll(metas, 'og:restrictions:country:allowed'),
      images: imageSizes(metaOne(metas, 'og:image')),
      deep_links: { app: spotifyUri('album', resource.id) },
    },
  };
}

function buildPlaylist(resource, html) {
  const metas = extractMetas(html);
  const ld = extractJsonLd(html);
  const desc = metaOne(metas, 'og:description') || '';
  const tracks = idsFromUrls(metaAll(metas, 'music:song'), 'track');
  const owner = idsFromUrls([...metaAll(metas, 'music:creator'), ...metaAll(metas, 'music:by')], 'user')[0] || null;
  const countMatch = desc.match(/([\d.,]+)\s*(songs?|tracks?)/i);

  return {
    title: bestTitle(metas, ld, html),
    description: desc || null,
    thumbnail: metaOne(metas, 'og:image') || null,
    content_type: metaOne(metas, 'og:type') || 'music.playlist',
    page_url: metaOne(metas, 'og:url') || resource.url,
    preview_url: null,
    audio_download_url: null,
    metadata: {
      owner,
      owner_text: metaOne(metas, 'music:creator_description') || null,
      total_tracks: countMatch ? parseInt(countMatch[1].replace(/,/g, ''), 10) : tracks.length || null,
      tracks: tracks.map((t, i) => ({ position: i + 1, ...t })),
      tracks_note: tracks.length >= 30
        ? "Spotify's HTML exposes the first 30 tracks only. Add ?tracks=1&limit=N for per-track detail."
        : null,
      images: imageSizes(metaOne(metas, 'og:image')),
      deep_links: { app: spotifyUri('playlist', resource.id) },
    },
  };
}

function buildArtist(resource, html) {
  const metas = extractMetas(html);
  const ld = extractJsonLd(html);
  const desc = metaOne(metas, 'og:description') || '';
  const monthly = desc.match(/([\d.,]+\s*[KMB]?)\s*monthly listeners/i);
  const followers = desc.match(/([\d.,]+\s*[KMB]?)\s*followers/i);

  return {
    title: bestTitle(metas, ld, html),
    description: desc || null,
    thumbnail: metaOne(metas, 'og:image') || null,
    content_type: metaOne(metas, 'og:type') || 'profile',
    page_url: metaOne(metas, 'og:url') || resource.url,
    preview_url: null,
    audio_download_url: null,
    metadata: {
      monthly_listeners_text: monthly ? monthly[1] : null,
      monthly_listeners: monthly ? parseCount(monthly[1]) : null,
      followers_text: followers ? followers[1] : null,
      followers: followers ? parseCount(followers[1]) : null,
      images: imageSizes(metaOne(metas, 'og:image')),
      deep_links: { app: spotifyUri('artist', resource.id) },
    },
  };
}

function buildGeneric(resource, html) {
  const metas = extractMetas(html);
  const ld = extractJsonLd(html);
  return {
    title: bestTitle(metas, ld, html),
    description: metaOne(metas, 'og:description') || null,
    thumbnail: metaOne(metas, 'og:image') || null,
    content_type: metaOne(metas, 'og:type') || null,
    page_url: metaOne(metas, 'og:url') || resource.url,
    preview_url: metaOne(metas, 'og:audio') || metaOne(metas, 'og:video') || null,
    audio_download_url: null,
    metadata: {
      duration: durationFrom(metas),
      release_date: metaOne(metas, 'music:release_date') || ld?.datePublished || null,
      publisher: typeof ld?.publisher === 'string' ? ld.publisher : ld?.publisher?.name || null,
      images: imageSizes(metaOne(metas, 'og:image')),
      deep_links: { app: spotifyUri(resource.type, resource.id) },
    },
  };
}

const BUILDERS = { track: buildTrack, album: buildAlbum, playlist: buildPlaylist, artist: buildArtist };

async function expandArtists(entity, ctx, limit = 6) {
  const artists = (entity.metadata?.artists || []).filter((a) => !a.name).slice(0, limit);
  if (!artists.length) return entity;
  await Promise.all(artists.map(async (artist) => {
    try {
      const { html } = await getPage({ type: 'artist', id: artist.id, locale: null }, ctx, 86400);
      const metas = extractMetas(html);
      const monthly = (metaOne(metas, 'og:description') || '').match(/([\d.,]+\s*[KMB]?)\s*monthly listeners/i);
      artist.name = metaOne(metas, 'og:title') || null;
      artist.thumbnail = metaOne(metas, 'og:image') || null;
      artist.monthly_listeners = monthly ? parseCount(monthly[1]) : null;
      artist.monthly_listeners_text = monthly ? monthly[1] : null;
    } catch {

    }
  }));
  return entity;
}

async function expandTracks(entity, ctx, limit) {
  const targets = (entity.metadata?.tracks || []).slice(0, limit);
  if (!targets.length) return entity;
  entity.metadata.tracks_detail = await Promise.all(targets.map(async (t, i) => {
    try {
      const { html } = await getPage({ type: 'track', id: t.id, locale: null }, ctx);
      const metas = extractMetas(html);
      const parts = splitDescription(metaOne(metas, 'og:description'));
      return {
        position: t.position ?? i + 1,
        id: t.id,
        url: t.url,
        title: metaOne(metas, 'og:title'),
        artists_text: parts[0] || null,
        album_name: parts[1] || null,
        duration: durationFrom(metas),
        preview_url: metaOne(metas, 'og:audio') || null,
        thumbnail: metaOne(metas, 'og:image') || null,
      };
    } catch {
      return { position: t.position ?? i + 1, id: t.id, url: t.url, title: null, error: 'unavailable' };
    }
  }));
  return entity;
}

async function scrape(input, ctx, opts = {}) {
  const resource = await normalizeInput(input);
  if (opts.intl) {
    resource.locale = opts.intl;
    resource.url = pageUrl(resource.type, resource.id, opts.intl);
  }

  const [embedResult, pageResult] = await Promise.allSettled([getOEmbed(resource, ctx), getPage(resource, ctx)]);
  const embed = embedResult.status === 'fulfilled' ? embedResult.value : null;
  const embedError = embedResult.status === 'rejected' ? embedResult.reason : null;
  const page = pageResult.status === 'fulfilled' ? pageResult.value : null;
  const pageError = pageResult.status === 'rejected' ? pageResult.reason : null;

  if (embedError?.status === 404 && (pageError?.status === 404 || !page)) throw embedError;
  if (pageError?.status === 404 && !embed) throw pageError;
  if (embedError && pageError) {
    if (pageError instanceof ScrapeError) throw pageError;
    throw new ScrapeError(502, `Spotify metadata lookup failed. oEmbed: ${embedError?.message}; page: ${pageError?.message}`, { code: 'both_sources_failed' });
  }

  const entity = (BUILDERS[resource.type] || buildGeneric)(resource, page?.html || '');

  if (embed) {
    entity.title = entity.title || embed.title;
    entity.thumbnail = entity.thumbnail || embed.thumbnail;
    entity.metadata.images = entity.metadata.images || imageSizes(embed.thumbnail);
  }

  const degraded = Boolean(!page || page.degraded || !entity.title);
  if (page && !page.degraded) {
    if (resource.type === 'track' && opts.light !== true) await expandArtists(entity, ctx);
    if (opts.tracks) await expandTracks(entity, ctx, opts.limit);
  }

  if (opts.raw && page?.html) {
    const metas = extractMetas(page.html);
    entity.raw_meta = Object.fromEntries([...metas].map(([k, v]) => [k, v.length === 1 ? v[0] : v]));
  }

  return {
    success: true,
    platform: 'spotify',
    resource_type: resource.type,
    resource_id: resource.id,
    url: resource.url,
    uri: spotifyUri(resource.type, resource.id),
    locale: resource.locale,
    locale_applied: page ? page.localeApplied : null,
    resolved_from: resource.resolvedFrom,

    title: entity.title,
    description: entity.description,
    thumbnail: entity.thumbnail,
    content_type: entity.content_type,
    page_url: entity.page_url,

    embed_url: embed?.embed_url || `${embedUrl(resource.type, resource.id)}?utm_source=oembed`,
    embed_width: embed?.embed_width || 456,
    embed_height: embed?.embed_height || (resource.type === 'track' ? 152 : 352),
    embed_html: embed?.embed_html || null,

    preview_url: entity.preview_url,
    audio_download_url: entity.audio_download_url,

    metadata: entity.metadata,
    ...(entity.raw_meta ? { raw_meta: entity.raw_meta } : {}),

    engine: page && !page.degraded && embed
      ? 'Spotify oEmbed + public page metadata'
      : page && !page.degraded
        ? 'Spotify public page metadata'
        : 'Spotify oEmbed',
    scraped_with: page?.user_agent || null,
    cached: Boolean(embed?._cached || page?.cached),
    ...(degraded
      ? { degraded: true, degraded_reason: 'Spotify served its app shell with no metadata; oEmbed data only.' }
      : {}),
    requires_api_key: false,
    note: 'This API returns public metadata and Spotify embed links only. It does not provide full-track downloads or bypass DRM.',
  };
}

function linkAnalysis(input) {
  const parsed = parseSpotifyLink(input);
  if (!parsed) {
    return { status: 400, body: { success: false, error: 'That is not a Spotify URL, a spotify: URI, or a 22-character id.', code: 'invalid_input' } };
  }

  const tracking = [], meaningful = [];
  for (const [key, value] of Object.entries(parsed.params)) {
    const k = key.toLowerCase();
    const entry = { param: key, value, note: PARAM_NOTES[k] ?? null };
    if (k.startsWith('utm_') || TRACKING_PARAMS.has(k)) tracking.push(entry); else meaningful.push(entry);
  }

  const valid = Boolean(parsed.type && parsed.id && RESOURCE_TYPES.has(parsed.type) && ID_RE.test(parsed.id));
  const clean = valid ? `https://open.spotify.com/${parsed.type}/${parsed.id}` : null;

  return {
    status: 200,
    body: {
      success: true,
      input,
      valid,
      resource_type: parsed.type,
      resource_id: parsed.id,
      locale: parsed.locale,
      clean_url: clean,
      uri: valid ? spotifyUri(parsed.type, parsed.id) : null,
      embed_url: valid ? embedUrl(parsed.type, parsed.id) : null,
      needs_redirect_resolution: Boolean(parsed.needsRedirectResolution),
      unsupported_host: parsed.unsupportedHost || null,
      params: {
        all: parsed.params,
        tracking,
        meaningful,
        safe_to_remove: tracking.map((t) => t.param),
        count: Object.keys(parsed.params).length,
      },
      scrape_endpoint: clean ? `/api/scrape?url=${encodeURIComponent(clean)}` : null,
      summary: tracking.length
        ? `This link carries ${tracking.length} tracking parameter(s) (${tracking.map((t) => t.param).join(', ')}). Removing them and using ${clean || 'the clean URL'} returns exactly the same metadata.`
        : 'This link carries no tracking parameters.',
      param_notes: PARAM_NOTES,
    },
  };
}

function json(data, status = 200, cached = false, extra = {}, pretty = false) {
  return new Response(JSON.stringify(data, null, pretty ? 2 : 0), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'access-control-allow-origin': CORS_ORIGIN,
      'cache-control': status === 200
        ? `public, max-age=${RESPONSE_TTL}, s-maxage=${RESPONSE_TTL}, stale-while-revalidate=86400`
        : 'no-store',
      'x-cache': cached ? 'HIT' : 'MISS',
      'x-engine': 'keyless-scrape',
      ...extra,
    },
  });
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function readInput(request, url) {
  const fromQuery = url.searchParams.get('url') || url.searchParams.get('uri') || url.searchParams.get('link');
  if (fromQuery) return fromQuery;
  if (request.method === 'POST') {
    if ((request.headers.get('content-type') || '').includes('application/json')) {
      try { const b = await request.json(); return b?.url || b?.uri || b?.link || null; }
      catch { throw new ScrapeError(400, 'Request body must be valid JSON.', { code: 'bad_json' }); }
    }
    return (await request.text())?.trim() || null;
  }
  return null;
}

function scrapeOptions(url, env) {
  const limitCap = Math.min(Number(env?.MAX_TRACKS || MAX_TRACKS), 50);
  return {
    tracks: url.searchParams.get('tracks') === '1' || url.searchParams.get('tracks') === 'true',
    limit: Math.min(Math.max(parseInt(url.searchParams.get('limit') || '10', 10) || 10, 1), limitCap),
    light: url.searchParams.get('light') === '1',
    raw: url.searchParams.get('raw') === '1',
    intl: url.searchParams.get('intl') || null,
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: {
          'access-control-allow-origin': CORS_ORIGIN,
          'access-control-allow-methods': 'GET, POST, OPTIONS',
          'access-control-allow-headers': 'content-type, x-api-key, authorization',
          'access-control-max-age': '86400',
        },
      });
    }

    if (!['GET', 'POST'].includes(request.method)) {
      return json({ success: false, error: 'Method not allowed.', code: 'method_not_allowed', allowed: 'GET, POST, OPTIONS' }, 405);
    }

    if (path === '/' || path === '/index.html') {
      const lines = [
        'Spotify Scraper API v' + VERSION,
        '',
        'GET /api/scrape?url=<spotify link>',
        'GET /api/embed?url=<spotify link>       add &format=html for an iframe page',
        'GET /api/parse?url=<spotify link>',
        'GET /api/track/<id>                     also album, playlist, artist, episode, show',
        'GET /health',
        '',
        'options: tracks=1  limit=10  light=1  intl=es  raw=1',
      ];
      return new Response(lines.join('\n') + '\n', {
        status: 200,
        headers: {
          'content-type': 'text/plain; charset=utf-8',
          'access-control-allow-origin': CORS_ORIGIN,
          'cache-control': 'public, max-age=300',
        },
      });
    }

    if (path === '/health') {
      return json({
        success: true,
        name: 'Spotify Scraper API',
        version: VERSION,
        base_url: url.origin,
        api_index: url.origin + '/',
        requires_api_key: Boolean(env?.API_KEY),
        auth: env?.API_KEY ? 'api_key' : 'public',
        cache: CACHE_ON ? `on (pages ${PAGE_TTL}s, responses ${RESPONSE_TTL}s)` : 'off',
        supported_types: [...RESOURCE_TYPES],
        license: 'MIT (c) Thishan Dinujaya',
      }, 200, true, { 'cache-control': 'public, max-age=60' });
    }

    if (env?.API_KEY) {
      const got = request.headers.get('x-api-key') ||
        request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ||
        url.searchParams.get('key');
      if (got !== env.API_KEY) {
        return json({
          success: false,
          error: 'Unauthorized - this deployment requires an API key.',
          code: 'unauthorized',
          how_to_send: 'Send the header `x-api-key: <API_KEY>` or `Authorization: Bearer <API_KEY>`, or add `?key=<API_KEY>`.',
          public_endpoints: ['/', '/health'],
        }, 401);
      }
    }

    try {
      if (path === '/api/parse') {
        const input = url.searchParams.get('url') || url.searchParams.get('uri');
        if (!input) return json({ success: false, error: 'Provide `?url=<spotify link>`.', code: 'missing_url' }, 400);
        const r = linkAnalysis(input);
        return json(r.body, r.status, true);
      }

      if (path === '/api/scrape' || path === '/api/embed') {
        const input = await readInput(request, url);
        if (!input) {
          return json({
            success: false,
            error: 'Provide a Spotify URL in the `url` query parameter or in the JSON body.',
            code: 'missing_url',
            example: '/api/scrape?url=https://open.spotify.com/track/1kZvBIepQFlgUywAub2h56',
          }, 400);
        }

        const result = await scrape(input, ctx, scrapeOptions(url, env));

        if (path === '/api/embed' && url.searchParams.get('format') === 'html') {
          const iframe = result.embed_html ||
            `<iframe style="border-radius:12px" src="${result.embed_url}" width="100%" height="${result.embed_height}" frameBorder="0" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>`;
          return new Response(
            `<!doctype html><meta charset="utf-8"><title>${escapeHtml(result.title || 'Spotify embed')}</title><body style="margin:0;background:transparent">${iframe}</body>`,
            { status: 200, headers: { 'content-type': 'text/html; charset=utf-8', 'access-control-allow-origin': CORS_ORIGIN, 'cache-control': 'public, max-age=3600' } }
          );
        }
        return json(result, 200, result.cached);
      }

      const m = path.match(/^\/api\/(track|album|playlist|artist|episode|show)\/([0-9A-Za-z]{22})$/);
      if (m) {
        const intl = url.searchParams.get('intl');
        const link = intl
          ? `https://open.spotify.com/intl/${intl}/${m[1]}/${m[2]}`
          : `https://open.spotify.com/${m[1]}/${m[2]}`;
        const result = await scrape(link, ctx, scrapeOptions(url, env));
        return json(result, 200, result.cached);
      }

      return json({
        success: false,
        error: 'Not found.',
        code: 'not_found',
        try: [
          '/api/scrape?url=https://open.spotify.com/track/1kZvBIepQFlgUywAub2h56',
          '/api/parse?url=<share link>',
          '/health',
        ],
      }, 404);
    } catch (error) {
      if (error instanceof ScrapeError) {
        return json({
          success: false,
          error: error.message,
          code: error.code || 'scrape_error',
          ...(error.upstream ? { upstream_status: error.upstream } : {}),
        }, error.status || 502);
      }
      const isTimeout = /abort|timeout/i.test(String(error?.message || ''));
      console.error('scrape_failed', error);
      return json({
        success: false,
        error: isTimeout ? 'Spotify did not respond in time - please retry.' : error?.message || 'Unexpected error.',
        code: isTimeout ? 'upstream_timeout' : 'internal_error',
      }, isTimeout ? 504 : 500);
    }
  },
};
