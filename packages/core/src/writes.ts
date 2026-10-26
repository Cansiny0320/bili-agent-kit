import { z } from "zod";
import {
  actionSchema,
  parse,
  targetOf,
  type Draft,
  type WriteAction,
  type WriteActionInput,
} from "./contracts.js";
import { BiliClient, API, LIVE, VC, scrub, type Session } from "./client.js";
import { KitError } from "./errors.js";
import { object } from "./traffic.js";
import { digest } from "./wbi.js";
import type { StateStore } from "./state.js";
import { isOpenAction, type OpenPlatform } from "./open-platform.js";
import { legacyActionKinds } from "./actions.js";
import {
  bindAttachments,
  executeExtended,
  extendedPreflight,
  isExtended,
  type Step,
} from "./write-actions.js";

export class Writes {
  #client: BiliClient;
  #store: StateStore;
  constructor(
    client: BiliClient,
    store: StateStore,
    private readonly mediaRoot?: string,
    private readonly openPlatform?: OpenPlatform,
  ) {
    this.#client = client;
    this.#store = store;
  }
  async #session(action: WriteAction): Promise<Session> {
    if (isOpenAction(action)) {
      if (!this.openPlatform)
        throw new KitError("AUTH_REQUIRED", "Open platform is not configured.");
      const session = await this.openPlatform.session(this.openPlatform.scope(action));
      if (session.authorization.uid !== action.uid)
        throw new KitError("FORBIDDEN", "Open platform target account does not match.");
      return session;
    }
    return this.#client.session(true);
  }
  async #bind(action: WriteAction): Promise<WriteAction> {
    if (isOpenAction(action)) {
      if (!this.openPlatform)
        throw new KitError("AUTH_REQUIRED", "Open platform is not configured.");
      return this.openPlatform.bind(action);
    }
    return bindAttachments(action, this.mediaRoot);
  }
  preview(input: WriteActionInput): {
    action: WriteAction;
    target: string;
    writesEnabled: boolean;
  } {
    const action = parse(actionSchema, input);
    return { action, target: targetOf(action), writesEnabled: this.#client.policy.writesEnabled };
  }
  checkPolicy(action: WriteAction): void {
    const p = this.#client.policy;
    if (!this.#store.durable)
      throw new KitError("FORBIDDEN", "External writes require durable state.");
    if (!p.writesEnabled || !p.allowedTargets.includes(targetOf(action)))
      throw new KitError("FORBIDDEN", "Writing is disabled or the target is not allowed.");
    if (!legacyActionKinds.includes(action.kind) && !p.allowedActions.includes(action.kind))
      throw new KitError("FORBIDDEN", "This write action must be explicitly enabled.");
    if (action.kind === "dm.send") this.#client.requireTrustedDm(action.uid);
  }
  async prepare(input: WriteActionInput, key: string): Promise<Draft> {
    let action = parse(actionSchema, input);
    parse(z.string().regex(/^[A-Za-z0-9_.:-]{1,128}$/), key);
    this.checkPolicy(action);
    action = await this.#bind(action);
    const session = await this.#session(action);
    const hash = digest(JSON.stringify({ account: session.fingerprint, action }));
    const draftId = digest(`${session.fingerprint}:${key}`);
    const draft = await this.#store.transaction((state) => {
      const old = state.drafts[draftId];
      if (old) {
        if (old.digest !== hash)
          throw new KitError("CONFLICT", "Idempotency key already belongs to different content.");
        return old;
      }
      if (Object.keys(state.drafts).length >= 10000)
        throw new KitError(
          "STATE_BUSY",
          "Draft storage limit reached; archive state with administrator review.",
        );
      const now = this.#client.traffic.clock.now();
      const draft: Draft = {
        id: draftId,
        key,
        account: session.fingerprint,
        digest: hash,
        action,
        createdAt: now,
        expiresAt: now + 3600000,
        status: "draft",
        steps: {},
      };
      state.drafts[draftId] = draft;
      return draft;
    });
    return publicDraft(draft);
  }
  async #inspect(draftId: string): Promise<Draft> {
    parse(z.string().regex(/^[a-f0-9]{64}$/), draftId);
    const draft = (await this.#store.snapshot()).drafts[draftId];
    if (!draft) throw new KitError("NOT_FOUND", "Draft not found.");
    const s = await this.#session(draft.action);
    if (draft.account !== s.fingerprint)
      throw new KitError("FORBIDDEN", "Draft belongs to a different account.");
    return draft;
  }
  async inspect(draftId: string): Promise<Draft> {
    return publicDraft(await this.#inspect(draftId));
  }
  async #preflight(action: WriteAction, s: Session): Promise<Record<string, string>> {
    if (isOpenAction(action)) return {};
    const nav = object(await this.#client.get("/x/web-interface/nav", {}, false, API, s));
    if (
      nav.isLogin !== true ||
      !(
        (typeof nav.mid === "string" && /^[1-9]\d*$/.test(nav.mid)) ||
        (typeof nav.mid === "number" && Number.isSafeInteger(nav.mid) && nav.mid > 0)
      )
    )
      throw new KitError("AUTH_REQUIRED", "Account login could not be verified.");
    if (s.account !== `uid:${String(nav.mid)}`)
      throw new KitError("AUTH_REQUIRED", "Verified account changed; sign in again.");
    const csrf = s.credentials?.bili_jct;
    if (!csrf) throw new KitError("AUTH_REQUIRED", "CSRF credential missing.");
    if (isExtended(action)) return {};
    if (action.kind === "dm.send") {
      const relation = object(
        await this.#client.get("/x/relation", { fid: action.uid }, false, API, s),
      );
      if (relation.attribute !== 6)
        throw new KitError("FORBIDDEN", "DM requires a verified mutual follow.");
      const state = await this.#store.snapshot();
      return {
        "msg[sender_uid]": String(nav.mid),
        "msg[receiver_id]": action.uid,
        "msg[receiver_type]": "1",
        "msg[msg_type]": "1",
        "msg[msg_status]": "0",
        "msg[timestamp]": String(Math.floor(this.#client.traffic.clock.now() / 1000)),
        "msg[dev_id]": state.deviceId,
        "msg[content]": JSON.stringify({ content: action.text }),
        csrf,
      };
    }
    if (action.kind === "live.send") {
      const room = object(
        await this.#client.get(
          "/room/v1/Room/get_info",
          { room_id: action.roomId },
          false,
          LIVE,
          s,
        ),
      );
      if (String(room.room_id) !== action.roomId)
        throw new KitError("FORBIDDEN", "Use the canonical room ID in both draft and allowlist.");
      return {
        roomid: action.roomId,
        msg: action.text,
        csrf,
        csrf_token: csrf,
        rnd: String(Math.floor(this.#client.traffic.clock.now() / 1000)),
        fontsize: "25",
        color: "16777215",
        mode: "1",
        bubble: "0",
        room_type: "0",
        jumpfrom: "0",
        statistics: JSON.stringify({ appId: 100, platform: 5 }),
      };
    }
    if (action.kind === "comment.delete")
      return { type: "1", oid: action.oid, rpid: action.rpid, csrf };
    return {
      type: "1",
      oid: action.oid,
      message: action.text,
      plat: "1",
      csrf,
      ...(action.root ? { root: action.root } : {}),
      ...(action.parent ? { parent: action.parent } : {}),
    };
  }
  async execute(draftId: string): Promise<Draft> {
    const draft = await this.#inspect(draftId);
    this.checkPolicy(draft.action);
    if (draft.status === "sent") return publicDraft(draft);
    this.#assertApproved(draft);
    const s = await this.#session(draft.action);
    if (s.fingerprint !== draft.account)
      throw new KitError("FORBIDDEN", "Account changed; prepare a new draft.");
    await this.#bind(draft.action);
    const fields = await this.#preflight(draft.action, s);
    const pics = isExtended(draft.action)
      ? await extendedPreflight(this.#client, draft.action, s)
      : [];
    await this.#store.transaction((state) => {
      const current = state.drafts[draftId];
      if (!current) throw new KitError("NOT_FOUND", "Draft not found.");
      this.#assertApproved(current);
      current.status = "sending";
    });
    const kind = draft.action.kind;
    const step: Step = async (name, run) => {
      const old = await this.#store.transaction((state) => {
        const current = state.drafts[draftId];
        if (!current) throw new KitError("STATE_INVALID", "Reserved draft missing.");
        const previous = current.steps[name];
        if (previous?.status === "pending")
          throw new KitError("UNKNOWN_OUTCOME", "Step outcome requires reconciliation.");
        if (previous?.status === "done") return previous;
        current.steps[name] = { status: "pending" };
        return undefined;
      });
      if (old) return old.result;
      try {
        const result = await run();
        await this.#store.transaction((state) => {
          state.drafts[draftId]!.steps[name] = { status: "done", result };
        });
        return result;
      } catch (error) {
        if (
          error instanceof KitError &&
          ["RATE_LIMITED", "TRAFFIC_PAUSED", "UPSTREAM"].includes(error.code)
        )
          await this.#store.transaction((state) => {
            state.drafts[draftId]!.steps[name] = { status: "failed" };
          });
        throw error;
      }
    };
    try {
      const result = isOpenAction(draft.action)
        ? await this.openPlatform!.execute(draft.action, s, draftId, step)
        : isExtended(draft.action)
          ? await executeExtended(
              this.#client,
              draft.action,
              s,
              draftId,
              step,
              pics,
              this.mediaRoot,
            )
          : await step("send", () =>
              this.#client.post(
                kind === "dm.send"
                  ? "/web_im/v1/web_im/send_msg"
                  : kind === "live.send"
                    ? "/msg/send"
                    : kind === "comment.delete"
                      ? "/x/v2/reply/del"
                      : "/x/v2/reply/add",
                fields,
                kind === "dm.send" ? VC : kind === "live.send" ? LIVE : API,
                s,
                draftId,
              ),
            );
      return publicDraft(
        await this.#store.transaction((state) => {
          const current = state.drafts[draftId];
          if (!current) throw new KitError("STATE_INVALID", "Reserved draft missing.");
          current.status = "sent";
          current.result = result;
          return current;
        }),
      );
    } catch (error) {
      const definite =
        error instanceof KitError &&
        ["RATE_LIMITED", "TRAFFIC_PAUSED", "UPSTREAM"].includes(error.code);
      await this.#store.transaction((state) => {
        const current = state.drafts[draftId];
        if (current) current.status = definite ? "rejected" : "unknown";
      });
      if (!definite)
        throw new KitError(
          "UNKNOWN_OUTCOME",
          "Send outcome unknown; administrator reconciliation required.",
        );
      throw error;
    }
  }
  #assertApproved(draft: Draft): void {
    if (draft.status === "sending" || draft.status === "unknown")
      throw new KitError("UNKNOWN_OUTCOME", "Previous send may have succeeded; do not retry.");
    if (
      draft.status !== "approved" ||
      draft.approval?.digest !== draft.digest ||
      draft.expiresAt <= this.#client.traffic.clock.now()
    )
      throw new KitError("APPROVAL_REQUIRED", "A current administrator approval is required.");
    if (digest(JSON.stringify({ account: draft.account, action: draft.action })) !== draft.digest)
      throw new KitError("CONFLICT", "Draft content changed.");
  }
}
/** Trusted host capability. Never register these methods as model-facing tools. */
export class Administrator {
  #writes: Writes;
  #client: BiliClient;
  #store: StateStore;
  constructor(writes: Writes, client: BiliClient, store: StateStore) {
    this.#writes = writes;
    this.#client = client;
    this.#store = store;
  }
  async approve(draftId: string, expectedDigest: string, by: string): Promise<Draft> {
    parse(z.string().trim().min(1).max(100), by);
    const draft = await this.#writes.inspect(draftId);
    this.#writes.checkPolicy(draft.action);
    const approved = await this.#store.transaction((state) => {
      const current = state.drafts[draftId];
      if (!current) throw new KitError("NOT_FOUND", "Draft not found.");
      if (
        current.digest !== expectedDigest ||
        digest(JSON.stringify({ account: current.account, action: current.action })) !==
          expectedDigest
      )
        throw new KitError("CONFLICT", "Review digest does not match immutable content.");
      if (
        !["draft", "approved", "rejected"].includes(current.status) ||
        current.expiresAt <= this.#client.traffic.clock.now()
      )
        throw new KitError("CONFLICT", "Draft cannot be approved in its current state.");
      current.status = "approved";
      current.approval = { digest: expectedDigest, by, at: this.#client.traffic.clock.now() };
      return current;
    });
    return publicDraft(approved);
  }
  async reconcile(draftId: string, outcome: "sent" | "not-sent"): Promise<Draft> {
    parse(z.enum(["sent", "not-sent"]), outcome);
    await this.#writes.inspect(draftId);
    const reconciled = await this.#store.transaction((state) => {
      const draft = state.drafts[draftId];
      if (!draft || !["unknown", "sending"].includes(draft.status))
        throw new KitError("CONFLICT", "Only uncertain sends can be reconciled.");
      draft.status = outcome === "sent" ? "sent" : "draft";
      delete draft.approval;
      if (outcome === "not-sent") {
        draft.expiresAt = this.#client.traffic.clock.now() + 3600000;
        for (const [name, step] of Object.entries(draft.steps))
          if (step.status === "pending") delete draft.steps[name];
      }
      return draft;
    });
    return publicDraft(reconciled);
  }
  async resumeAccount(): Promise<{ resumed: true }> {
    const s = await this.#client.session(true);
    await this.#store.transaction((state) => {
      delete state.traffic.manual[s.account];
    });
    return { resumed: true };
  }
}

function publicDraft(draft: Draft): Draft {
  const secrets: Record<string, string> = {};
  for (const [name, step] of Object.entries(draft.steps)) {
    if (
      step.result &&
      typeof step.result === "object" &&
      "upload_token" in step.result &&
      typeof step.result.upload_token === "string"
    )
      secrets[name] = step.result.upload_token;
  }
  return scrub(draft, secrets) as Draft;
}
