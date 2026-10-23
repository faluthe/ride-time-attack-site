// Cloudflare Worker in front of the static site. /data/* comes from the R2 bucket (uploaded by
// ./deploy-data.sh), so code deploys from git never touch the laps; everything else is the build.

interface Env {
  ASSETS: Fetcher;
  DATA: R2Bucket;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/data/")) return env.ASSETS.fetch(request);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    }

    const key = decodeURIComponent(url.pathname.slice("/data/".length));
    const object = await env.DATA.get(key, { onlyIf: request.headers });
    if (object === null) return new Response("not found", { status: 404 });

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    // Data changes after every session: always revalidate, but let the etag make that cheap.
    headers.set("cache-control", "no-cache");

    if (!("body" in object)) return new Response(null, { status: 304, headers });
    return new Response(request.method === "HEAD" ? null : object.body, { headers });
  },
} satisfies ExportedHandler<Env>;
