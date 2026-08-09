// elyad.io apex landing — static server behind the jakesjam tunnel ingress
// (elyad.io / www.elyad.io → 127.0.0.1:8090, see ops/cloudflared/config.yml).
// Loopback-only: the tunnel is the sole intended client.
const root = new URL("./", import.meta.url).pathname;

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

Bun.serve({
  hostname: "127.0.0.1",
  port: 8090,
  async fetch(req) {
    let path = new URL(req.url).pathname;
    if (path === "/") path = "/index.html";
    if (path.includes("..")) return new Response("nope", { status: 400 });
    const file = Bun.file(root + path.slice(1));
    if (!(await file.exists())) return new Response("not found", { status: 404 });
    const ext = path.slice(path.lastIndexOf("."));
    return new Response(file, {
      headers: { "content-type": TYPES[ext] ?? "application/octet-stream" },
    });
  },
});

console.log(`elyad-apex serving ${root} on 127.0.0.1:8090`);
