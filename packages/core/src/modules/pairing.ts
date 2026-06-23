import { randomBytes } from "node:crypto";
import type { VishuModule } from "./registry.js";

const TTL_MS = 5 * 60_000;

/** Device pairing (dependency-free): a short single-use code with a 5-minute TTL, for a future
 * mobile/desktop companion to pair to this core. ponytail: in-memory, single-process — back it with
 * the OS keychain or a file if pairings must survive a restart. */
export const pairingModule: VishuModule = {
  name: "pairing",
  setup({ tools }) {
    const codes = new Map<string, number>(); // code -> expiry epoch ms
    tools.register({
      name: "pair_request",
      description: "Issue a one-time device-pairing code (valid 5 minutes).",
      parameters: { type: "object", properties: {} },
      run: async () => {
        const code = randomBytes(4).toString("hex");
        codes.set(code, Date.now() + TTL_MS);
        return code;
      },
    });
    tools.register({
      name: "pair_verify",
      description: "Verify and consume a device-pairing code.",
      parameters: { type: "object", properties: { code: { type: "string" } }, required: ["code"] },
      run: async (args) => {
        const code = String(args.code ?? "");
        const exp = codes.get(code);
        if (exp === undefined) return "invalid";
        codes.delete(code); // single-use
        return exp < Date.now() ? "expired" : "ok";
      },
    });
  },
};
