import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getWallets } from '@wallet-standard/app';
import { Transaction } from '@solana/web3.js';
import { Buffer } from 'buffer';
import nacl from 'tweetnacl';
import './style.css';

(globalThis as typeof globalThis & { Buffer: typeof Buffer }).Buffer = Buffer;
const API = 'http://127.0.0.1:3100/api/v1';
const params = new URLSearchParams(location.search);
const mode = params.get('mode') === 'vulnerable' ? 'vulnerable' : 'protected';
const profile = params.get('profile') || 'BASELINE_VERBATIM_V1';
type Wallet = ReturnType<typeof getWallets>['get'] extends () => infer T ? T extends readonly (infer W)[] ? W : never : never;
type WalletAccount = Wallet['accounts'][number];
type ConnectFeature = { connect: () => Promise<{accounts: readonly WalletAccount[]}> };
type SignFeature = { signTransaction: (input: { transaction: Uint8Array; account: WalletAccount; chain: string }) => Promise<readonly {signedTransaction: Uint8Array}[]> };
type SendFeature = { signAndSendTransaction: (input: { transaction: Uint8Array; account: WalletAccount; chain: string }) => Promise<readonly {signature: Uint8Array}[]> };

function App() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [account, setAccount] = useState<WalletAccount | null>(null);
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<{ code: string; text: string } | null>(null);
  useEffect(() => {
    const wallets = getWallets();
    const update = () => setWallet(wallets.get().find(w => w.name === 'Errling Controlled Wallet') ?? null);
    update();
    const off = wallets.on('register', update);
    return () => off();
  }, []);
  const connect = async () => {
    if (!wallet) return;
    setBusy(true);
    try {
      const feature = wallet.features['standard:connect'] as ConnectFeature;
      const result = await feature.connect();
      setAccount(result.accounts[0] ?? null);
    } catch (error) { setOutcome({ code: 'connection-error', text: error instanceof Error ? error.message : String(error) }); }
    finally { setBusy(false); }
  };
  const sign = async () => {
    if (!wallet || !account) return;
    setBusy(true); setOutcome(null);
    try {
      if (profile === 'SIGN_ONLY_V1') {
        const available = Object.keys(wallet.features);
        if (mode === 'protected' && (!available.includes('solana:signAndSendTransaction') || !account.features.includes('solana:signAndSendTransaction'))) {
          setOutcome({ code: 'capability-checked', text: 'Handled safely: this wallet does not offer sign-and-send. The app checked its capabilities and stopped before calling it.' });
          return;
        }
        if (mode === 'vulnerable') {
          try {
            // Deliberately unsafe reference integration: no capability check.
            const unsupported = wallet.features['solana:signAndSendTransaction'] as SendFeature;
            await unsupported.signAndSendTransaction({ transaction: new Uint8Array(), account, chain: 'solana:devnet' });
          } catch (error) {
            setOutcome({ code: 'missing-capability-error', text: `Unsafe assumption surfaced: ${error instanceof Error ? error.message : String(error)}` });
            return;
          }
        }
      }
      const fixtureResponse = await fetch(`${API}/fixture?wallet=${encodeURIComponent(account.address)}`);
      const fixtureEnvelope = await fixtureResponse.json() as { data: { serializedBase64: string; coSigner: string } };
      if (!fixtureResponse.ok) throw new Error('Could not construct the reference transaction');
      const input = Buffer.from(fixtureEnvelope.data.serializedBase64, 'base64');
      const before = Transaction.from(input);
      const feature = wallet.features['solana:signTransaction'] as SignFeature;
      const outputs = await feature.signTransaction({ transaction: new Uint8Array(input), account, chain: 'solana:devnet' });
      const after = Transaction.from(Buffer.from(outputs[0].signedTransaction));
      const beforeMessage = before.serializeMessage();
      const afterMessage = after.serializeMessage();
      const sameMessage = Buffer.from(beforeMessage).equals(Buffer.from(afterMessage));
      const signaturesValid = after.signatures.every(s => !!s.signature && nacl.sign.detached.verify(afterMessage, s.signature, s.publicKey.toBytes()));
      if (mode === 'protected' && (!sameMessage || !signaturesValid)) {
        setOutcome({ code: 'rejected-integrity-change', text: 'Protected flow rejected the returned transaction: its message changed or a required signature failed verification.' });
      } else if (mode === 'vulnerable' && !sameMessage) {
        // This example deliberately proceeds to a simulated next step. It never broadcasts.
        setOutcome({ code: 'continued-without-check', text: 'Vulnerable flow continued after wallet signing without enforcing message integrity. No transaction was broadcast.' });
      } else {
        setOutcome({ code: 'accepted', text: 'The message was unchanged and both signatures verified. This was off-chain signing only.' });
      }
    } catch (error) { setOutcome({ code: 'signing-error', text: error instanceof Error ? error.message : String(error) }); }
    finally { setBusy(false); }
  };
  return <main className="shell">
    <div className="ref-brand"><img src="/errling-icon.svg" alt=""/><strong>Errling</strong><span>CONTROLLED ENVIRONMENT</span></div>
    <div className="eyebrow">ERRLING · REFERENCE DAPP</div>
    <h1>Wallet boundary test</h1>
    <p className="intro">A genuine Wallet Standard signing flow built to show how application handling changes the outcome.</p>
    <div className="tags"><span>{mode === 'protected' ? 'Protected flow' : 'Vulnerable flow'}</span><span>{profile.replaceAll('_', ' ')}</span><span>Devnet metadata · off-chain signing</span></div>
    <section className="card">
      <div className="step">01 / DISCOVER</div>
      <h2>Controlled wallet</h2>
      <p data-testid="wallet-name">{wallet ? wallet.name : 'Waiting for Errling wallet…'}</p>
      <p className="mono muted">{account?.address || 'Disposable account not connected'}</p>
      <button data-testid="connect-wallet" disabled={!wallet || !!account || busy} onClick={connect}>{account ? 'Connected' : 'Connect controlled wallet'}</button>
    </section>
    <section className="card">
      <div className="step">02 / SIGN</div>
      <h2>Run transaction flow</h2>
      <p>The fixture has a disposable co-signer and wallet signer. Its blockhash is for offline signing only.</p>
      <button data-testid="run-signing" disabled={!account || busy} onClick={sign}>{busy ? 'Working…' : 'Sign transaction'}</button>
    </section>
    {outcome && <section className={`outcome ${outcome.code.includes('error') || outcome.code.includes('continued') ? 'alert' : ''}`} data-testid="outcome" data-outcome={outcome.code} role="status"><strong>{outcome.code.replaceAll('-', ' ')}</strong><p>{outcome.text}</p></section>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<App/>);
