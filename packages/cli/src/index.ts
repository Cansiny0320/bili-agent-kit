import {
  loadKit,
  invoke,
  describeOperations,
  envelope,
  KitError,
  type BiliKit,
  type Envelope,
} from "@bili-agent-kit/core";

export async function runCli(
  argv: string[],
  stdin: () => Promise<string>,
  load: (path: string) => Promise<BiliKit> = loadKit,
): Promise<Envelope<unknown>> {
  if (argv.length === 1 && ["help", "--help", "list"].includes(argv[0] ?? ""))
    return {
      version: 1,
      ok: true,
      data: {
        usage:
          "bili-agent --config config.local.json <operation|admin.approve|admin.reconcile|admin.resume> <JSON|->",
        operations: describeOperations(),
      },
    };
  return envelope(async () => {
    if (argv[0] !== "--config" || !argv[1] || !argv[2] || argv.length !== 4)
      throw new KitError(
        "INVALID_INPUT",
        "Expected --config <file> <operation> <JSON|->. Use help for schemas.",
      );
    const [, , name, argument] = argv;
    const raw = argument === "-" ? await stdin() : (argument ?? "");
    if (raw.length > 1024 * 1024) throw new KitError("INVALID_INPUT", "JSON input exceeds 1 MiB.");
    let input: unknown;
    try {
      input = JSON.parse(raw);
    } catch {
      throw new KitError("INVALID_INPUT", "Input must be valid JSON.");
    }
    const kit = await load(argv[1]);
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
