import assert from "node:assert/strict";
import { test } from "node:test";
import { ed25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { base58 } from "@scure/base";
import { recoverTransactionAddress, verifyMessage } from "viem";
import { ToolRegistry } from "../tools/registry.js";
import { EventBus } from "../transport/events.js";
import { Registry } from "../transport/rpc.js";
import { MODULES } from "./all.js";
import { decryptKeystore, encryptKeystore } from "./wallet.js";
import { enabledModules, loadModules } from "./registry.js";

// Public Hardhat test account #0 — a well-known throwaway vector, NOT a real secret.
const TEST_KEY = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
const TEST_ADDR = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";

test("keystore: encrypt → decrypt round-trips; a wrong passphrase fails closed", () => {
  const ks = encryptKeystore(TEST_KEY, "hunter2");
  assert.equal(decryptKeystore(ks, "hunter2"), TEST_KEY);
  assert.throws(() => decryptKeystore(ks, "wrong")); // GCM auth tag rejects, never returns garbage
});

test("wallet: address + EIP-191 signature are correct and the key never leaks", async () => {
  const prev = process.env.VISHU_WALLET_KEY;
  process.env.VISHU_WALLET_KEY = TEST_KEY;
  try {
    const c = { tools: new ToolRegistry(), rpc: new Registry(), bus: new EventBus(), workspaceDir: "." };
    await loadModules(MODULES, c, enabledModules({ VISHU_MODULES: "wallet" }));
    const t = {} as never;

    assert.equal(await c.tools.get("wallet_address").run({}, t), TEST_ADDR);

    const sig = await c.tools.get("wallet_sign_message").run({ message: "gm" }, t);
    assert.match(sig, /^0x[0-9a-f]{130}$/i);
    assert.equal(await verifyMessage({ address: TEST_ADDR, message: "gm", signature: sig as `0x${string}` }), true);

    // the key must never appear in any tool output
    assert.ok(!sig.includes(TEST_KEY.slice(2)));
  } finally {
    if (prev === undefined) delete process.env.VISHU_WALLET_KEY;
    else process.env.VISHU_WALLET_KEY = prev;
  }
});

test("wallet: sign_tx is correct, recovers the sender, and never leaks the key", async () => {
  const prev = process.env.VISHU_WALLET_KEY;
  process.env.VISHU_WALLET_KEY = TEST_KEY;
  try {
    const c = { tools: new ToolRegistry(), rpc: new Registry(), bus: new EventBus(), workspaceDir: "." };
    await loadModules(MODULES, c, enabledModules({ VISHU_MODULES: "wallet" }));
    const raw = await c.tools.get("wallet_sign_tx").run(
      {
        chainId: 1,
        to: TEST_ADDR,
        value: "1000000000000000000", // 1 ETH in wei
        nonce: 0,
        gas: "21000",
        maxFeePerGas: "30000000000",
        maxPriorityFeePerGas: "1000000000",
      },
      {} as never,
    );
    assert.match(raw, /^0x02[0-9a-f]+$/i); // EIP-1559 typed tx
    const sender = await recoverTransactionAddress({ serializedTransaction: raw as `0x02${string}` });
    assert.equal(sender.toLowerCase(), TEST_ADDR.toLowerCase());
    assert.ok(!raw.includes(TEST_KEY.slice(2)));

    assert.match(await c.tools.get("wallet_sign_tx").run({ chainId: 1, to: "0xnope", value: "1", nonce: 0, gas: "21000", maxFeePerGas: "1", maxPriorityFeePerGas: "1" }, {} as never), /invalid 'to'/);
    assert.match(await c.tools.get("wallet_sign_tx").run({ chainId: 1, to: TEST_ADDR, value: "1.5", nonce: 0, gas: "21000", maxFeePerGas: "1", maxPriorityFeePerGas: "1" }, {} as never), /error:/); // float wei fails closed
  } finally {
    if (prev === undefined) delete process.env.VISHU_WALLET_KEY;
    else process.env.VISHU_WALLET_KEY = prev;
  }
});

test("wallet: send_tx broadcasts via RPC and surfaces rpc errors", async () => {
  const prevUrl = process.env.VISHU_WALLET_RPC_URL;
  process.env.VISHU_WALLET_RPC_URL = "http://rpc.test";
  const realFetch = globalThis.fetch;
  try {
    const c = { tools: new ToolRegistry(), rpc: new Registry(), bus: new EventBus(), workspaceDir: "." };
    await loadModules(MODULES, c, enabledModules({ VISHU_MODULES: "wallet" }));
    const send = c.tools.get("wallet_send_tx");

    let sentBody: any;
    globalThis.fetch = (async (_url: string, init: any) => {
      sentBody = JSON.parse(init.body);
      return { json: async () => ({ jsonrpc: "2.0", id: 1, result: "0xabc123" }) };
    }) as never;
    assert.equal(await send.run({ signed: "0x02deadbeef" }, {} as never), "0xabc123");
    assert.equal(sentBody.method, "eth_sendRawTransaction");
    assert.deepEqual(sentBody.params, ["0x02deadbeef"]);

    globalThis.fetch = (async () => ({ json: async () => ({ error: { message: "nonce too low" } }) })) as never;
    assert.match(await send.run({ signed: "0x02deadbeef" }, {} as never), /nonce too low/);

    assert.match(await send.run({ signed: "nothex" }, {} as never), /0x-prefixed hex/);
  } finally {
    globalThis.fetch = realFetch;
    if (prevUrl === undefined) delete process.env.VISHU_WALLET_RPC_URL;
    else process.env.VISHU_WALLET_RPC_URL = prevUrl;
  }
});

test("wallet: solana address + ed25519 signature verify, key never leaks", async () => {
  const seedHex = "01".repeat(32);
  const prev = process.env.VISHU_SOLANA_KEY;
  process.env.VISHU_SOLANA_KEY = seedHex;
  try {
    const c = { tools: new ToolRegistry(), rpc: new Registry(), bus: new EventBus(), workspaceDir: "." };
    await loadModules(MODULES, c, enabledModules({ VISHU_MODULES: "wallet" }));
    const seed = Uint8Array.from(Buffer.from(seedHex, "hex"));
    const expectedAddr = base58.encode(ed25519.getPublicKey(seed));

    assert.equal(await c.tools.get("solana_address").run({}, {} as never), expectedAddr);

    const sig = await c.tools.get("solana_sign_message").run({ message: "gm" }, {} as never);
    assert.equal(ed25519.verify(base58.decode(sig), new TextEncoder().encode("gm"), ed25519.getPublicKey(seed)), true);
    assert.ok(!sig.includes(seedHex));
  } finally {
    if (prev === undefined) delete process.env.VISHU_SOLANA_KEY;
    else process.env.VISHU_SOLANA_KEY = prev;
  }
});

test("wallet: btc segwit address matches the BIP173 vector; hash sig verifies; key never leaks", async () => {
  // privkey = 1 → pubkey is the secp256k1 generator G → BIP173 example address (independent vector).
  const keyHex = "00".repeat(31) + "01";
  const prev = process.env.VISHU_BTC_KEY;
  process.env.VISHU_BTC_KEY = keyHex;
  try {
    const c = { tools: new ToolRegistry(), rpc: new Registry(), bus: new EventBus(), workspaceDir: "." };
    await loadModules(MODULES, c, enabledModules({ VISHU_MODULES: "wallet" }));

    assert.equal(await c.tools.get("btc_address").run({}, {} as never), "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4");

    const hashHex = "ab".repeat(32);
    const sig = await c.tools.get("btc_sign_hash").run({ hash: hashHex }, {} as never);
    assert.match(sig, /^[0-9a-f]{128}$/i); // 64-byte compact
    const pub = secp256k1.getPublicKey(Uint8Array.from(Buffer.from(keyHex, "hex")), true);
    assert.equal(secp256k1.verify(Uint8Array.from(Buffer.from(sig, "hex")), Uint8Array.from(Buffer.from(hashHex, "hex")), pub), true);
    assert.ok(!sig.includes(keyHex));

    assert.match(await c.tools.get("btc_sign_hash").run({ hash: "tooshort" }, {} as never), /32-byte hex/);
  } finally {
    if (prev === undefined) delete process.env.VISHU_BTC_KEY;
    else process.env.VISHU_BTC_KEY = prev;
  }
});

test("wallet: unconfigured returns a clear error, not a crash", async () => {
  const prev = process.env.VISHU_WALLET_KEY;
  delete process.env.VISHU_WALLET_KEY;
  try {
    const c = { tools: new ToolRegistry(), rpc: new Registry(), bus: new EventBus(), workspaceDir: "." };
    await loadModules(MODULES, c, enabledModules({ VISHU_MODULES: "wallet" }));
    assert.match(await c.tools.get("wallet_address").run({}, {} as never), /not configured/);
  } finally {
    if (prev !== undefined) process.env.VISHU_WALLET_KEY = prev;
  }
});
