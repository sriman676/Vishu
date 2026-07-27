import { artifactsModule } from "./artifacts.js";
import { browserModule } from "./browser.js";
import { dailyModule } from "./daily.js";
import { desktopModule } from "./desktop.js";
import { devopsModule } from "./devops.js";
import { fileIndexModule } from "./fileindex.js";
import { glueModule } from "./glue.js";
import { imagegenModule } from "./imagegen.js";
import { monitorModule } from "./monitor.js";
import { pairingModule } from "./pairing.js";
import { reachModule } from "./reach.js";
import type { VishuModule } from "./registry.js";
import { reportModule } from "./report.js";
import { selfUpdateModule } from "./selfupdate.js";
import { voiceModule } from "./voice.js";
import { walletModule } from "./wallet.js";

/** Built-in optional modules — all off by default; enable via `VISHU_MODULES`. */
export const MODULES: VishuModule[] = [artifactsModule, browserModule, dailyModule, desktopModule, devopsModule, fileIndexModule, glueModule, imagegenModule, monitorModule, pairingModule, reachModule, reportModule, selfUpdateModule, voiceModule, walletModule];
