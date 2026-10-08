// Correo transaccional (ADR-0022): cliente SMTP mínimo sin dependencias, portado del de
// tipify (mismo Google Workspace; en Hetzner los puertos 25/465 salientes están cerrados,
// así que va por 587 + STARTTLS). Solo envía los códigos de alta y de cambio de contraseña.
import { connect as netConnect, type Socket } from "node:net";
import { connect as tlsConnect, type TLSSocket } from "node:tls";

export interface MailerConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
  from: string; // RFC 5322, p. ej. "Reagent Lab <info@capybaralabs.tech>"
}

/** Sin SMTP_USER y SMTP_PASS devuelve null: el login con email queda desactivado. */
export function mailerFromEnv(env: NodeJS.ProcessEnv = process.env): MailerConfig | null {
  const user = env.SMTP_USER?.trim();
  const pass = env.SMTP_PASS?.trim();
  if (!user || !pass) return null;
  return {
    host: env.SMTP_HOST?.trim() || "smtp.gmail.com",
    port: Number(env.SMTP_PORT ?? 587),
    user,
    pass,
    from: env.MAIL_FROM?.trim() || `Reagent Lab <${user}>`,
  };
}


const bareAddress = (from: string): string => /<([^>]+)>/.exec(from)?.[1] ?? from;

function awaitReply(socket: Socket | TLSSocket): Promise<string> {
  return new Promise((resolve, reject) => {
    let buf = "";
    const onData = (d: Buffer) => {
      buf += d.toString("utf8");
      const lines = buf.split(/\r?\n/).filter(Boolean);
      if (lines.length && /^\d{3} /.test(lines[lines.length - 1]!)) {
        socket.off("data", onData);
        socket.off("error", reject);
        resolve(buf);
      }
    };
    socket.on("data", onData);
    socket.once("error", reject);
    socket.setTimeout(15_000, () => {
      socket.destroy();
      reject(new Error("SMTP reply timeout"));
    });
  });
}

async function command(socket: Socket | TLSSocket, line: string | null, expect: number): Promise<void> {
  const pending = awaitReply(socket);
  if (line !== null) socket.write(`${line}\r\n`);
  const r = await pending;
  if (!r.split(/\r?\n/).filter(Boolean).pop()!.startsWith(String(expect))) {
    throw new Error(`SMTP: expected ${expect} after ${line?.split(" ")[0] ?? "connect"}, got: ${r.trim().slice(0, 200)}`);
  }
}

/** Send one email. `html` switches the Content-Type; otherwise text/plain. */
export async function sendMail(
  cfg: MailerConfig,
  to: string,
  subject: string,
  body: string,
  html = false,
): Promise<void> {
  let socket: Socket | TLSSocket = await new Promise((resolve, reject) => {
    const opts = { host: cfg.host, port: cfg.port };
    const s: Socket | TLSSocket =
      cfg.port === 465
        ? tlsConnect({ ...opts, servername: cfg.host }, () => resolve(s))
        : netConnect(opts, () => resolve(s));
    s.once("error", reject);
    s.setTimeout(15_000, () => {
      s.destroy();
      reject(new Error("SMTP connect timeout"));
    });
  });
  try {
    await command(socket, null, 220);
    await command(socket, "EHLO reagentlab", 250);
    if (cfg.port !== 465) {
      await command(socket, "STARTTLS", 220);
      socket = await new Promise<TLSSocket>((resolve, reject) => {
        const s = tlsConnect({ socket, servername: cfg.host }, () => resolve(s));
        s.once("error", reject);
      });
      await command(socket, "EHLO reagentlab", 250);
    }
    await command(socket, `AUTH PLAIN ${Buffer.from(`\0${cfg.user}\0${cfg.pass}`).toString("base64")}`, 235);
    await command(socket, `MAIL FROM:<${bareAddress(cfg.from)}>`, 250);
    await command(socket, `RCPT TO:<${to}>`, 250);
    await command(socket, "DATA", 354);
    const headers = [
      `From: ${cfg.from}`,
      `To: ${to}`,
      `Subject: ${subject}`,
      `Date: ${new Date().toUTCString()}`,
      `Message-ID: <${Date.now()}.${Math.random().toString(36).slice(2)}@capybaralabs.tech>`,
      "MIME-Version: 1.0",
      `Content-Type: text/${html ? "html" : "plain"}; charset=utf-8`,
    ].join("\r\n");
    const dotStuffed = body.replace(/\r?\n/g, "\r\n").replace(/(^|\r\n)\./g, "$1..");
    await command(socket, `${headers}\r\n\r\n${dotStuffed}\r\n.`, 250);
    socket.write("QUIT\r\n");
  } finally {
    socket.destroy();
  }
}
