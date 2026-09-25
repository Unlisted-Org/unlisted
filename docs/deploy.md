# Deployment

Two pieces, on the same pattern as Uncross:
- **Site** (`web/`: the landing page at `/` and the holder app at `/app`) on **Vercel**;
- **Valuation API** (`services/valuation`, spec 03) on **Railway**.

Both run against **devnet** only. Mainnet is read, never signed on.

## ⚠ The Helius key is visible in visitors' browsers

The app talks to devnet from the browser, so `/config.json` hands the browser a Helius devnet URL that includes the key. That is unavoidable for a client-side dApp. The key is never committed: `/config.json` is built from the `HELIUS_API_KEY` environment variable at request time. The pre-commit guard refuses a key in a URL anywhere in the repo.

**To do once the site's domain exists:** in the Helius dashboard, restrict the key to that domain, allowing requests only from the site's origins (the custom domain and `*.vercel.app` previews). Uncross has the same exposure on its devnet key.

The valuation service's key (`MAINNET_RPC` / `DEVNET_RPC` on Railway) stays server-side.

## Site (Vercel)

- **Project:** `unlisted`, root directory `web`.
- **`web/vercel.json`:** installs `web/` and `../sdk`; the build uses webpack; `prebuild` verifies every evidence signature on chain.
- **Environment:**
  - `HELIUS_API_KEY`;
  - `VALUATION_API_URL`, the Railway service's public URL.
- **Checked on a clean checkout:** with `sdk/node_modules` absent, the install command followed by `npm run build` succeeds.

## Valuation API (Railway)

- **Project:** `unlisted`, service `valuation`, built from `services/valuation/Dockerfile` with the repo root as build context.
- **Volume** mounted at `/data` (`DATA_DIR`). It holds the saved basket and the watcher's event store.
- **Environment:**
  - `MAINNET_RPC=https://mainnet.helius-rpc.com/?api-key=…`;
  - `DEVNET_RPC=https://devnet.helius-rpc.com/?api-key=…`;
  - `RPC_SPACING_MS=120`;
  - `BASKET_REFRESH_S=60` (set in the Dockerfile).
- **Footprint** (measured 2026-09-25): about 90 MB of memory once settled (137 MB peak at start), under 1% CPU, about 100 KB of state.

### Cold start: measured 2026-09-25

The cause: KALSHI's holder lookup, `getTokenLargestAccounts`, takes 96 s of a 122 s cold read on the public mainnet RPC, which rate-limits that call. On Helius it answers in 0.38 s.

| Case | First answer |
|---|---|
| Restart with the saved basket (the fix), in the container, on a volume | **0.002 s**, `served.from: "cache"` |
| Broken version: `NO_BASKET_CACHE=1` | 17 s |
| Public RPC, holder lookup non-blocking (the fix) | 17 s |
| Broken version: `BLOCKING_HOLDERS=1` on the public RPC | 202 s |
| First-ever start (nothing saved yet), Helius | 22–25 s, once per new volume |

`/v1/basket` never makes a visitor wait while a saved basket exists. The response carries `served.from` (`live` or `cache`) and `served.age_s`, and `as_of` says when the figures were read.
