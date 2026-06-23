import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";
import { readFileSync } from "node:fs";
import { ed25519 } from "@noble/curves/ed25519.js";
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { ripemd160 } from "@noble/hashes/legacy.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { base58, bech32 } from "@scure/base";
import { privateKeyToAccount } from "viem/accounts";
import type { VishuModule } from "./registry.js";

/** Solana ed25519 seed (32 bytes). Accepts a base58 64-byte secret (Phantom export), a base58 32-byte
 * seed, or a 32-byte hex seed. Loaded at call time, never returned. */
function loadSolanaSeed(env = process.env): Uint8Array {
  const raw = env.VISHU_SOLANA_KEY?.trim();
  if (!raw) throw new Error("set VISHU_SOLANA_KEY (base58 64-byte secret, or 32-byte hex/base58 seed)");
  let bytes = /^[0-9a-fA-F]{64}$/.test(raw) ? Uint8Array.from(Buffer.from(raw, "hex")) : base58.decode(raw);
  if (bytes.length === 64) bytes = bytes.slice(0, 32); // 64-byte secret = [seed||pubkey]
  if (bytes.length !== 32) throw new Error("invalid Solana key (need a 32-byte seed or 64-byte secret)");
  return bytes;
}

/** BTC secp256k1 private key (32-byte hex). Loaded at call time, never returned. */
function loadBtcKey(env = process.env): Uint8Array {
  const hex = env.VISHU_BTC_KEY?.trim().replace(/^0x/, "");
  if (!hex) throw new Error("set VISHU_BTC_KEY (32-byte hex private key)");
  if (!/^[0-9a-fA-F]{64}$/.test(hex)) throw new Error("invalid BTC private key (expected 32-byte hex)");
  return Uint8Array.from(Buffer.from(hex, "hex"));
}

/** Encrypted-at-rest keystore for a private key. scrypt(passphrase) → AES-256-GCM. Dependency-free
 * (Node stdlib). ponytail: passphrase comes from env today — the OS keychain is the named upgrade for
 * holding the passphrase/keystore so it never sits in a shell profile. */
export interface Keystore {
  v: 1;
  salt: string;
  iv: string;
  tag: string;
  ct: string;
}

export function encryptKeystore(privateKey: string, passphrase: string): Keystore {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(privateKey, "utf8"), cipher.final()]);
  return { v: 1, salt: salt.toString("hex"), iv: iv.toString("hex"), tag: cipher.getAuthTag().toString("hex"), ct: ct.toString("hex") };
}

export function decryptKeystore(ks: Keystore, passphrase: string): string {
  const key = scryptSync(passphrase, Buffer.from(ks.salt, "hex"), 32);
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(ks.iv, "hex"));
  d.setAuthTag(Buffer.from(ks.tag, "hex")); // tampered ciphertext/passphrase → final() throws, never returns garbage
  return Buffer.concat([d.update(Buffer.from(ks.ct, "hex")), d.final()]).toString("utf8");
}

/** Load the signing key from a secure source, at call time. Encrypted keystore preferred; a raw
 * `VISHU_WALLET_KEY` is a documented dev fallback. The returned key is used only inside a signing tool
 * and is NEVER returned to the model, logged, or put in a tool result. */
function loadPrivateKey(env = process.env): `0x${string}` {
  let raw: string | undefined;
  if (env.VISHU_WALLET_KEYSTORE) {
    if (!env.VISHU_WALLET_PASSPHRASE) throw new Error("VISHU_WALLET_PASSPHRASE required to unlock the keystore");
    raw = decryptKeystore(JSON.parse(readFileSync(env.VISHU_WALLET_KEYSTORE, "utf8")) as Keystore, env.VISHU_WALLET_PASSPHRASE);
  } else {
    raw = env.VISHU_WALLET_KEY;
  }
  if (!raw) throw new Error("wallet not configured: set VISHU_WALLET_KEYSTORE+VISHU_WALLET_PASSPHRASE, or VISHU_WALLET_KEY");
  const key = (raw.startsWith("0x") ? raw : `0x${raw}`).trim();
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("invalid private key (expected 32-byte hex)");
  return key as `0x${string}`;
}

/** Phase 12 wallet/web3 module (flag: `wallet`). EVM signing via viem. The private key is loaded inside
 * each tool, used to sign, and discarded — only the public address and signatures ever leave. Keys never
 * enter the model context. ponytail: EVM message signing first; tx signing + BTC/Solana are the next layers. */
