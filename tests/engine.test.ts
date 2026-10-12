import { describe, expect, it } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { analyzeRoundTrip, createReferenceFixture, decodeTransaction, MEMO_PROGRAM, MEMO_TEXT, signWithControlledWallet } from '../packages/solana-engine/src/index.ts';

describe('real Solana signing evidence', () => {
  it('keeps the original message and both signatures valid under baseline signing', () => {
    const wallet = Keypair.generate();
    const fixture = createReferenceFixture(wallet.publicKey);
    const { before, after } = signWithControlledWallet(fixture.serializedBase64, 'BASELINE_VERBATIM_V1', wallet);
    expect(before.messageHash).toBe(after.messageHash);
    expect(after.signatures).toHaveLength(2);
    expect(after.signatures.every(s => s.valid)).toBe(true);
    expect(decodeTransaction(after.serializedBase64).messageHash).toBe(after.messageHash);
  });

  it('proves a real appended Memo invalidates only the earlier signature', () => {
    const wallet = Keypair.generate();
    const fixture = createReferenceFixture(wallet.publicKey);
    const { before, after } = signWithControlledWallet(fixture.serializedBase64, 'WALLET_APPENDED_INSTRUCTION_V1', wallet);
    const result = analyzeRoundTrip(before, after, 'vulnerable', 'continued-without-check');
    expect(before.signatures.find(s => s.signer === fixture.coSigner)?.valid).toBe(true);
    expect(after.signatures.find(s => s.signer === fixture.coSigner)?.valid).toBe(false);
    expect(after.signatures.find(s => s.signer === wallet.publicKey.toBase58())?.valid).toBe(true);
    expect(result.messageChanged).toBe(true);
    expect(result.earlierSignatureAgainstReturnedMessage).toBe(false);
    expect(result.findings.map(f => f.ruleId)).toContain('ERR-SIG-001');
    expect(result.instructionDiff[0].instruction.programId).toBe(MEMO_PROGRAM.toBase58());
    expect(Buffer.from(result.instructionDiff[0].instruction.dataBase64, 'base64').toString()).toBe(MEMO_TEXT);
    expect(result.applicationHandling).toBe('unsafe-assumption');
  });

  it('recognizes protected rejection as correct handling of the same hazard', () => {
    const wallet = Keypair.generate();
    const fixture = createReferenceFixture(wallet.publicKey);
    const { before, after } = signWithControlledWallet(fixture.serializedBase64, 'WALLET_APPENDED_INSTRUCTION_V1', wallet);
    const result = analyzeRoundTrip(before, after, 'protected', 'rejected-integrity-change');
    expect(result.findings.map(f => f.ruleId)).toContain('ERR-SIG-001');
    expect(result.applicationHandling).toBe('handled-correctly');
  });
});
