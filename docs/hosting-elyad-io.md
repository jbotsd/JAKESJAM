# Hosting JAKESJAM on **play.elyad.io**

**Share:** `https://play.elyad.io/?world=1`  
**Origin:** this machine · Bun `:8088`  
**Tunnel:** `jakesjam` · id `4019d70d-f4ae-4423-941b-a13ae9a0112a`

One tunnel, one origin, one brand URL. No multi-app tunnels.

## Architecture

```
https://play.elyad.io  →  Cloudflare tunnel jakesjam  →  127.0.0.1:8088 Bun
```

## DNS (required for public brand URL)

`elyad.io` must be a **Cloudflare zone** (registrar can stay Hover).

1. Cloudflare → Add site → **elyad.io** (Free).
2. Hover → Nameservers → Cloudflare NS.
3. Route hostname:
   ```bash
   cloudflared tunnel route dns -f jakesjam play.elyad.io
   ```
   Or CF DNS: CNAME `play` → `4019d70d-f4ae-4423-941b-a13ae9a0112a.cfargotunnel.com` (proxied).
4. If using Hover email, re-add MX in CF:  
   `@ MX 10 mx.hover.com.cust.hostedemail.com`

Until that is done, use Funnel fallback (below).

## Run

```bash
cd /path/to/JAKESJAM

# Brand URL (after CF DNS is live)
TUNNEL=cf PUBLIC_URL=https://play.elyad.io bun run host:public

# Emergency fallback (Tailscale Funnel)
TUNNEL=funnel bun run host:public
```

`TUNNEL=cf` always uses **`ops/cloudflared/config.yml`** (not a multi-app home config).  
The script **exits** if that file points at another tunnel id or forbidden hostnames.

## Files

| Path | Role |
|------|------|
| `ops/cloudflared/config.yml` | Canonical ingress (git) |
| `~/.cloudflared/4019d70d-….json` | Tunnel credentials (local only) |
| `scripts/host-public.sh` | Bun + tunnel launcher |

## Verify

```bash
cloudflared tunnel list                    # only jakesjam
curl -sS -o /dev/null -w "%{http_code}\n" https://play.elyad.io/health
```

## Operator console (/ops) — LAN-only (2026-07-31)

The ops console is **never served on the public :8088 port** (hard 404
there, before the SPA fallback). It runs on its own listener:

- **Port**: `OPS_PORT` (default **:8089**), started by `startOpsServer()`
  in `server/src/ops.ts` alongside the game server.
- **Reachability**: refuses non-private source addresses (RFC1918 /
  loopback / link-local / ULA) even if the port were ever forwarded.
  ADMIN_SECRET auth unchanged on top of that.
- **URL from the LAN**: `http://<host-lan-ip>:8089/ops`
- **ufw**: default INPUT is DROP — LAN devices need a one-time allow:
  `sudo ufw allow proto tcp from 192.168.4.0/24 to any port 8089 comment 'jakesjam ops LAN'`
  (same-host access via localhost works without it; the public tunnel
  needs no inbound rule at all since cloudflared dials out.)

Verify after any host restart:

```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://play.elyad.io/ops   # 404
curl -sS -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8089/ops   # 200
```
