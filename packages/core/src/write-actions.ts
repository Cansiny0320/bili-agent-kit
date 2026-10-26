import { z } from "zod";
import { extendedActionSchema, type ExtendedAction } from "./actions.js";
import { type WriteAction } from "./contracts.js";
import { API, VC, BiliClient, type Session } from "./client.js";
import { localFile, imageType } from "./files.js";
import { object } from "./traffic.js";
import { upstream } from "./models.js";
import { KitError } from "./errors.js";
import { isLibrary, libraryPreflight, executeLibrary, libraryMembers } from "./library.js";

export type Step = (name: string, run: () => Promise<unknown>) => Promise<unknown>;
export const isExtended = (action: WriteAction): action is ExtendedAction =>
  extendedActionSchema.safeParse(action).success;

export async function bindAttachments(action: WriteAction, root?: string): Promise<WriteAction> {
  if (!("images" in action) || !action.images) return action;
  const images = [];
  for (const image of action.images) {
    const file = await localFile(root, image.file, 10 * 1024 * 1024, image.sha256);
    imageType(file.bytes);
    images.push({ file: file.path, sha256: file.sha256 });
  }
  return { ...action, images };
}

export async function extendedPreflight(
  client: BiliClient,
  action: ExtendedAction,
  s: Session,
): Promise<Record<string, unknown>[]> {
  if (isLibrary(action)) {
    await libraryPreflight(client, action, s);
    return [];
  }
  if (action.kind === "dynamic.create" && s.account !== `uid:${action.uid}`)
    throw new KitError("FORBIDDEN", "Dynamic author must match the authenticated account.");
  if (action.kind === "favorite.add" || action.kind === "favorite.remove") {
    const folder = object(
      await client.get("/x/v3/fav/folder/info", { media_id: action.folderId }, false, API, s),
    );
    if (`uid:${String(object(folder.upper).mid)}` !== s.account)
      throw new KitError("FORBIDDEN", "Favorite folder must belong to the authenticated account.");
  }
  if (action.kind === "video.danmaku") {
    const view = object(
      await client.get("/x/web-interface/view", { aid: action.aid }, false, API, s),
    );
    if (
      String(view.aid) !== action.aid ||
      !Array.isArray(view.pages) ||
      !view.pages.some((p) => String(object(p).cid) === action.cid)
    )
      throw new KitError("INVALID_INPUT", "Danmaku cid does not belong to the requested video.");
  }
  if (action.kind === "dynamic.edit" || action.kind === "dynamic.delete") {
    const detail = object(
      await client.get(
        "/x/polymer/web-dynamic/v1/detail",
        { id: action.dynamicId, features: "itemOpusStyle" },
        false,
        API,
        s,
      ),
    );
    const item = object(detail.item),
      modules = object(item.modules);
    if (
      String(item.id_str) !== action.dynamicId ||
      `uid:${String(object(modules.module_author).mid)}` !== s.account
    )
      throw new KitError("FORBIDDEN", "Dynamic must belong to the authenticated account.");
    if (action.kind === "dynamic.edit") {
      if (!["DYNAMIC_TYPE_WORD", "DYNAMIC_TYPE_DRAW"].includes(String(item.type)))
        throw new KitError("INVALID_INPUT", "Only text and image dynamics can be edited.");
      const major = object(object(modules.module_dynamic).major ?? {});
      const content = object(major.opus ?? major.draw ?? {});
      const pics = content.pics ?? content.items ?? [];
      if (!Array.isArray(pics)) throw new KitError("UPSTREAM", "Invalid dynamic images.");
      return pics.map((p) => {
        const image = object(p);
        return {
          img_src: image.url ?? image.src,
          img_width: image.width,
          img_height: image.height,
        };
      });
    }
  }
  return [];
}

