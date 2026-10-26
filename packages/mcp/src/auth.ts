import QRCode from "qrcode";
import {
  envelope,
  KitError,
  type FileAuth,
  type Envelope,
  type MediaImage,
} from "@bili-agent-kit/core";

interface Session {
  controller: AbortController;
  ready: Promise<void>;
  done: Promise<void>;
  active: boolean;
  status: "starting" | "waiting" | "scanned";
  expiresAt?: number;
  image?: MediaImage;
  result?: Envelope<unknown>;
}

/** One bounded, phone-confirmed login per MCP connection. No raw credentials leave FileAuth. */
export class McpAuth {
  #session?: Session;
  constructor(readonly auth: Pick<FileAuth, "login" | "status">) {}

  async login() {
    if (!this.#session?.active) {
      let ready!: () => void;
      const session: Session = {
        controller: new AbortController(),
        ready: new Promise<void>((resolve) => {
          ready = resolve;
        }),
        done: Promise.resolve(),
        active: true,
        status: "starting",
      };
      this.#session = session;
      let expired = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      session.done = (async () => {
        session.result = await envelope(async () => {
          const current = await this.auth.status(session.controller.signal);
          if (current.authenticated) return current;
          return this.auth.login({
            signal: session.controller.signal,
            onQr: async (qr) => {
              const png = await QRCode.toBuffer(qr.url, { type: "png", margin: 4, scale: 6 });
              if (session.controller.signal.aborted)
                throw new KitError("CANCELLED", "Login cancelled.");
              session.expiresAt = qr.expiresAt;
              session.image = {
                type: "image",
                mimeType: "image/png",
                data: png.toString("base64"),
              };
              session.status = "waiting";
              timer = setTimeout(() => {
                expired = true;
                session.controller.abort();
              }, 180000);
              timer.unref();
              ready();
            },
            onStatus: (status) => {
              session.status = status;
            },
          });
        });
        if (expired)
          session.result = {
            version: 1,
            ok: false,
            error: { code: "AUTH_REQUIRED", message: "QR code expired; start login again." },
          };
        else if (
          session.controller.signal.aborted &&
          !session.result.ok &&
          session.result.error.code === "CANCELLED"
        )
          session.result = { version: 1, ok: true, data: { status: "cancelled" } };
        session.active = false;
        delete session.image;
        if (timer) clearTimeout(timer);
        ready();
      })();
    }
    const session = this.#session;
    await session.ready;
    return { result: this.#view(session), ...(session.image ? { image: session.image } : {}) };
  }

  #view(session: Session): Envelope<unknown> {
    return (
      session.result ?? {
        version: 1,
        ok: true,
        data: {
          status: session.status,
          ...(session.expiresAt ? { expiresAt: session.expiresAt } : {}),
        },
      }
    );
  }

  async status(): Promise<Envelope<unknown>> {
    const session = this.#session;
    if (session?.active) return this.#view(session);
    const current = await envelope(() => this.auth.status());
    if (!current.ok || current.data.authenticated) return current;
    return session?.result && !session.result.ok ? session.result : current;
  }

  async cancel(): Promise<Envelope<unknown>> {
    const session = this.#session;
    if (!session?.active) return this.status();
    session.controller.abort();
    await session.done;
    return this.#view(session);
  }

  async close(): Promise<void> {
    const session = this.#session;
    if (session?.active) {
      session.controller.abort();
      await session.done;
    }
  }
}
