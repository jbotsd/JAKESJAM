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
