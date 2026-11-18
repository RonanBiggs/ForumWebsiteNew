// server/ip.js - the visitor's real IP address (usernames are tied to it, and the spam limit uses it).
//
// On Render a request passes through several proxies (Cloudflare, then Render's load
// balancer), and which ones can differ between the page's requests and its WebSocket.
// The LAST X-Forwarded-For entry is one of those proxies, so it changes from request
// to request. The visitor is the FIRST entry. Cloudflare also sends the visitor's
// address on its own in CF-Connecting-IP, which is preferred when present.
// Locally (no proxy) it's simply the socket address.

export function clientIp(req) {
    const h = req.headers;
    const direct = h['cf-connecting-ip'] || h['true-client-ip'];
    if (direct) return normalise(String(direct).trim());
    const xff = h['x-forwarded-for'];
    if (xff) return normalise(String(xff).split(',')[0].trim());
    return normalise(req.socket.remoteAddress || '');
}

// "::ffff:1.2.3.4" (IPv4 written as IPv6) -> "1.2.3.4", so the same visitor always matches.
function normalise(ip) {
    return ip.startsWith('::ffff:') ? ip.slice(7) : ip;
}
