import { artifactsModule } from "./artifacts.js";
import { desktopModule } from "./desktop.js";
import { imagegenModule } from "./imagegen.js";
import { pairingModule } from "./pairing.js";
import type { VishuModule } from "./registry.js";
import { selfUpdateModule } from "./selfupdate.js";
import { voiceModule } from "./voice.js";
import { walletModule } from "./wallet.js";

/** Built-in optional modules — all off by default; enable via `VISHU_MODULES`. */
export const MODULES: VishuModule[] = [artifactsModule, desktopModule, imagegenModule, pairingModule, selfUpdateModule, voiceModule, walletModule];
