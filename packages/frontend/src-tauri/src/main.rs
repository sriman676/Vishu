// Vishu desktop shell (Phase 14). Thin Tauri host: spawns the core (`vishu serve`) as a sidecar and
// hosts the same React UI that the browser/PWA uses — all app↔core traffic stays on the vishu.* RPC.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri_plugin_shell::ShellExt;

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // Start the core. Override the binary with VISHU_BIN; otherwise rely on `vishu` on PATH.
            let bin = std::env::var("VISHU_BIN").unwrap_or_else(|_| "vishu".into());
            if let Err(e) = app.shell().command(bin).args(["serve"]).spawn() {
                eprintln!("[vishu-desktop] failed to spawn core: {e}");
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running vishu desktop");
}
