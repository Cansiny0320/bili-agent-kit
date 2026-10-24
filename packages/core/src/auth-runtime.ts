import { QrLogin, checkCancelled, type QrChallenge, type LoginAccount } from "./auth.js";
import { FileCredentials } from "./credentials.js";
import { bindIdentity } from "./identity.js";
import { digest } from "./wbi.js";
import { KitError } from "./errors.js";
import type { StateStore } from "./state.js";
import type { Credentials } from "./contracts.js";

export interface LoginOptions {
  signal?: AbortSignal;
  onQr: (qr: QrChallenge) => Promise<void>;
  onStatus?: (status: "waiting" | "scanned") => void;
}
/** Filesystem orchestration for trusted CLI/SDK hosts. Results never contain credentials. */
export class FileAuth {
  constructor(
    readonly credentials: FileCredentials,
    readonly store: StateStore,
    readonly protocol = new QrLogin(),
  ) {}
  async #bind(credentials: Credentials, account: LoginAccount): Promise<void> {
    await bindIdentity(
      this.store,
      digest(credentials.sessdata),
      account.uid,
      this.protocol.clock.now(),
    );
  }
  async login(options: LoginOptions): Promise<{ authenticated: true; account: LoginAccount }> {
    let account: LoginAccount | undefined;
    await this.credentials.update(async (previous) => {
      checkCancelled(options.signal);
      // Establish old ownership before replacing the only copy of an unmapped session.
      if (previous) {
        const key = digest(previous.sessdata);
        const state = await this.store.snapshot();
        const needsMigration =
          state.traffic.accounts[key] ||
          state.traffic.manual[key] ||
          Object.keys(state.cursors).some((k) => k.startsWith(`${key}:`));
        if (!state.identities[key] && needsMigration)
          await this.#bind(previous, await this.protocol.verify(previous, options.signal));
      }
      const state = await this.store.snapshot();
      const anonymous = digest("anonymous");
      const legacyKeys = [
        ...Object.keys(state.traffic.accounts),
        ...Object.keys(state.traffic.manual),
        ...Object.keys(state.cursors).map((k) => k.split(":")[0]!),
      ];
      if (
        legacyKeys.some((k) => /^[a-f0-9]{64}$/.test(k) && k !== anonymous && !state.identities[k])
      )
        throw new KitError(
          "STATE_INVALID",
          "Unmapped legacy account state requires administrator review before login replacement.",
        );
      const qr = await this.protocol.generate(options.signal);
      await options.onQr(qr);
      for (;;) {
        const result = await this.protocol.poll(qr, options.signal);
        if (result.status === "expired")
          throw new KitError("AUTH_REQUIRED", "QR code expired; start login again.");
        if (result.status === "success") {
          checkCancelled(options.signal);
          await this.#bind(result.credentials, result.account);
          checkCancelled(options.signal);
          account = result.account;
          return result.credentials;
        }
        options.onStatus?.(result.status);
      }
    });
    if (!account) throw new KitError("AUTH_REQUIRED", "Login did not complete.");
    return { authenticated: true, account };
  }
  async status(
    signal?: AbortSignal,
  ): Promise<{ authenticated: false } | { authenticated: true; account: LoginAccount }> {
    const credentials = await this.credentials.read();
    if (!credentials) return { authenticated: false };
    let account: LoginAccount;
    try {
      account = await this.protocol.verify(credentials, signal);
    } catch (error) {
      if (error instanceof KitError && error.code === "AUTH_REQUIRED")
        return { authenticated: false };
      throw error;
    }
    await this.#bind(credentials, account);
    return { authenticated: true, account };
  }
  async logout(): Promise<{ authenticated: false }> {
    await this.credentials.update(async () => undefined);
    return { authenticated: false };
  }
}
