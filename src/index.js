const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "access-control-allow-origin": "*" };
const SPOTIFY_HOSTS = new Set(["open.spotify.com", "www.open.spotify.com", "spotify.link", "www.spotify.link"]);
const RESOURCE_TYPES = new Set(["track", "album", "playlist", "episode", "show", "artist"]);

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...headers } });
}

function decodeHtml(value = "") {
  return value.replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

async function normalizeSpotifyUrl(input) {
  let parsed;
  try { parsed = new URL(String(input || "").trim()); } catch { throw new Error("Provide a valid Spotify URL."); }
  if (parsed.protocol !== "https:" || !SPOTIFY_HOSTS.has(parsed.hostname.toLowerCase())) throw new Error("Only Spotify links are supported.");
  if (parsed.hostname.toLowerCase().endsWith("spotify.link")) {
    const redirectResponse = await fetch(parsed.href, { method: "GET", redirect: "follow", headers: { "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(10000) });
    parsed = new URL(redirectResponse.url);
    if (!["open.spotify.com", "www.open.spotify.com"].includes(parsed.hostname.toLowerCase())) throw new Error("The short link did not resolve to a Spotify page.");
  }
  const match = parsed.pathname.match(/^\/(track|album|playlist|episode|show|artist)\/([A-Za-z0-9]{10,32})\/?$/i);
  if (!match || !RESOURCE_TYPES.has(match[1].toLowerCase())) throw new Error("The link must point to a Spotify track, album, playlist, episode, show, or artist.");
  const type = match[1].toLowerCase();
  const id = match[2];
  return { type, id, url: `https://open.spotify.com/${type}/${id}` };
}

function extractMeta(html, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["'][^>]*>`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["'][^>]*>`, "i")
  ];
  for (const pattern of patterns) { const match = html.match(pattern); if (match) return decodeHtml(match[1]); }
  return null;
}

async function getOEmbed(spotifyUrl) {
  const endpoint = `https://open.spotify.com/oembed?url=${encodeURIComponent(spotifyUrl)}`;
  const response = await fetch(endpoint, { headers: { accept: "application/json", "user-agent": "Mozilla/5.0" }, signal: AbortSignal.timeout(12000) });
  if (!response.ok) throw new Error(`Spotify oEmbed returned HTTP ${response.status}`);
  const result = await response.json();
  return { title: result.title || null, thumbnail: result.thumbnail_url || null, embed_url: result.iframe_url || null, embed_width: result.width || null, embed_height: result.height || null, provider: result.provider_name || "Spotify" };
}

async function getPageMetadata(spotifyUrl) {
  const response = await fetch(spotifyUrl, { headers: { accept: "text/html", "user-agent": "Mozilla/5.0 (compatible; PublicMetadataReader/1.0)" }, redirect: "follow", signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Spotify page returned HTTP ${response.status}`);
  const html = (await response.text()).slice(0, 3_000_000);
  const description = extractMeta(html, "og:description") || extractMeta(html, "description");
  const image = extractMeta(html, "og:image") || extractMeta(html, "twitter:image");
  const title = extractMeta(html, "og:title") || html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/\s*\|\s*Spotify\s*$/i, "").trim() || null;
  return { title: decodeHtml(title || ""), description, thumbnail: image, page_url: extractMeta(html, "og:url") || spotifyUrl, content_type: extractMeta(html, "og:type") || null };
}

async function scrape(input) {
  const resource = await normalizeSpotifyUrl(input);
  const [embedResult, pageResult] = await Promise.allSettled([getOEmbed(resource.url), getPageMetadata(resource.url)]);
  if (embedResult.status === "rejected" && pageResult.status === "rejected") throw new Error(`Spotify metadata lookup failed. oEmbed: ${embedResult.reason.message}; page: ${pageResult.reason.message}`);
  const embed = embedResult.status === "fulfilled" ? embedResult.value : {};
  const page = pageResult.status === "fulfilled" ? pageResult.value : {};
  const thumbnail = embed.thumbnail || page.thumbnail || null;
  return {
    success: true,
    platform: "spotify",
    resource_type: resource.type,
    resource_id: resource.id,
    url: resource.url,
    title: embed.title || page.title || null,
    description: page.description || null,
    thumbnail,
    embed_url: embed.embed_url || `https://open.spotify.com/embed/${resource.type}/${resource.id}`,
    embed_width: embed.embed_width || null,
    embed_height: embed.embed_height || null,
    page_url: page.page_url || resource.url,
    content_type: page.content_type || null,
    preview_url: null,
    audio_download_url: null,
    engine: embedResult.status === "fulfilled" && pageResult.status === "fulfilled" ? "Spotify oEmbed + public page metadata" : embedResult.status === "fulfilled" ? "Spotify oEmbed" : "Spotify public page metadata",
    note: "This API returns public metadata and Spotify embed links only. It does not provide full-track downloads or bypass DRM."
  };
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { ...JSON_HEADERS, "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type" } });
    if (request.method !== "GET" && request.method !== "POST") return json({ success: false, error: "Method not allowed." }, 405);
    if (url.pathname === "/" || url.pathname === "/health") return json({ success: true, name: "Spotify Scraper API", endpoints: ["/api/scrape", "/api/embed"] });
    if (url.pathname !== "/api/scrape" && url.pathname !== "/api/embed") return json({ success: false, error: "Not found." }, 404);
    let input = url.searchParams.get("url");
    if (request.method === "POST") {
      try { const body = await request.json(); input = body.url || input; } catch { return json({ success: false, error: "Request body must be valid JSON." }, 400); }
    }
    if (!input) return json({ success: false, error: "Provide a Spotify URL in the url parameter or JSON body." }, 400);
    try { return json(await scrape(input)); }
    catch (error) {
      const invalid = /valid Spotify URL|Only Spotify links|link must point|short link did not resolve/i.test(error.message);
      return json({ success: false, error: error.message }, invalid ? 400 : 502);
    }
  }
};
