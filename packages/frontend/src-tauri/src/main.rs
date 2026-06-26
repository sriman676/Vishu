// Vishu harness — the native layer between the user and the AI (Phase 14 desktop shell, upgraded).
// It owns the core's lifecycle: spawns `vishu serve`, watches its stdout for readiness + the bearer
// token, restarts it on crash, and kills it on exit. The webview UI asks the harness for a ready
// session (`harness_session`) instead of making the user paste a token. All actual AI work — memory,
// skills, prompts, agent loops — stays in the TS core (locked decision: TS is the spine); the harness
// drives it over the existing vishu.* JSON-RPC, it does not reimplement it.
// ponytail: dev-shell path (`tauri dev`, Vite proxy handles /rpc + /events). Packaged-binary cross-origin
// (webview→core) is the named upgrade — either core CORS or a harness-side proxy; see PLAN Phase 14.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs;
use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::State;

/// What the UI needs to talk to the core: its base URL, bearer token, and whether both are known.
#[derive(Clone, Default, serde::Serialize)]
struct Session {
    base: String,
    token: String,
    ready: bool,
}

struct Harness {
    session: Mutex<Session>,
    child: Mutex<Option<Child>>,
    shutdown: AtomicBool,
}

#[tauri::command]
fn harness_session(h: State<Arc<Harness>>) -> Session {
    h.session.lock().unwrap().clone()
}

/// Spawn the core. `VISHU_BIN` overrides the launcher (dev: `node`); `VISHU_ARGS` overrides the args
/// (dev: the built `dist/bin/vishu.js serve`). Default = `vishu serve` from PATH.
fn spawn_core() -> std::io::Result<Child> {
    let bin = std::env::var("VISHU_BIN").unwrap_or_else(|_| "vishu".into());
    let mut cmd = Command::new(bin);
    match std::env::var("VISHU_ARGS") {
        Ok(args) => {
            cmd.args(args.split_whitespace());
        }
        Err(_) => {
            cmd.arg("serve");
        }
    }
    cmd.stdout(Stdio::piped()).stderr(Stdio::inherit());
    cmd.spawn()
}

/// Pull the base URL and token out of the core's startup lines:
///   "[serve] vishu <v> on http://127.0.0.1:5712"  and  "[serve] token: <path>"
fn parse_line(h: &Arc<Harness>, line: &str) {
    if let Some(idx) = line.find(" on http") {
        let base = line[idx + 4..].trim().to_string(); // skip " on "
        let mut s = h.session.lock().unwrap();
        s.base = base;
        s.ready = !s.token.is_empty();
    }
    if let Some(path) = line.strip_prefix("[serve] token: ") {
        if let Ok(tok) = fs::read_to_string(path.trim()) {
            let mut s = h.session.lock().unwrap();
            s.token = tok.trim().to_string();
            s.ready = !s.base.is_empty();
        }
    }
}

/// Supervisor loop: (re)spawn the core, stream its stdout, and restart on exit with capped backoff —
/// until the app shuts down. A crashed core never leaves the UI permanently dead.
fn supervise(h: Arc<Harness>) {
    let mut backoff = 1u64;
    while !h.shutdown.load(Ordering::Relaxed) {
        let mut child = match spawn_core() {
            Ok(c) => c,
            Err(e) => {
                eprintln!("[harness] spawn failed: {e}; retry in {backoff}s");
                thread::sleep(Duration::from_secs(backoff));
                backoff = (backoff * 2).min(30);
                continue;
            }
        };
        let stdout = child.stdout.take();
        *h.child.lock().unwrap() = Some(child);
        backoff = 1; // a clean spawn resets the backoff
        if let Some(out) = stdout {
            for line in BufReader::new(out).lines().map_while(Result::ok) {
                println!("[core] {line}");
                parse_line(&h, &line);
            }
        }
        // stdout closed => the core exited. Reap it and mark the session not-ready.
        if let Some(mut c) = h.child.lock().unwrap().take() {
            let _ = c.wait();
        }
        h.session.lock().unwrap().ready = false;
        if h.shutdown.load(Ordering::Relaxed) {
            break;
        }
        eprintln!("[harness] core exited; restarting in {backoff}s");
        thread::sleep(Duration::from_secs(backoff));
        backoff = (backoff * 2).min(30);
    }
}

fn main() {
    let harness = Arc::new(Harness {
        session: Mutex::new(Session::default()),
        child: Mutex::new(None),
        shutdown: AtomicBool::new(false),
    });
    let sup = harness.clone();
    thread::spawn(move || supervise(sup));

    let exit_harness = harness.clone();
    tauri::Builder::default()
        .manage(harness)
        .invoke_handler(tauri::generate_handler![harness_session])
        .build(tauri::generate_context!())
        .expect("error building vishu harness")
        .run(move |_app, event| {
            if let tauri::RunEvent::ExitRequested { .. } = event {
                exit_harness.shutdown.store(true, Ordering::Relaxed);
                if let Some(mut c) = exit_harness.child.lock().unwrap().take() {
                    let _ = c.kill(); // don't orphan the core when the window closes
                }
            }
        });
}
