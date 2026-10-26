import {
  loadKit,
  loadOpenAuth,
  invoke,
  describeOperations,
  envelope,
  KitError,
  type BiliKit,
  type Envelope,
} from "@bili-agent-kit/core";
import { runAuthCli, type AuthCliOptions } from "./auth.js";

export async function runCli(
  argv: string[],
  stdin: () => Promise<string>,
  load: (path?: string) => Promise<BiliKit> = loadKit,
  authOptions: AuthCliOptions = {},
): Promise<Envelope<unknown>> {
  if (argv.length === 1 && ["help", "--help", "list"].includes(argv[0] ?? ""))
    return {
      version: 1,
      ok: true,
      data: {
        usage:
          "bili-agent [--config <file>] <operation|auth.login|auth.status|auth.logout|auth.refresh-check|auth.refresh|open.auth.begin|open.auth.exchange|open.auth.refresh|open.auth.status|open.auth.logout|admin.approve|admin.reconcile|admin.resume> [<JSON|->]",
        auth: {
          "auth.login": { png: "optional new PNG path" },
          "auth.status": {},
          "auth.logout": {},
          "auth.refresh-check": {},
          "auth.refresh": {},
        },
        openAuth: {
          "open.auth.begin": { redirectUrl: "registered HTTPS callback URL" },
          "open.auth.exchange": {
            code: "authorization code; prefer stdin",
            state: "returned OAuth state",
          },
          "open.auth.refresh": {},
          "open.auth.status": {},
          "open.auth.logout": {},
        },
        operations: describeOperations(),
      },
    };
  return envelope(async () => {
    const explicit = argv[0] === "--config";
    const args = explicit ? argv.slice(2) : argv;
    if (
      (explicit && !argv[1]) ||
      args.length < 1 ||
      args.length > 2 ||
      !args[0] ||
      args[0].startsWith("-")
    )
      throw new KitError(
        "INVALID_INPUT",
        "Expected [--config <file>] <operation> [<JSON|->]. Use help for schemas.",
      );
    const config = explicit ? argv[1] : undefined;
    const [name, argument] = args;
    const raw = argument === "-" ? await stdin() : (argument ?? "{}");
    if (raw.length > 1024 * 1024) throw new KitError("INVALID_INPUT", "JSON input exceeds 1 MiB.");
    let input: unknown;
    try {
      input = JSON.parse(raw);
    } catch {
      throw new KitError("INVALID_INPUT", "Input must be valid JSON.");
    }
    if (name?.startsWith("auth.")) return runAuthCli(config, name, input, authOptions);
    if (name?.startsWith("open.auth.")) return (await loadOpenAuth(config)).call(name, input);
    const kit = await load(config);
    if (name?.startsWith("admin.")) {
      if (!input || typeof input !== "object" || Array.isArray(input))
        throw new KitError("INVALID_INPUT", "Admin input must be an object.");
      const obj = input as Record<string, unknown>;
      const exact = (keys: string[]) =>
        Object.keys(obj).length === keys.length && keys.every((k) => typeof obj[k] === "string");
      if (name === "admin.approve" && exact(["draftId", "digest", "by"]))
        return kit.admin.approve(String(obj.draftId), String(obj.digest), String(obj.by));
      if (
        name === "admin.reconcile" &&
        exact(["draftId", "outcome"]) &&
        (obj.outcome === "sent" || obj.outcome === "not-sent")
      )
        return kit.admin.reconcile(String(obj.draftId), obj.outcome);
      if (name === "admin.resume" && exact([])) return kit.admin.resumeAccount();
      throw new KitError("INVALID_INPUT", "Unknown administrator command or invalid arguments.");
    }
    const result = await invoke(kit, name ?? "", input);
    if (!result.ok) throw new KitError(result.error.code, result.error.message);
    return result.data;
  });
}