export async function executeExtended(
  client: BiliClient,
  action: ExtendedAction,
  s: Session,
  draftId: string,
  step: Step,
  existingPics: Record<string, unknown>[],
  root?: string,
): Promise<unknown> {
  if (isLibrary(action)) return executeLibrary(client, action, s, draftId, step);
  const csrf = s.credentials?.bili_jct ?? "";
  const post = (path: string, fields: Record<string, string>, origin = API) =>
    step("send", () => client.post(path, { ...fields, csrf }, origin, s, draftId));
  switch (action.kind) {
    case "watch_later.add":
    case "watch_later.remove": {
      const add = action.kind === "watch_later.add";
      const result = await post(
        add ? "/x/v2/history/toview/add" : "/x/v2/history/toview/v2/dels",
        add ? { aid: action.aid } : { resources: action.aid },
      );
      const present = (await libraryMembers(client, s)).includes(action.aid);
      await step("verify", async () => ({ aid: action.aid, present }));
      if (present !== add)
        throw new KitError(
          "UNKNOWN_OUTCOME",
          "Watch later readback did not confirm the requested change.",
        );
      return { result, verified: true, aid: action.aid, present };
    }
    case "video.like":
      return post("/x/web-interface/archive/like", {
        aid: action.aid,
        like: action.enabled ? "1" : "2",
      });
    case "video.coin":
      return post("/x/web-interface/coin/add", {
        aid: action.aid,
        multiply: String(action.count),
        select_like: action.like ? "1" : "0",
      });
    case "video.triple":
      return post("/x/web-interface/archive/like/triple", { aid: action.aid });
    case "favorite.add":
    case "favorite.remove":
      return post("/x/v3/fav/resource/deal", {
        rid: action.aid,
        type: "2",
        add_media_ids: action.kind === "favorite.add" ? action.folderId : "",
        del_media_ids: action.kind === "favorite.remove" ? action.folderId : "",
      });
    case "user.follow":
    case "user.unfollow":
      return post("/x/relation/modify", {
        fid: action.uid,
        act: action.kind === "user.follow" ? "1" : "2",
        re_src: "11",
      });
    case "comment.like":
      return post("/x/v2/reply/action", {
        oid: action.oid,
        rpid: action.rpid,
        type: "1",
        action: action.enabled ? "1" : "0",
      });
    case "video.danmaku":
      return post("/x/v2/dm/post", {
        type: "1",
        oid: action.cid,
        aid: action.aid,
        progress: String(action.progressMs),
        color: String(action.color),
        fontsize: String(action.fontSize),
        mode: String(action.mode),
        pool: "0",
        msg: action.text,
        rnd: String(Math.floor(client.traffic.clock.now() / 1000)),
      });
    case "dynamic.delete":
      return post(
        "/dynamic_svr/v1/dynamic_svr/rm_dynamic",
        { dynamic_id: action.dynamicId, csrf_token: csrf },
        VC,
      );
    case "dynamic.create":
    case "dynamic.edit": {
      const pics: Record<string, unknown>[] = action.images === undefined ? existingPics : [];
      for (const [i, image] of (action.images ?? []).entries()) {
        const file = await localFile(root, image.file, 10 * 1024 * 1024, image.sha256);
        const result = await step(`image:${i}`, () => {
          const data = new FormData();
          data.set(
            "file_up",
            new Blob([new Uint8Array(file.bytes)], { type: imageType(file.bytes) }),
            "image",
          );
          data.set("category", "daily");
          data.set("csrf", csrf);
          return client.postBody("/x/dynamic/feed/draw/upload_bfs", data, s, draftId);
        });
        const uploaded = upstream(
          z.object({
            image_url: z.string().url(),
            image_width: z.number().positive(),
            image_height: z.number().positive(),
          }),
          result,
        );
        pics.push({
          img_src: uploaded.image_url,
          img_width: uploaded.image_width,
          img_height: uploaded.image_height,
          img_size: file.bytes.length / 1024,
        });
      }
      const dyn_req = {
        scene: 2,
        content: { contents: [{ raw_text: action.text, type: 1, biz_id: "" }] },
        ...(pics.length ? { pics } : {}),
        meta: { app_meta: { from: "create.dynamic.web", mobi_app: "web" } },
      };
      const editing = action.kind === "dynamic.edit";
      if (editing) {
        // The edit endpoint can accept unchecked content without preserving its text.
        await step("submit_check", () =>
          client.postBody(
            `/x/dynamic/feed/create/submit_check?csrf=${encodeURIComponent(csrf)}`,
            {
              dyn_id_str: action.dynamicId,
              content: dyn_req.content,
              scene: dyn_req.scene,
              ...(pics.length ? { pics } : {}),
            },
            s,
            draftId,
          ),
        );
      }
      return step("send", () =>
        client.postBody(
          `/x/dynamic/feed/${editing ? "edit" : "create"}/dyn?platform=web`,
          { dyn_req, ...(editing ? { dyn_id_str: action.dynamicId } : {}) },
          s,
          draftId,
          true,
        ),
      );
    }
  }
}
