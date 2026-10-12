# Errling — Firefly Trace

Errling is a local transaction round-trip debugger for Solana web dApps. It tests a real Wallet Standard signing flow with a disposable controlled wallet, records the serialized transaction before and after the wallet boundary, and verifies message hashes and Ed25519 signatures. The bundled reference app demonstrates both an unsafe integration and an integration that rejects an unexpected wallet change.

This is a **local MVP**. The core signing demonstration is entirely off-chain. An off-chain valid signature is not a broadcast or confirmation.

## What it does

- Captures the serialized transaction sent to and returned by a controlled Wallet Standard wallet.
- Compares message bytes and SHA-256 hashes, then independently verifies Ed25519 signatures.
- Demonstrates a baseline, a wallet-added instruction, and a protected dApp response with a bundled reference app.
- Saves local reports, history, and JSON or Markdown exports; offers a separate read-only Solana transaction inspector.

## Technology

TypeScript, React, Vite, Node.js, Playwright, Solana Web3.js, Wallet Standard, and Node's built-in SQLite. The dashboard, reference dApp, API, controlled wallet, and transaction engine are included in this repository.

## Requirements

- Node.js 24.x (this project uses the built-in `node:sqlite` module)
- pnpm 11.25.x
- Google Chrome installed for Playwright's `chrome` channel, or `ERRLING_CHROMIUM_PATH` pointing to a compatible Chromium executable
- Network access only for package installation, web fonts, and the optional read-only transaction inspector

## Start

```bash
pnpm install --frozen-lockfile
npm run dev
```

Open <http://127.0.0.1:3000>. The single development command starts the dashboard on port 3000, reference dApp on port 3001, and loopback API/runner on port 3100. The SQLite database is created at `data/errling.sqlite`. No personal wallet or funded identity is needed.

On Windows PowerShell, if script execution policy blocks `npm` or `pnpm`, run `pnpm.cmd install --frozen-lockfile` and `npm.cmd run dev` instead. Keep that terminal open while using the local site.

The interface opens in the dark Firefly Trace theme. Use the sun button in the top bar for the light theme. Motion is reduced automatically when your system requests reduced motion.

On a machine without Google Chrome, set `ERRLING_CHROMIUM_PATH` in the environment before starting. `ERRLING_DB_PATH` can select a different local SQLite file. `.env.example` lists these optional values; the app does not auto-load `.env` files. The three service ports are fixed at 3000, 3001, and 3100 in this MVP.

## Reproduce the main finding

1. Choose **New Trace → Try Example App → Baseline Wallet → Protected Flow** and run it. The message hash stays the same and both required signatures verify.
2. Run **Wallet-Appended Instruction → Vulnerable Flow**. The controlled wallet appends a real Memo instruction. The previously valid co-signer signature fails over the returned message, while the wallet's new signature verifies. The example app deliberately continues without an integrity check. It does not broadcast.
3. Run the same mutation profile in **Protected Flow**. The signing hazard is still cryptographically verified, but the app rejects the changed message. The report marks the application handling as correct.
4. Run **Sign-Only Wallet** in both application modes. The wallet feature registry omits `solana:signAndSendTransaction`; the vulnerable mode invokes it without a check and the protected mode refuses the unsupported operation cleanly.

Use **Inspect Transaction** for an existing Solana signature. That path queries the selected Devnet or Mainnet RPC endpoint and cannot reconstruct pre-wallet bytes from a historical transaction.

## Verify

```bash
npm run proof
npm run typecheck
npm test
npm run build
node tests/ui-smoke.mjs <completed-run-id>
npm run audit:e2e
```

`proof` creates a disposable two-signer transaction and asserts the baseline/mutation signature properties. Unit tests cover independent verification, the protected outcome, and deterministic RPC error handling. The UI smoke script needs the three local services running and writes screenshots to ignored `data/qa/`. `audit:e2e` also requires those services, Chrome, and access to public Devnet RPC; it runs five browser signing scenarios and checks a known Devnet signature that may eventually disappear from public RPC history. It creates disposable runs in the local database and writes its evidence to ignored `data/qa/audit-results.json`.

To regenerate a captioned browser demonstration, install Playwright's small video codec once with `npx playwright install ffmpeg`, keep the services running, then run `node tests/record-demo.mjs`. It writes `errling-demo.webm` in the project folder. An under-three-minute recording following the three-step signing demo is also delivered separately from the source archive.

## Architecture

| Location | Responsibility |
| --- | --- |
| `apps/web` | Responsive dashboard, run configuration, reports, history, docs, settings, inspector |
| `apps/reference-dapp` | Genuine Wallet Standard client with vulnerable and protected signing flows |
| `apps/api` | Loopback HTTP API, Playwright runner, event stream, SQLite history, exports, RPC proxy |
| `packages/wallet-runtime` | Browser-injected Wallet Standard wallet registered before page scripts |
| `packages/solana-engine` | Transaction fixture, decoding, SHA-256, Ed25519 verification, deterministic findings, RPC service |
| `tests` | Cryptographic, inspector, and UI smoke tests |

