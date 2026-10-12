# Verified scope and limitations

- Wallet mutation and cryptographic diagnosis support **legacy Solana transactions only**, up to the 1232-byte legacy wire limit. The read-only RPC inspector can display `jsonParsed` transactions through version 1 because parsing is supplied by RPC; Errling does not locally decode v1 wire transactions.
- The injected wallet is a controlled Wallet Standard web provider. It does not test Phantom, Solflare, Backpack, native Mobile Wallet Adapter, extension approval UI, or physical mobile devices.
- The reference transaction uses a disposable offline-only blockhash. It is intended to prove signing integrity and is never submitted. The dashboard does not expose broadcast controls.
- External applications may require selectors or manual guided interaction. Errling does not discover their transaction controls automatically. Application handling is marked inconclusive when no observable outcome is available.
- The vulnerable reference flow intentionally proceeds to a simulated next step after receiving a modified transaction. It never broadcasts an invalid transaction.
- The inspector relies on public Solana RPC availability and history retention. `null` results can mean the signature is absent on that network, not yet confirmed, or unavailable from that provider. It does not prove a transaction never existed.
- The app is a single-machine local tool. There is no authentication, team sharing, hosted runner, or cloud synchronization. The API is loopback-bound and should not be exposed on a public interface.
- SQLite history is local and remains until the user runs the explicit cleanup command or removes `data/errling.sqlite`. No automatic deletion is performed.
- Browser tests were run with installed Chrome on Windows. Other Chromium binaries may need `ERRLING_CHROMIUM_PATH` and separate verification.
- Responsive layouts and keyboard navigation received a browser smoke check. A full WCAG 2.2 AA audit with automated assistive-technology tooling and manual screen-reader review has not been completed.
- A captioned demonstration recording is delivered separately from the source package. [DEMO.md](DEMO.md) gives a reproducible recording sequence; the recording has no voice narration.
