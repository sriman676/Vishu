import { connect, type TLSSocket } from "node:tls";
import { hostname } from "node:os";
import type { Connector } from "./types.js";

/** Zero-dep Gmail over the raw SMTP/IMAP protocols on node:tls — the repo stays lean (no nodemailer/imap
 * deps) and app-password auth needs no OAuth. Outbound = SMTP submission (465, implicit TLS); inbound =
 * a minimal IMAP UNSEEN poll (993). Both are money/trust paths, so errors surface loudly, never silently. */

/** Read one SMTP reply, coalescing multiline `NNN-` continuations until the final `NNN ` line. */
function readReply(sock: TLSSocket): Promise<{ code: number; text: string }> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const onData = (d: Buffer) => {
      buf += d.toString("utf8");
      const lines = buf.split(/\r?\n/).filter(Boolean);
      const last = lines[lines.length - 1];
      if (last && /^\d{3} /.test(last)) {
        cleanup();
        resolve({ code: Number(last.slice(0, 3)), text: buf });
      }
    };
    const onErr = (e: Error) => (cleanup(), reject(e));
    const cleanup = () => {
      sock.off("data", onData);
      sock.off("error", onErr);
    };
    sock.on("data", onData);
    sock.on("error", onErr);
  });
}

async function cmd(sock: TLSSocket, line: string, ...expect: number[]): Promise<void> {
  sock.write(line + "\r\n");
  const r = await readReply(sock);
  if (!expect.includes(r.code)) throw new Error(`SMTP "${line.split(" ")[0]}" got ${r.code}: ${r.text.trim()}`);
}

/** RFC 5321 dot-stuffing: any body line starting with "." gets an extra "." so it isn't read as end-of-data. */
export function dotStuff(body: string): string {
  return body.replace(/\r?\n/g, "\r\n").replace(/^\./gm, "..");
}

