import bs58 from 'bs58';

export type InspectionNetwork = 'devnet' | 'mainnet';
export class InspectionError extends Error {
  constructor(public code: string, public status: number, message: string) { super(message); }
}
export async function inspectTransaction(signature: string, network: InspectionNetwork, transport: typeof fetch = fetch) {
  let decoded: Uint8Array;
  try { decoded = bs58.decode(signature); } catch { throw new InspectionError('INVALID_SIGNATURE', 400, 'The signature must be base58.'); }
  if (decoded.length !== 64) throw new InspectionError('INVALID_SIGNATURE', 400, 'A Solana transaction signature decodes to 64 bytes.');
  const endpoint = network === 'devnet' ? 'https://api.devnet.solana.com' : 'https://api.mainnet-beta.solana.com';
  let response: Response;
  try {
    response = await transport(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'getTransaction', params: [signature, { encoding: 'jsonParsed', commitment: 'confirmed', maxSupportedTransactionVersion: 1 }] }), signal: AbortSignal.timeout(12000) });
  } catch (error) { throw new InspectionError('RPC_UNAVAILABLE', 503, error instanceof Error ? error.message : 'RPC request failed'); }
  if (response.status === 429) throw new InspectionError('RPC_RATE_LIMITED', 429, 'The selected RPC endpoint is rate limiting requests. Try again later.');
  if (!response.ok) throw new InspectionError('RPC_UNAVAILABLE', 502, `The selected RPC endpoint returned HTTP ${response.status}.`);
  let rpc: { result?: unknown; error?: {code:number;message:string} };
  try { rpc = await response.json() as typeof rpc; }
  catch { throw new InspectionError('RPC_INVALID_RESPONSE', 502, 'The RPC endpoint returned invalid JSON.'); }
  if (rpc.error) throw new InspectionError(rpc.error.code === -32015 ? 'UNSUPPORTED_TRANSACTION_VERSION' : 'RPC_ERROR', rpc.error.code === -32015 ? 422 : 502, rpc.error.message);
  if (!rpc.result) throw new InspectionError('TRANSACTION_NOT_FOUND', 404, 'No confirmed transaction was returned on the selected network. Check the network, signature, or RPC history availability.');
  return { network, endpoint, retrievedAt: new Date().toISOString(), evidence: 'RPC Confirmed', transaction: rpc.result };
}
