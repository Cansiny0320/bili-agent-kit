import { API, BiliClient, type Session } from "./client.js";
import type { WriteAction } from "./contracts.js";
import { libraryActionSchema, folderSnapshot, type LibraryAction } from "./library-actions.js";
import { KitError } from "./errors.js";
import { object } from "./traffic.js";
import { upstreamId } from "./references.js";
import type { Step } from "./write-actions.js";

export const isLibrary = (action: WriteAction): action is LibraryAction =>
  libraryActionSchema.safeParse(action).success;
async function folder(client: BiliClient, session: Session, folderId: string) {
  const data = object(
    await client.get("/x/v3/fav/folder/info", { media_id: folderId }, false, API, session),
  );
  if (`uid:${String(object(data.upper).mid)}` !== session.account || String(data.id) !== folderId)
    throw new KitError("FORBIDDEN", "Favorite folder must belong to the authenticated account.");
  return data;
}
function snapshot(data: Record<string, unknown>) {
  const result = folderSnapshot.safeParse({
    title: data.title,
    intro: data.intro,
    cover: data.cover,
    privacy: Number(data.attr) & 1,
  });
  if (!result.success) throw new KitError("UPSTREAM", "Folder details are incomplete.");
  return result.data;
}
export async function bindLibrary(
  client: BiliClient,
  action: WriteAction,
  session: Session,
): Promise<WriteAction> {
  if (action.kind !== "favorite.folder_edit") return action;
  if ([action.title, action.intro, action.cover, action.privacy].every((v) => v === undefined))
    throw new KitError("INVALID_INPUT", "Specify at least one folder field to edit.");
  const expected = snapshot(await folder(client, session, action.folderId));
  return {
    ...action,
    title: action.title ?? expected.title,
    intro: action.intro ?? expected.intro,
    cover: action.cover ?? expected.cover,
    privacy: action.privacy ?? expected.privacy,
    expected,
  };
}
export async function libraryMembers(
  client: BiliClient,
  session: Session,
  folderId?: string,
): Promise<string[]> {
  const members: string[] = [],
    cursors = new Set<string>();
  let next = "",
    split = "";
  for (let page = 1; page <= 20; page++) {
    const data = object(
      await client.get(
        folderId ? "/x/v3/fav/resource/list" : "/x/v2/history/toview/v2/list",
        folderId
          ? {
              media_id: folderId,
              pn: page,
              ps: 50,
              order: "mtime",
              type: 0,
              tid: 0,
              platform: "web",
            }
          : { start_key: next, split_key: split, asc: "false", sort_field: 0 },
        false,
        API,
        session,
      ),
    );
    const rows = folderId ? data.medias : data.list;
    if (rows !== null && !Array.isArray(rows))
      throw new KitError("UPSTREAM", "Missing library items.");
    for (const raw of rows ?? []) {
      const row = object(raw);
      if (!folderId || row.type === 2) members.push(upstreamId(folderId ? row.id : row.aid));
    }
    if (data.has_more === false || data.has_more === 0) return members;
    if (data.has_more !== true && data.has_more !== 1)
      throw new KitError("UPSTREAM", "Missing library pagination status.");
    if (!folderId) {
      const cursor = (value: unknown) => {
        if (value === undefined || value === null) return "";
        if (typeof value === "string") return value;
        if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
        throw new KitError("UPSTREAM", "Invalid library pagination cursor.");
      };
      next = cursor(data.next_key);
      split = cursor(data.split_key);
      if (!next || cursors.has(next)) throw new KitError("UPSTREAM", "Library pagination stalled.");
      cursors.add(next);
    }
  }
  throw new KitError("UPSTREAM", "Library exceeds the twenty-page verification limit.");
}
export async function libraryPreflight(
  client: BiliClient,
  action: LibraryAction,
  session: Session,
): Promise<void> {
  if (action.kind === "favorite.folder_create" && session.account !== `uid:${action.uid}`)
    throw new KitError("FORBIDDEN", "Folder owner must match the authenticated account.");
  if ("folderId" in action) {
    const current = await folder(client, session, action.folderId);
    if (
      action.kind === "favorite.folder_edit" &&
      (!action.expected || JSON.stringify(snapshot(current)) !== JSON.stringify(action.expected))
    )
      throw new KitError("CONFLICT", "Folder details changed; prepare and approve a new edit.");
  }
  if ("sourceFolderId" in action) {
    if (action.sourceFolderId === action.folderId)
      throw new KitError("INVALID_INPUT", "Source and destination folders must differ.");
    await folder(client, session, action.sourceFolderId);
    const members = await libraryMembers(client, session, action.sourceFolderId);
    if (!action.aids.every((aid) => members.includes(aid)))
      throw new KitError("CONFLICT", "Some requested videos are missing from the source folder.");
  }
  if (action.kind === "watch_later.move") {
    const members = await libraryMembers(client, session);
    if (!action.aids.every((aid) => members.includes(aid)))
      throw new KitError("CONFLICT", "Some requested videos are missing from watch later.");
  }
  if (action.kind === "favorite.sort") {
    const members = await libraryMembers(client, session, action.folderId);
    if (
      action.aid === action.afterAid ||
      !members.includes(action.aid) ||
      !members.includes(action.afterAid)
    )
      throw new KitError("INVALID_INPUT", "Both different videos must belong to this folder.");
  }
}
export async function executeLibrary(
  client: BiliClient,
  action: LibraryAction,
  session: Session,
  draftId: string,
  step: Step,
): Promise<unknown> {
  const send = (path: string, fields: Record<string, string>) =>
    step("send", () =>
      client.post(path, { ...fields, csrf: session.credentials!.bili_jct }, API, session, draftId),
    );
  let result: unknown;
  if (action.kind === "favorite.folder_create" || action.kind === "favorite.folder_edit") {
    result = await send(
      `/x/v3/fav/folder/${action.kind === "favorite.folder_create" ? "add" : "edit"}`,
      {
        title: action.title!,
        intro: action.intro!,
        cover: action.cover!,
        privacy: String(action.privacy),
        ...(action.kind === "favorite.folder_edit" ? { media_id: action.folderId } : {}),
      },
    );
    const folderId =
      action.kind === "favorite.folder_create" ? upstreamId(object(result).id) : action.folderId;
    const current = snapshot(await folder(client, session, folderId));
    if (
      ["title", "intro", "cover", "privacy"].some(
        (key) => current[key as keyof typeof current] !== action[key as keyof typeof current],
      )
    )
      throw new KitError("UNKNOWN_OUTCOME", "Folder readback differs from the approved fields.");
    return { result, verified: true, folderId, fields: current };
  }
  if (action.kind === "favorite.sort") {
    result = await send("/x/v3/fav/resource/sort", {
      media_id: action.folderId,
      sort: `${action.afterAid}:2:${action.aid}:2`,
    });
    const ordered = await libraryMembers(client, session, action.folderId);
    if (
      ordered.indexOf(action.aid) !== ordered.indexOf(action.afterAid) + 1 ||
      !ordered.includes(action.afterAid)
    )
      throw new KitError("UNKNOWN_OUTCOME", "Folder ordering could not be verified.");
    return { result, verified: true, aid: action.aid, afterAid: action.afterAid };
  }
  if (action.kind === "watch_later.batch_add") {
    result = await send("/x/v3/fav/toview/adds", {
      resources: action.aids.map((aid) => `${aid}:2`).join(","),
      toview_version: "v2",
    });
  } else if (action.kind === "watch_later.move") {
    result = await send("/x/v2/history/toview/move", {
      resources: action.aids.join(","),
      tar_media_id: action.folderId,
    });
  } else {
    result = await send(`/x/v3/fav/resource/${action.kind === "favorite.copy" ? "copy" : "move"}`, {
      resources: action.aids.map((aid) => `${aid}:2`).join(","),
      src_media_id: action.sourceFolderId,
      tar_media_id: action.folderId,
      ...(action.kind === "favorite.copy" ? { mid: session.account.slice(4) } : {}),
    });
  }
  const destination = await libraryMembers(
    client,
    session,
    action.kind === "watch_later.batch_add" ? undefined : action.folderId,
  );
  const source =
    action.kind === "favorite.move" || action.kind === "favorite.copy"
      ? await libraryMembers(client, session, action.sourceFolderId)
      : action.kind === "watch_later.move"
        ? await libraryMembers(client, session)
        : undefined;
  const items = action.aids.map((aid) => ({
    aid,
    destination: destination.includes(aid),
    ...(source ? { source: source.includes(aid) } : {}),
  }));
  await step("verify", async () => ({ items }));
  if (
    items.some(
      (item) => !item.destination || (source && item.source !== (action.kind === "favorite.copy")),
    )
  )
    throw new KitError(
      "UNKNOWN_OUTCOME",
      "Some library changes could not be verified; inspect both lists before reconciliation.",
    );
  return { result, verified: true, items };
}
