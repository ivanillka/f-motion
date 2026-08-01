const apiOrigin = "https://api.f-motion.com";

export function upstreamUrl(requestUrl) {
  const incoming = new URL(requestUrl);
  const upstream = new URL(incoming.pathname === "/api/healthz" ? "/healthz" : incoming.pathname, apiOrigin);
  upstream.search = incoming.search;
  return upstream;
}

export function onRequest({ request }) {
  return fetch(new Request(upstreamUrl(request.url), request));
}
