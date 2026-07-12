import { artifactsModule } from "./artifacts.js";
import { browserModule } from "./browser.js";
import { desktopModule } from "./desktop.js";
import { devopsModule } from "./devops.js";
import { glueModule } from "./glue.js";
import { imagegenModule } from "./imagegen.js";
import { pairingModule } from "./pairing.js";
import type { VishuModule } from "./registry.js";
import { reportModule } from "./report.js";
import { selfUpdateModule } from "./selfupdate.js";
import { voiceModule } from "./voice.js";
import { walletModule } from "./wallet.js";

/** Built-in optional modules — all off by default; enable via `VISHU_MODULES`. */
export const MODULES: VishuModule[] = [artifactsModule, browserModule, desktopModule, devopsModule, glueModule, imagegenModule, pairingModule, reportModule, selfUpdateModule, voiceModule, walletModule];
