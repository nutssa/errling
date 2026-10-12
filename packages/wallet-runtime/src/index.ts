import { registerWallet } from '@wallet-standard/wallet';

type Config = { address: string; publicKey: number[]; profile: string; icon: string; broadcastEnabled: boolean };
declare global {
  interface Window {
    __ERRLING_CONFIG__: Config;
    __errlingBridge: (request: { action: string; transactionBase64?: string; chain?: string }) => Promise<{ outputBase64?: string; signatureBase64?: string }>;
  }
}

const config = window.__ERRLING_CONFIG__;
if (!config) throw new Error('Errling wallet injection is missing configuration');
const fromBase64 = (value: string) => Uint8Array.from(atob(value), c => c.charCodeAt(0));
const toBase64 = (value: Uint8Array) => btoa(Array.from(value, c => String.fromCharCode(c)).join(''));
const supported = config.profile !== 'SIGN_ONLY_V1' && config.broadcastEnabled;
const account = Object.freeze({
  address: config.address,
  publicKey: new Uint8Array(config.publicKey),
  chains: ['solana:devnet'],
  features: supported ? ['solana:signTransaction', 'solana:signAndSendTransaction'] : ['solana:signTransaction'],
  label: 'Disposable Errling test account'
});
const listeners = new Set<(event: { accounts: readonly typeof account[] }) => void>();
const features: Record<string, unknown> = {
  'standard:connect': {
    version: '1.0.0',
    connect: async () => { await window.__errlingBridge({ action: 'connect' }); return { accounts: [account] }; }
  },
  'standard:events': {
    version: '1.0.0',
    on: (_event: string, listener: (event: { accounts: readonly typeof account[] }) => void) => { listeners.add(listener); return () => listeners.delete(listener); }
  },
  'solana:signTransaction': {
    version: '1.0.0',
    supportedTransactionVersions: ['legacy'],
    signTransaction: async (...inputs: Array<{ transaction: Uint8Array; account: typeof account; chain?: string }>) => {
      const outputs = [];
      for (const input of inputs) {
        if (input.account.address !== account.address) throw new Error('Errling wallet account mismatch');
        if (input.chain && input.chain !== 'solana:devnet') throw new Error('Errling supports devnet chain metadata only');
        const result = await window.__errlingBridge({ action: 'signTransaction', transactionBase64: toBase64(input.transaction), chain: input.chain });
        if (!result.outputBase64) throw new Error('Errling runner did not return a signed transaction');
        outputs.push({ signedTransaction: fromBase64(result.outputBase64) });
      }
      return outputs;
    }
  }
};
if (supported) {
  features['solana:signAndSendTransaction'] = {
    version: '1.0.0',
    supportedTransactionVersions: ['legacy'],
    signAndSendTransaction: async (...inputs: Array<{ transaction: Uint8Array; account: typeof account; chain: string }>) => {
      const outputs = [];
      for (const input of inputs) {
        if (input.account.address !== account.address || input.chain !== 'solana:devnet') throw new Error('Invalid Errling sign-and-send request');
        const result = await window.__errlingBridge({ action: 'signAndSendTransaction', transactionBase64: toBase64(input.transaction), chain: input.chain });
        if (!result.signatureBase64) throw new Error('Errling runner did not return a broadcast signature');
        outputs.push({ signature: fromBase64(result.signatureBase64) });
      }
      return outputs;
    }
  };
}
const wallet = Object.freeze({
  version: '1.0.0',
  name: 'Errling Controlled Wallet',
  icon: config.icon,
  chains: ['solana:devnet'],
  features,
  accounts: [account]
});
registerWallet(wallet as Parameters<typeof registerWallet>[0]);