/** Assemble a minimal but valid RFC 5322 message (UTF-8 plain text). */
export function buildMessage(from: string, to: string, subject: string, body: string): string {
  const headers = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@${hostname()}>`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="utf-8"',
    "Content-Transfer-Encoding: 8bit",
  ].join("\r\n");
  return `${headers}\r\n\r\n${dotStuff(body)}`;
}

/** Send one message via Gmail SMTP submission (implicit TLS on 465) using an app password. */
export async function sendSmtp(user: string, pass: string, to: string, subject: string, body: string, host = "smtp.gmail.com", port = 465): Promise<void> {
  const sock = connect({ host, port, servername: host });
  await new Promise<void>((res, rej) => {
    sock.once("secureConnect", res);
    sock.once("error", rej);
  });
  try {
    await readReply(sock); // 220 greeting
    await cmd(sock, `EHLO ${hostname()}`, 250);
    await cmd(sock, "AUTH LOGIN", 334);
    await cmd(sock, Buffer.from(user).toString("base64"), 334);
    await cmd(sock, Buffer.from(pass).toString("base64"), 235);
    await cmd(sock, `MAIL FROM:<${user}>`, 250);
    await cmd(sock, `RCPT TO:<${to}>`, 250, 251);
    await cmd(sock, "DATA", 354);
    sock.write(buildMessage(user, to, subject, body) + "\r\n.\r\n");
    const r = await readReply(sock);
    if (r.code !== 250) throw new Error(`SMTP DATA got ${r.code}: ${r.text.trim()}`);
    await cmd(sock, "QUIT", 221).catch(() => {});
  } finally {
    sock.end();
  }
}

// ── Inbound: Gmail POP3 (pop.gmail.com:995). POP3 is line-based (+OK/-ERR, RETR body ends on a lone "."),
// so a zero-dep hand-rolled client is far more robust than parsing IMAP's literal grammar — and it meets
// the same intent: pull new mail and feed the daily-driver. Dedup is by UIDL against a caller-held set.

/** Minimal buffered line reader over a TLS socket: one CRLF line, or a POP3 multiline block ending `.`. */
function popReader(sock: TLSSocket) {
  let buf = "";
  let onData: (() => void) | undefined;
  sock.on("data", (d: Buffer) => {
    buf += d.toString("utf8");
    onData?.();
  });
  const wait = (ready: () => number) =>
    new Promise<string>((resolve, reject) => {
      const tryTake = () => {
        const end = ready();
        if (end >= 0) {
          const out = buf.slice(0, end);
          buf = buf.slice(end);
          onData = undefined;
          resolve(out);
        }
      };
      onData = tryTake;
      sock.once("error", reject);
      tryTake();
    });
  return {
    /** One status line (up to and including CRLF). */
    line: () => wait(() => { const i = buf.indexOf("\r\n"); return i < 0 ? -1 : i + 2; }),
    /** A multiline body: everything up to a line containing only ".". */
    body: () => wait(() => { const i = buf.indexOf("\r\n.\r\n"); return i < 0 ? -1 : i + 5; }),
  };
}

/** Parse a raw RFC822 message into from/subject/body. Un-dot-stuffs body lines (POP3 doubles leading dots). */
export function parseMessage(raw: string): { from: string; subject: string; text: string } {
  const sep = raw.search(/\r?\n\r?\n/);
  const head = sep < 0 ? raw : raw.slice(0, sep);
  const body = sep < 0 ? "" : raw.slice(sep).replace(/^\r?\n\r?\n/, "");
  const h = (name: string) => new RegExp(`^${name}:\\s*(.+)$`, "im").exec(head)?.[1]?.trim() ?? "";
  return { from: h("From"), subject: h("Subject"), text: body.replace(/^\.\./gm, ".").trim() };
}

export interface FetchedMail {
  uid: string;
  from: string;
  subject: string;
  text: string;
}

/** Fetch messages whose UIDL is not in `seen` via Gmail POP3. Non-destructive (no DELE) — Gmail keeps the
 * mail; dedup is the caller's `seen` set. `limit` caps work per poll. Throws loudly on protocol errors. */
export async function fetchPop3(user: string, pass: string, seen: Set<string>, limit = 10, host = "pop.gmail.com", port = 995): Promise<FetchedMail[]> {
  const sock = connect({ host, port, servername: host });
  await new Promise<void>((res, rej) => {
    sock.once("secureConnect", res);
    sock.once("error", rej);
  });
  const r = popReader(sock);
  const ok = (l: string, what: string) => {
    if (!l.startsWith("+OK")) throw new Error(`POP3 ${what} failed: ${l.trim()}`);
  };
  const out: FetchedMail[] = [];
  try {
    ok(await r.line(), "greeting");
    sock.write(`USER ${user}\r\n`);
    ok(await r.line(), "USER");
    sock.write(`PASS ${pass}\r\n`);
    ok(await r.line(), "PASS");
    // UIDL → "+OK" then "<n> <uid>" lines terminated by ".".
    sock.write("UIDL\r\n");
    ok(await r.line(), "UIDL");
    const uidl = await r.body();
    const nums: { n: string; uid: string }[] = [];
    for (const ln of uidl.split(/\r?\n/)) {
      const m = /^(\d+)\s+(\S+)/.exec(ln);
      if (m && !seen.has(m[2]!)) nums.push({ n: m[1]!, uid: m[2]! });
    }
    for (const { n, uid } of nums.slice(-limit)) {
      sock.write(`RETR ${n}\r\n`);
      ok(await r.line(), `RETR ${n}`);
      const raw = (await r.body()).replace(/\r\n\.\r\n$/, "");
      out.push({ uid, ...parseMessage(raw) });
    }
    sock.write("QUIT\r\n");
    await r.line().catch(() => "");
  } finally {
    sock.end();
  }
  return out;
}

/** A reply's text may carry a `Subject: ...` first line (the daily-driver draft doesn't); split it out. */
function splitSubject(text: string): [string, string] {
  const m = /^Subject:\s*(.+)\r?\n([\s\S]*)$/.exec(text);
  return m ? [m[1]!.trim(), m[2]!.trimStart()] : ["Message from Vishu", text];
}

/** Real Gmail connector (app-password SMTP). Same `Connector` seam as the stub: `configured` gates it, and
 * an unconfigured/misconfigured lane throws so it never silently drops mail. Reads GMAIL_USER +
 * GMAIL_APP_PASSWORD. Send stays behind the F0 send-class gate (approval + audit) at the RPC layer. */
export class GmailConnector implements Connector {
  readonly channel = "email";
  constructor(
    private readonly user = process.env.GMAIL_USER,
    private readonly pass = process.env.GMAIL_APP_PASSWORD,
  ) {}
  get configured(): boolean {
    return Boolean(this.user && this.pass);
  }
  async send(to: string, text: string): Promise<void> {
    if (!this.user || !this.pass) throw new Error("[email] not configured — set GMAIL_USER + GMAIL_APP_PASSWORD in .env");
    const [subject, body] = splitSubject(text);
    await sendSmtp(this.user, this.pass, to, subject, body);
  }
}