The runner generates disposable wallet keys per run. The reference fixture uses a separate disposable co-signer and a syntactically valid **offline-only** blockhash value. The co-signer signs the original message before the wallet receives it. The controlled wallet holds its private key in the local runner, not in the dApp. A Playwright binding mediates the wallet's signing request and records both actual serialized payloads. The browser wallet has no private key or general machine-access secret. The exact input and output bytes, hashes, signature states, and observations are stored in SQLite as a version-1 report snapshot. Private keys are not stored.

The implementation uses Vite for the two browser apps and Node's built-in SQLite, keeping the local MVP small. It does not use the specification's proposed Next.js and Drizzle stack. The functional boundaries and versioned API remain explicit.

The original supplied vector logo, updated logo artwork, and visual reference boards are retained in `assets/`. The browser uses the updated artwork in `apps/web/public/`, including a square icon that preserves the supplied PNG without redrawing it.

## Wallet profiles

| Profile | Signing behavior | Advertised capabilities in default off-chain runs |
| --- | --- | --- |
| `BASELINE_VERBATIM_V1` | Signs the unchanged legacy message | `standard:connect`, `standard:events`, `solana:signTransaction` |
| `WALLET_APPENDED_INSTRUCTION_V1` | Appends the Memo `Errling wallet-boundary diagnostic v1`, then signs | Same as baseline |
| `SIGN_ONLY_V1` | Signs unchanged; deliberately omits sign-and-send | Same registry except the optional sign-and-send capability remains absent even when broadcast is enabled |

`solana:signAndSendTransaction` is advertised for baseline only if explicit Devnet broadcast is enabled through the versioned API. The dashboard offers off-chain testing only. This feature exists solely for opt-in API use and is not part of the core example demonstration. No mainnet writing path exists.

The Wallet Standard registration and feature shape follow the [official Wallet Standard reference implementation](https://github.com/wallet-standard/wallet-standard/blob/master/packages/example/wallets/src/solanaWallet.ts) and [registration contract](https://github.com/wallet-standard/wallet-standard/blob/master/packages/core/wallet/src/register.ts). Playwright uses [browser-context initialization and bindings](https://playwright.dev/docs/api/class-browsercontext). Transaction signatures authenticate the serialized message bytes as described in the [Solana transaction documentation](https://solana.com/docs/core/transactions).

## Local API

All endpoints use `/api/v1` and JSON `{requestId,data}` or `{requestId,error}` envelopes. Main routes:

- `POST /runs`, `GET /runs`, `GET /runs/:id`
- `GET /runs/:id/events` (replay plus server-sent updates)
- `POST /runs/:id/cancel`
- `GET /runs/:id/report`
- `GET /runs/:id/export?format=json|markdown`
- `POST /transactions/inspect`
- `GET /profiles`, `GET /health`

Run reports use `schemaVersion: 1`. `ERR-SIG-001` requires proof that an original valid signature fails over the modified message. `ERR-MSG-001` identifies a captured message difference. `ERR-CAP-001` identifies the reference app's observed attempt to call an unadvertised feature. Application handling is assessed separately from the injected wallet hazard.

The inspector uses Solana's [`getTransaction` RPC method](https://solana.com/docs/rpc/http/gettransaction) with `jsonParsed`, `commitment: confirmed`, and `maxSupportedTransactionVersion: 1`. It displays RPC-returned data and never invents a prior wallet request.

## Test a local dApp

The target must be an HTTP loopback URL with an explicit port, discover Wallet Standard wallets, and use `solana:signTransaction` with a legacy transaction that requires the Errling account as a signer. In **Guided browser** mode, a visible Chrome window opens and you perform the connect and sign actions. Errling captures the wallet round trip even when it cannot determine how the external app handled the result; in that case handling is **inconclusive**. In **Configured selectors** mode, provide CSS selectors for the connect and sign controls. The runner clicks those controls in the actual page. It does not infer arbitrary dApp workflows.

The API binds to `127.0.0.1`, accepts the dashboard and reference-app origins, and rejects non-loopback target URLs. Do not expose port 3100 publicly. See [LIMITATIONS.md](docs/LIMITATIONS.md) for supported formats, security boundaries, and unimplemented features.

History is durable until removed. `npm run cleanup` previews how many runs are older than 30 days; `npm run cleanup -- --older-than-days=30 --apply` removes those runs and their events. Run this only after the API is stopped.

## Troubleshooting

- **Chrome fails to launch:** install Chrome or set `ERRLING_CHROMIUM_PATH`.
- **Target cannot be reached:** start the local dApp first and verify the URL and port.
- **No wallet appears:** the dApp must use Wallet Standard discovery and accept unfamiliar wallets.
- **No signing request captured:** verify the app used the connected Errling account as a required signer and invoked `solana:signTransaction`.
- **Inspector returns not found:** check both the signature and selected network. Public RPC nodes may lack historical data or rate limit requests.
- **Ports occupied:** stop the existing local process on 3000, 3001, or 3100 before starting Errling.

For a short presentation path, see [DEMO.md](docs/DEMO.md).
