import { describe, expect, it, vi } from 'vitest';
import bs58 from 'bs58';
import { inspectTransaction, InspectionError } from '../packages/solana-engine/src/inspector.ts';

const signature = bs58.encode(new Uint8Array(64).fill(1));
const transport = (value: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(value), { status })) as unknown as typeof fetch;

describe('read-only RPC inspection', () => {
  it('rejects malformed signatures before calling RPC', async () => {
    const fetcher = transport({ result: null });
    await expect(inspectTransaction('bad', 'devnet', fetcher)).rejects.toMatchObject({ code: 'INVALID_SIGNATURE', status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('returns exactly the selected network response and requests version 1', async () => {
    const rpcResult = { slot: 123, version: 1, blockTime: null, meta: { err: null, fee: 5000 }, transaction: { signatures: [signature], message: { accountKeys: [], instructions: [] } } };
    const fetcher = transport({ result: rpcResult });
    const result = await inspectTransaction(signature, 'devnet', fetcher);
    expect(result.network).toBe('devnet');
    expect(result.transaction).toEqual(rpcResult);
    const [endpoint, init] = (fetcher as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(endpoint).toBe('https://api.devnet.solana.com');
    expect(JSON.parse(init.body as string).params[1].maxSupportedTransactionVersion).toBe(1);
  });
  it('does not substitute another network when a transaction is absent', async () => {
    const fetcher = transport({ result: null });
    await expect(inspectTransaction(signature, 'mainnet', fetcher)).rejects.toMatchObject({ code: 'TRANSACTION_NOT_FOUND', status: 404 });
    expect((fetcher as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });
  it('classifies unsupported versions and rate limits', async () => {
    await expect(inspectTransaction(signature, 'devnet', transport({ error: { code: -32015, message: 'Unsupported version' } }))).rejects.toMatchObject({ code: 'UNSUPPORTED_TRANSACTION_VERSION', status: 422 });
    await expect(inspectTransaction(signature, 'devnet', transport({}, 429))).rejects.toMatchObject({ code: 'RPC_RATE_LIMITED', status: 429 });
  });
});