export const walletModule: VishuModule = {
  name: "wallet",
  setup({ tools }) {
    tools.register({
      name: "wallet_address",
      description: "Return the EVM address of the configured wallet (public; never reveals the key).",
      parameters: { type: "object", properties: {} },
      run: async () => {
        try {
          return privateKeyToAccount(loadPrivateKey()).address;
        } catch (e) {
          return `error: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    });
    tools.register({
      name: "wallet_sign_message",
      description: "Sign a plaintext message (EIP-191) and return the signature. Never reveals the key.",
      parameters: { type: "object", properties: { message: { type: "string" } }, required: ["message"] },
      run: async (args) => {
        const message = String(args.message ?? "");
        if (!message) return "error: message is required";
        try {
          return await privateKeyToAccount(loadPrivateKey()).signMessage({ message });
        } catch (e) {
          return `error: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    });
    tools.register({
      name: "wallet_sign_tx",
      description:
        "Sign an EIP-1559 EVM transaction OFFLINE and return the raw signed tx hex (broadcast it with " +
        "wallet_send_tx). All amounts are wei strings (decimal, no float). nonce/gas must be supplied — " +
        "there is no network here. Never reveals the key.",
      parameters: {
        type: "object",
        properties: {
          chainId: { type: "number" },
          to: { type: "string" },
          value: { type: "string", description: "wei, decimal string" },
          nonce: { type: "number" },
          gas: { type: "string", description: "gas limit, decimal string" },
          maxFeePerGas: { type: "string", description: "wei, decimal string" },
          maxPriorityFeePerGas: { type: "string", description: "wei, decimal string" },
          data: { type: "string", description: "0x-prefixed calldata (optional)" },
        },
        required: ["chainId", "to", "value", "nonce", "gas", "maxFeePerGas", "maxPriorityFeePerGas"],
      },
      run: async (args) => {
        try {
          const to = String(args.to ?? "");
          if (!/^0x[0-9a-fA-F]{40}$/.test(to)) return "error: invalid 'to' address";
          const data = args.data === undefined ? undefined : String(args.data);
          if (data !== undefined && !/^0x[0-9a-fA-F]*$/.test(data)) return "error: invalid 'data' hex";
          // bigint parse rejects floats/garbage → fails closed on a money field
          const value = BigInt(String(args.value));
          const gas = BigInt(String(args.gas));
          const maxFeePerGas = BigInt(String(args.maxFeePerGas));
          const maxPriorityFeePerGas = BigInt(String(args.maxPriorityFeePerGas));
          return await privateKeyToAccount(loadPrivateKey()).signTransaction({
            type: "eip1559",
            chainId: Number(args.chainId),
            to: to as `0x${string}`,
            value,
            nonce: Number(args.nonce),
            gas,
            maxFeePerGas,
            maxPriorityFeePerGas,
            ...(data ? { data: data as `0x${string}` } : {}),
          });
        } catch (e) {
          return `error: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    });
    tools.register({
      name: "wallet_send_tx",
      description:
        "Broadcast a raw signed tx (from wallet_sign_tx) to VISHU_WALLET_RPC_URL via eth_sendRawTransaction. " +
        "Returns the tx hash. IRREVERSIBLE — moves real funds.",
      parameters: { type: "object", properties: { signed: { type: "string" } }, required: ["signed"] },
      run: async (args) => {
        const signed = String(args.signed ?? "");
        if (!/^0x[0-9a-fA-F]+$/.test(signed)) return "error: 'signed' must be 0x-prefixed hex";
        const url = process.env.VISHU_WALLET_RPC_URL;
        if (!url) return "error: set VISHU_WALLET_RPC_URL to broadcast";
        try {
          const res = await fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_sendRawTransaction", params: [signed] }),
          });
          const body = (await res.json()) as { result?: string; error?: { message?: string } };
          if (body.error) return `error: rpc: ${body.error.message ?? JSON.stringify(body.error)}`;
          if (!body.result) return "error: rpc returned no tx hash";
          return body.result;
        } catch (e) {
          return `error: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    });
    // --- Solana (ed25519) ---
    tools.register({
      name: "solana_address",
      description: "Return the base58 Solana address of the configured key (public; never reveals the key).",
      parameters: { type: "object", properties: {} },
      run: async () => {
        try {
          return base58.encode(ed25519.getPublicKey(loadSolanaSeed()));
        } catch (e) {
          return `error: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    });
    tools.register({
      name: "solana_sign_message",
      description: "Sign a UTF-8 message with the Solana key (ed25519); returns a base58 signature. Never reveals the key.",
      parameters: { type: "object", properties: { message: { type: "string" } }, required: ["message"] },
      run: async (args) => {
        const message = String(args.message ?? "");
        if (!message) return "error: message is required";
        try {
          return base58.encode(ed25519.sign(new TextEncoder().encode(message), loadSolanaSeed()));
        } catch (e) {
          return `error: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    });
    // --- Bitcoin (secp256k1) ---
    tools.register({
      name: "btc_address",
      description: "Return the native-segwit (P2WPKH, bc1…) address of the configured BTC key. Public; never reveals the key.",
      parameters: { type: "object", properties: {} },
      run: async () => {
        try {
          const pub = secp256k1.getPublicKey(loadBtcKey(), true); // compressed
          const h160 = ripemd160(sha256(pub));
          return bech32.encode("bc", [0, ...bech32.toWords(h160)]); // witness v0
        } catch (e) {
          return `error: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    });
    tools.register({
      name: "btc_sign_hash",
      description:
        "Sign a 32-byte hash (hex) with the BTC key (ECDSA secp256k1, low-s); returns a compact-hex signature " +
        "— the primitive a PSBT input signer needs. Never reveals the key. ponytail: DER+sighash-byte wrapping " +
        "for a full PSBT is the named upgrade.",
      parameters: { type: "object", properties: { hash: { type: "string", description: "32-byte hash, hex" } }, required: ["hash"] },
      run: async (args) => {
        const hex = String(args.hash ?? "").replace(/^0x/, "");
        if (!/^[0-9a-fA-F]{64}$/.test(hex)) return "error: 'hash' must be a 32-byte hex string";
        try {
          return Buffer.from(secp256k1.sign(Uint8Array.from(Buffer.from(hex, "hex")), loadBtcKey())).toString("hex");
        } catch (e) {
          return `error: ${e instanceof Error ? e.message : String(e)}`;
        }
      },
    });
  },
};
