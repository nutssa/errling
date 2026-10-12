import { createHash } from 'node:crypto';
import { Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from '@solana/web3.js';
import nacl from 'tweetnacl';

export const MEMO_PROGRAM = new PublicKey('MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr');
export const MEMO_TEXT = 'Errling wallet-boundary diagnostic v1';
export type ProfileId = 'BASELINE_VERBATIM_V1' | 'WALLET_APPENDED_INSTRUCTION_V1' | 'SIGN_ONLY_V1';
export type AppMode = 'vulnerable' | 'protected';

export interface SignatureEvidence {
  signer: string;
  signatureBase64: string | null;
  valid: boolean | null;
  state: 'valid' | 'invalid' | 'missing';
}
export interface InstructionEvidence {
  index: number;
  programId: string;
  accountKeys: string[];
  dataBase64: string;
  label: string;
}
export interface TransactionEvidence {
  serializedBase64: string;
  messageBase64: string;
  messageHash: string;
  version: 'legacy';
  feePayer: string | null;
  recentBlockhash: string | null;
  signatures: SignatureEvidence[];
  instructions: InstructionEvidence[];
}

const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const bytes = (base64: string) => Buffer.from(base64, 'base64');

export function decodeTransaction(serializedBase64: string): TransactionEvidence {
  const raw = bytes(serializedBase64);
  if (raw.length > 1232) throw new Error('Transaction exceeds the 1232-byte legacy transaction limit');
  const tx = Transaction.from(raw);
  const message = tx.serializeMessage();
  const signatures = tx.signatures.map(({ publicKey, signature }) => {
    const valid = signature ? nacl.sign.detached.verify(message, signature, publicKey.toBytes()) : null;
    return {
      signer: publicKey.toBase58(),
      signatureBase64: signature ? Buffer.from(signature).toString('base64') : null,
      valid,
      state: valid === null ? 'missing' as const : valid ? 'valid' as const : 'invalid' as const
    };
  });
  const instructions = tx.instructions.map((ix, index) => ({
    index,
    programId: ix.programId.toBase58(),
    accountKeys: ix.keys.map(key => key.pubkey.toBase58()),
    dataBase64: Buffer.from(ix.data).toString('base64'),
    label: ix.programId.equals(MEMO_PROGRAM) ? `Memo: ${Buffer.from(ix.data).toString('utf8')}` :
      ix.programId.equals(SystemProgram.programId) ? 'System Program instruction' : 'Unrecognized program instruction'
  }));
  return {
    serializedBase64,
    messageBase64: Buffer.from(message).toString('base64'),
    messageHash: hash(message),
    version: 'legacy',
    feePayer: tx.feePayer?.toBase58() ?? null,
    recentBlockhash: tx.recentBlockhash ?? null,
    signatures,
    instructions
  };
}

export function createReferenceFixture(walletPublicKey: PublicKey): { serializedBase64: string; coSigner: string; note: string } {
  const coSigner = Keypair.generate();
  const tx = new Transaction({
    feePayer: coSigner.publicKey,
    // This is an offline signing fixture, never submitted to the network.
    recentBlockhash: Keypair.generate().publicKey.toBase58()
  });
  tx.add(SystemProgram.transfer({ fromPubkey: walletPublicKey, toPubkey: coSigner.publicKey, lamports: 0 }));
  tx.partialSign(coSigner);
  const serializedBase64 = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
  const verified = decodeTransaction(serializedBase64).signatures.find(s => s.signer === coSigner.publicKey.toBase58());
  if (!verified?.valid) throw new Error('Reference co-signer signature did not verify before the wallet boundary');
  return { serializedBase64, coSigner: coSigner.publicKey.toBase58(), note: 'Offline-only transaction. The blockhash is a disposable test value and this transaction is not broadcast.' };
}

export function signWithControlledWallet(inputBase64: string, profile: ProfileId, walletKeypair: Keypair) {
  const before = decodeTransaction(inputBase64);
  const tx = Transaction.from(bytes(inputBase64));
  if (!tx.signatures.some(s => s.publicKey.equals(walletKeypair.publicKey))) throw new Error('Controlled wallet is not a required signer');
  if (profile === 'WALLET_APPENDED_INSTRUCTION_V1') {
    tx.add(new TransactionInstruction({ programId: MEMO_PROGRAM, keys: [], data: Buffer.from(MEMO_TEXT, 'utf8') }));
  }
  tx.partialSign(walletKeypair);
  const outputBase64 = tx.serialize({ requireAllSignatures: false, verifySignatures: false }).toString('base64');
  const after = decodeTransaction(outputBase64);
  return { before, after, outputBase64 };
}

export function analyzeRoundTrip(before: TransactionEvidence, after: TransactionEvidence, appMode: AppMode, appOutcome: string) {
  const messageChanged = before.messageHash !== after.messageHash;
  const earlier = before.signatures.find(s => s.valid === true && s.signer !== after.signatures.at(-1)?.signer) ?? before.signatures.find(s => s.valid === true);
  const earlierAfter = earlier ? after.signatures.find(s => s.signer === earlier.signer) : undefined;
  const earlierSignatureAgainstReturnedMessage = earlier?.signatureBase64
    ? nacl.sign.detached.verify(bytes(after.messageBase64), bytes(earlier.signatureBase64), new PublicKey(earlier.signer).toBytes())
    : null;
  const instructionDiff = after.instructions.slice(before.instructions.length).map(ix => ({ type: 'added' as const, instruction: ix }));
  const findings = [] as Array<{ ruleId: string; title: string; severity: string; evidence: string; explanation: string; fix: string }>;
  if (messageChanged) findings.push({
    ruleId: 'ERR-MSG-001', title: 'Transaction message changed at the wallet boundary', severity: 'warning', evidence: 'Observed',
    explanation: 'The returned serialized message has a different SHA-256 hash from the message supplied by the application.',
    fix: 'Compare the returned message to the approved message before using the returned transaction.'
  });
  if (messageChanged && earlier?.valid && earlierSignatureAgainstReturnedMessage === false) findings.push({
    ruleId: 'ERR-SIG-001', title: 'Earlier signature invalidated by message modification', severity: 'critical', evidence: 'Cryptographically Verified',
    explanation: 'The earlier co-signer signature verifies over the original message bytes, but fails Ed25519 verification over the wallet-returned message bytes.',
    fix: 'Freeze the message before collecting signatures. If any instruction changes, rebuild the transaction and collect fresh signatures.'
  });
  const applicationHandling = appOutcome === 'rejected-integrity-change' ? 'handled-correctly' : appOutcome === 'continued-without-check' ? 'unsafe-assumption' : appOutcome === 'accepted' ? 'accepted' : 'inconclusive';
  return { messageChanged, instructionDiff, earlierSignatureAgainstReturnedMessage, findings, applicationHandling, appMode };
}
