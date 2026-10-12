import { Keypair } from '@solana/web3.js';
import { analyzeRoundTrip, createReferenceFixture, signWithControlledWallet } from './index.ts';

const wallet = Keypair.generate();
const fixture = createReferenceFixture(wallet.publicKey);
const baseline = signWithControlledWallet(fixture.serializedBase64, 'BASELINE_VERBATIM_V1', wallet);
const mutation = signWithControlledWallet(fixture.serializedBase64, 'WALLET_APPENDED_INSTRUCTION_V1', wallet);
const result = analyzeRoundTrip(mutation.before, mutation.after, 'vulnerable', 'continued-without-check');
if (baseline.before.messageHash !== baseline.after.messageHash) throw new Error('Baseline altered the message');
if (!baseline.after.signatures.every(s => s.valid)) throw new Error('Baseline signatures are invalid');
if (!result.messageChanged || result.earlierSignatureAgainstReturnedMessage !== false || !result.findings.some(f => f.ruleId === 'ERR-SIG-001')) throw new Error('Mutation proof failed');
console.log(JSON.stringify({ baseline: { originalHash: baseline.before.messageHash, returnedHash: baseline.after.messageHash, signatures: baseline.after.signatures.map(({signer,state})=>({signer,state})) }, mutation: { originalHash: mutation.before.messageHash, returnedHash: mutation.after.messageHash, signatures: mutation.after.signatures.map(({signer,state})=>({signer,state})), findings: result.findings.map(f=>f.ruleId), addedInstruction: result.instructionDiff } }, null, 2));
