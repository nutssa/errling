# Errling live demo: about 2 minutes 45 seconds

## Prepare

From the project folder, run `pnpm install --frozen-lockfile` once, then `npm run dev`. Wait for the dashboard, reference dApp, and API to start. Open <http://127.0.0.1:3000>. The automated example runs use a headless browser; record the dashboard window. No personal wallet or funds are needed.

## Click path and narration

1. **0:00–0:20 — What Errling tests.** On Overview, say: “A dApp may assume the wallet returns exactly the transaction it supplied. Errling measures that signing boundary with a controlled Wallet Standard wallet.” Scroll through **Capture → Compare → Verify**, then open **New Trace** from the sidebar.
2. **0:20–0:50 — Known-good baseline.** Leave **Try Example App** selected. Select **Baseline Wallet** and **Protected Flow**, then click **Start Trace**. When the report completes, point to **Before / after**: the message hashes match. Scroll to **Required signatures**: both returned signatures are valid. Say this is real serialized, off-chain signing.
3. **0:50–1:40 — Reproduce the failure.** Click **New Trace**. Select **Wallet-Appended Instruction** and **Vulnerable Flow**, then **Start Trace**. In **Findings**, show `ERR-MSG-001` and `ERR-SIG-001`. In **Before / after**, show the added Memo and different hashes. In **Required signatures**, show the earlier co-signer changed from valid to invalid while the wallet signature is valid. Explain that a signature authenticates the exact message bytes.
4. **1:40–2:25 — Show the fix in application behavior.** Click **New Trace**. Keep **Wallet-Appended Instruction**, select **Protected Flow**, and click **Start Trace**. The same cryptographic hazard appears, but **Application handling** says **Handled correctly** because the reference dApp rejected the changed message. Point to the suggested fix: compare the returned message and recollect signatures if it changed.
5. **2:25–2:45 — Close.** Say: “Errling makes this wallet-boundary failure reproducible and separates the signing hazard from the dApp’s response. The dashboard never broadcasts these test transactions.” If time allows, mention **Sign-Only Wallet** for capability checks and **Inspect Transaction** for a separate, read-only lookup of an already confirmed transaction.

Use “Errling Controlled Wallet” when describing the tests. This MVP does not directly test Phantom, Solflare, Backpack, or mobile wallet approval screens. The Inspector’s RPC evidence is separate from the off-chain signing reports.
