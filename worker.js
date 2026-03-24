export default {
  async fetch(request) {
    const allowedOrigins = new Set([
      "https://levelsfyi-visualizer.approximator.net",
      "http://localhost:5173",
    ]);

    const requestOrigin = request.headers.get("Origin") || "";
    const corsOrigin = allowedOrigins.has(requestOrigin) ? requestOrigin : "null";

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(corsOrigin),
      });
    }

    const url = new URL(request.url);
    if (url.pathname !== "/v3/salary/search" && url.pathname !== "/api/levels/v3/salary/search") {
      return new Response("Not Found", { status: 404 });
    }

    const upstreamUrl = new URL("https://api.levels.fyi/v3/salary/search");
    upstreamUrl.search = url.search;

    const upstreamHeaders = buildUpstreamHeaders(request.headers);
    const upstreamResp = await fetch(upstreamUrl.toString(), {
      method: "GET",
      headers: upstreamHeaders,
    });

    const respHeaders = new Headers(upstreamResp.headers);
    for (const [k, v] of Object.entries(corsHeaders(corsOrigin))) {
      respHeaders.set(k, v);
    }

    return new Response(upstreamResp.body, {
      status: upstreamResp.status,
      headers: respHeaders,
    });
  },
};

const FORWARDED_HEADER_NAMES = [
  "accept",
  "accept-language",
  "authorization",
  "connection",
  "origin",
  "referer",
  "sec-fetch-dest",
  "sec-fetch-mode",
  "sec-fetch-site",
  "user-agent",
  "sec-ch-ua",
  "sec-ch-ua-mobile",
  "sec-ch-ua-platform",
  "x-agent",
];

function buildUpstreamHeaders(requestHeaders) {
  const upstreamHeaders = new Headers();

  for (const name of FORWARDED_HEADER_NAMES) {
    const value = requestHeaders.get(name);
    if (value) {
      upstreamHeaders.set(name, value);
    }
  }

  upstreamHeaders.set("accept", upstreamHeaders.get("accept") || "application/json, text/plain, */*");
  upstreamHeaders.set("x-agent", upstreamHeaders.get("x-agent") || "levelsfyi_website");
  upstreamHeaders.set("origin", "https://www.levels.fyi");
  upstreamHeaders.set("referer", "https://www.levels.fyi/");

  return upstreamHeaders;
}

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "GET,OPTIONS",
    "Access-Control-Allow-Headers":
      "Authorization,Content-Type,Accept,Accept-Language,x-agent,Origin,Referer,Sec-Fetch-Dest,Sec-Fetch-Mode,Sec-Fetch-Site,User-Agent,sec-ch-ua,sec-ch-ua-mobile,sec-ch-ua-platform",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}