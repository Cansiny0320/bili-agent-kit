import type { StateStore } from "./state.js";
import { KitError } from "./errors.js";

/** Call only after verifying this exact session with Bilibili. Contains no secret values. */
export async function bindIdentity(
  store: StateStore,
  fingerprint: string,
  uid: string,
  now = Date.now(),
): Promise<string> {
  const account = `uid:${uid}`;
  await store.transaction((state) => {
    const bound = state.identities[fingerprint];
    if (bound && bound !== uid) throw new KitError("STATE_INVALID", "Session identity changed.");
    const hasLegacyCursor = Object.keys(state.cursors).some((key) =>
      key.startsWith(`${fingerprint}:`),
    );
    if (
      bound &&
      !state.traffic.accounts[fingerprint] &&
      !state.traffic.manual[fingerprint] &&
      !hasLegacyCursor
    )
      return;
    if (state.traffic.active && state.traffic.active.until > now)
      throw new KitError("STATE_BUSY", "Wait for active requests before migrating login state.");
    delete state.traffic.active;
    for (const key of Object.keys(state.cursors)) {
      if (!key.startsWith(`${fingerprint}:`)) continue;
      const target = account + key.slice(fingerprint.length);
      if (state.cursors[target])
        throw new KitError(
          "STATE_INVALID",
          "Legacy cursor conflicts with account state; administrator review required.",
        );
      state.cursors[target] = state.cursors[key]!;
      delete state.cursors[key];
    }
    const legacy = state.traffic.accounts[fingerprint];
    const current = state.traffic.accounts[account];
    if (legacy) {
      // Conservatively retain both windows; never refresh a budget during migration.
      state.traffic.accounts[account] = current
        ? {
            hourAt: Math.max(current.hourAt, legacy.hourAt),
            dayAt: Math.max(current.dayAt, legacy.dayAt),
            readHour: current.readHour + legacy.readHour,
            readDay: current.readDay + legacy.readDay,
            writeHour: current.writeHour + legacy.writeHour,
            writeDay: current.writeDay + legacy.writeDay,
            lastWrite: Math.max(current.lastWrite, legacy.lastWrite),
          }
        : legacy;
      delete state.traffic.accounts[fingerprint];
    }
    if (state.traffic.manual[fingerprint]) state.traffic.manual[account] = true;
    delete state.traffic.manual[fingerprint];
    state.identities[fingerprint] = uid;
  });
  return account;
}
