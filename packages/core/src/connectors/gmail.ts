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
