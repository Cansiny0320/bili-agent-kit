import { createHash, createHmac, randomUUID } from "node:crypto";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { basename, extname } from "node:path";
import { z } from "zod";
import { id, bvid, parse, type WriteAction } from "./contracts.js";
import { scrub, type Session } from "./client.js";
import { Traffic, object } from "./traffic.js";
import { digest } from "./wbi.js";
import { KitError } from "./errors.js";
import { localFile, imageType } from "./files.js";
import { openActionSchema, type OpenAction } from "./open-actions.js";
import type { Step } from "./write-actions.js";

const MEMBER = "https://member.bilibili.com";
export const openCredentialSchema = z.strictObject({
  clientId: z.string().min(1).max(256),
  appSecret: z.string().min(1).max(4096),
  accessToken: z.string().min(1).max(4096),
  uid: id,
  scopes: z.array(z.string()).max(100),
  expiresAt: z.number().int().positive().optional(),
});
export type OpenCredentials = z.output<typeof openCredentialSchema>;
export interface OpenOptions {
  credentials: () => Promise<OpenCredentials | undefined>;
  maxUploadBytes?: number;
}
interface OpenSession extends Session {
  authorization: OpenCredentials;
}
export const isOpenAction = (action: WriteAction): action is OpenAction =>
  openActionSchema.safeParse(action).success;
const page = z.number().int().min(1).max(10000).default(1),
  size = z.number().int().min(1).max(50).default(20);
export const openInputs = {
  open_video_list: z.strictObject({
    page,
    size,
    status: z.enum(["all", "is_pubing", "pubed", "not_pubed"]).default("all"),
  }),
  open_video: z.strictObject({ resourceId: bvid }),
  open_video_categories: z.strictObject({}),
  open_article_list: z.strictObject({
    page,
    size,
    sort: z.number().int().min(1).max(6).default(1),
    group: z.number().int().min(0).max(3).default(0),
    category: z.number().int().nonnegative().default(0),
  }),
  open_article: z.strictObject({ articleId: id }),
  open_article_categories: z.strictObject({}),
} as const;
export type OpenName = keyof typeof openInputs;
export type OpenArguments<K extends OpenName> = z.input<(typeof openInputs)[K]>;
export function signOpen(
  credentials: OpenCredentials,
  body: string,
  now: number,
  nonce: string = randomUUID(),
): Record<string, string> {
  const headers: Record<string, string> = {
    "x-bili-accesskeyid": credentials.clientId,
    "x-bili-content-md5": createHash("md5").update(body).digest("hex"),
    "x-bili-signature-method": "HMAC-SHA256",
    "x-bili-signature-nonce": nonce,
    "x-bili-signature-version": "2.0",
    "x-bili-timestamp": String(Math.floor(now / 1000)),
  };
  const canonical = Object.keys(headers)
    .sort()
    .map((key) => `${key}:${headers[key]}`)
    .join("\n");
  return {
    ...headers,
    authorization: createHmac("sha256", credentials.appSecret).update(canonical).digest("hex"),
    "access-token": credentials.accessToken,
    accept: "application/json",
  };
}

// The article API documents GET form bodies, which native fetch rejects.
function openFetcher(fetcher: typeof fetch): typeof fetch {
  if (fetcher !== globalThis.fetch) return fetcher;
  return async (input, init) => {
    if (init?.method !== "GET" || !init.body) return fetcher(input, init);
    const url = new URL(input instanceof Request ? input.url : input);
    if (
      url.origin !== MEMBER ||
      !url.pathname.startsWith("/arcopen/fn/article/") ||
      !(init.body instanceof Uint8Array)
    )
      throw new KitError("FORBIDDEN", "Unsupported GET body destination.");
    const headers = Object.fromEntries(new Headers(init.headers));
    headers["content-length"] = String(init.body.byteLength);
    return new Promise<Response>((resolve, reject) => {
      const request = httpsRequest(
        url,
        { method: "GET", headers, ...(init.signal ? { signal: init.signal } : {}) },
        (response) => {
          const responseHeaders = new Headers();
          for (const [key, value] of Object.entries(response.headers))
            if (value !== undefined)
              for (const item of Array.isArray(value) ? value : [value])
                responseHeaders.append(key, item);
          resolve(
            new Response(Readable.toWeb(response) as ReadableStream<Uint8Array>, {
              status: response.statusCode ?? 502,
              headers: responseHeaders,
            }),
          );
        },
      );
      request.once("error", reject);
      request.end(init.body);
    });
  };
}
export class OpenPlatform {
  readonly traffic: Traffic;
  constructor(
    traffic: Traffic,
    readonly options?: OpenOptions,
    readonly mediaRoot?: string,
  ) {
    this.traffic = new Traffic(traffic.store, traffic.clock, openFetcher(traffic.fetcher));
  }
  async session(scope: "ARC_BASE" | "ATC_BASE"): Promise<OpenSession> {
    let value: unknown;
    try {
      value = await this.options?.credentials();
    } catch {
      throw new KitError("AUTH_REQUIRED", "Open platform credential provider failed.");
    }
    if (!value)
      throw new KitError("AUTH_REQUIRED", "Independent open platform credentials are required.");
    const authorization = parse(openCredentialSchema, value);
    if (!authorization.scopes.includes(scope))
      throw new KitError("FORBIDDEN", `Open platform scope ${scope} is required.`);
    if (
      authorization.expiresAt !== undefined &&
      authorization.expiresAt <= this.traffic.clock.now()
    )
      throw new KitError("AUTH_REQUIRED", "Open platform access token has expired.");
    return {
      authorization,
      account: `uid:${authorization.uid}`,
      fingerprint: digest(`open:${authorization.clientId}:${authorization.accessToken}`),
      credentials: undefined,
    };
  }
  scope(action: OpenAction): "ARC_BASE" | "ATC_BASE" {
    return action.kind.startsWith("open.video.") ? "ARC_BASE" : "ATC_BASE";
  }
  async bind(action: OpenAction): Promise<OpenAction> {
    if (action.kind === "open.video.publish") {
      const file = await localFile(
        this.mediaRoot,
        action.video.file,
        this.limit(),
        action.video.sha256,
      );
      if (![".mp4", ".mov", ".mkv"].includes(extname(file.path).toLowerCase()))
        throw new KitError("INVALID_INPUT", "Open video upload supports MP4, MOV and MKV.");
      const cover = action.cover ? await this.image(action.cover) : undefined;
      return {
        ...action,
        video: { file: file.path, sha256: file.sha256 },
        ...(cover ? { cover } : {}),
      };
    }
    if (action.kind === "open.article.image")
      return { ...action, image: await this.image(action.image) };
    return action;
  }
  limit(): number {
    return parse(
      z
        .number()
        .int()
        .positive()
        .max(512 * 1024 * 1024),
      this.options?.maxUploadBytes ?? 128 * 1024 * 1024,
    );
  }
  async image(attachment: {
    file: string;
    sha256?: string | undefined;
  }): Promise<{ file: string; sha256: string }> {
    const file = await localFile(
      this.mediaRoot,
      attachment.file,
      5 * 1024 * 1024,
      attachment.sha256,
    );
    imageType(file.bytes);
    return { file: file.path, sha256: file.sha256 };
  }
  async request(
    session: OpenSession,
    path: string,
    method: "GET" | "POST",
    data?: Record<string, unknown> | FormData,
    query: Record<string, string | number> = {},
    group?: string,
  ): Promise<unknown> {
    const url = new URL(path, MEMBER);
    if (url.origin !== MEMBER || !url.pathname.startsWith("/arcopen/fn/"))
      throw new KitError("FORBIDDEN", "Unsupported open platform endpoint.");
    url.search = new URLSearchParams(
      Object.entries(query).map(([key, value]) => [key, String(value)]),
    ).toString();
    let body: Uint8Array<ArrayBuffer> | string | undefined,
      contentType = "application/json",
      signed = "";
    if (data instanceof FormData) {
      const encoded = new Request(url, { method: "POST", body: data });
      contentType = encoded.headers.get("content-type")!;
      body = new Uint8Array(await encoded.arrayBuffer());
      // File-only forms have no non-file fields to hash.
      if (method !== "GET" && [...data.values()].every((v) => typeof v === "string"))
        signed = Buffer.from(body).toString("utf8");
    } else if (data !== undefined) {
      body = JSON.stringify(data);
      if (method !== "GET") signed = body;
    }
    const result = await this.traffic.request(
      url,
      {
        method,
        headers: {
          ...signOpen(session.authorization, signed, this.traffic.clock.now()),
          "content-type": contentType,
        },
        ...(body !== undefined ? { body } : {}),
      },
      session.account,
      true,
      false,
      group ? { writeGroup: group } : undefined,
    );
    if (path === "/arcopen/fn/archive/video/init")
      return { upload_token: object(result).upload_token };
    return scrub(result, {
      app_secret: session.authorization.appSecret,
      access_token: session.authorization.accessToken,
    });
  }
  async call<K extends OpenName>(name: K, input: OpenArguments<K>): Promise<unknown> {
    const a = parse(openInputs[name], input) as Record<string, unknown>;
    const session = await this.session(name.startsWith("open_video") ? "ARC_BASE" : "ATC_BASE");
    let result: unknown;
    if (name === "open_video")
      result = await this.request(session, "/arcopen/fn/archive/view", "GET", undefined, {
        resource_id: String(a.resourceId),
      });
    else if (name === "open_video_categories")
      result = await this.request(session, "/arcopen/fn/archive/type/list", "GET");
    else if (name === "open_video_list")
      result = await this.request(session, "/arcopen/fn/archive/viewlist", "GET", undefined, {
        pn: Number(a.page),
        ps: Number(a.size),
        status: String(a.status),
      });
    else if (name === "open_article_categories")
      result = await this.request(session, "/arcopen/fn/article/categories", "GET");
    else {
      const fields = new FormData();
      const values =
        name === "open_article"
          ? { id: a.articleId }
          : { pn: a.page, ps: a.size, sort: a.sort, group: a.group, category: a.category };
      for (const [key, value] of Object.entries(values)) fields.set(key, String(value));
      result = await this.request(
        session,
        `/arcopen/fn/article/${name === "open_article" ? "detail" : "list"}`,
        "GET",
        fields,
      );
    }
    return scrub(result, {
      client_id: session.authorization.clientId,
      app_secret: session.authorization.appSecret,
      access_token: session.authorization.accessToken,
    });
  }
  async execute(action: OpenAction, initial: Session, group: string, step: Step): Promise<unknown> {
    const session = await this.session(this.scope(action));
    if (session.fingerprint !== initial.fingerprint || session.authorization.uid !== action.uid)
      throw new KitError("FORBIDDEN", "Open platform account changed.");
    const post = (
      path: string,
      data?: Record<string, unknown> | FormData,
      query?: Record<string, string>,
    ) => this.request(session, path, "POST", data, query, group);
    let result: unknown;
    switch (action.kind) {
      case "open.video.publish": {
        const video = await localFile(
          this.mediaRoot,
          action.video.file,
          this.limit(),
          action.video.sha256,
        );
        const upload = object(
          await step("init", () =>
            post("/arcopen/fn/archive/video/init", { name: basename(video.path), utype: "0" }),
          ),
        );
        if (typeof upload.upload_token !== "string" || !upload.upload_token.length)
          throw new KitError("UPSTREAM", "Missing video upload token.");
        const token = upload.upload_token,
          partSize = 10 * 1024 * 1024;
        for (let offset = 0, part = 1; offset < video.bytes.length; offset += partSize, part++) {
          const url = new URL("https://openupos.bilivideo.com/video/v2/part/upload");
          url.search = new URLSearchParams({
            upload_token: token,
            part_number: String(part),
          }).toString();
          const bytes = new Uint8Array(
            video.bytes.subarray(offset, Math.min(offset + partSize, video.bytes.length)),
          );
          await step(`part:${part}`, () =>
            this.traffic.request(
              url,
              {
                method: "POST",
                headers: { "content-type": "application/octet-stream" },
                body: bytes,
              },
              session.account,
              false,
              false,
              { writeGroup: group },
            ),
          );
        }
        await step("complete", () =>
          post("/arcopen/fn/archive/video/complete", undefined, { upload_token: token }),
        );
        let cover: unknown;
        if (action.cover)
          cover = object(
            await step("cover", () =>
              this.uploadImage(session, "/arcopen/fn/archive/cover/upload", action.cover!, group),
            ),
          ).url;
        result = await step("send", () =>
          post(
            "/arcopen/fn/archive/add-by-utoken",
            { ...action.metadata, ...(cover ? { cover } : {}) },
            { upload_token: token },
          ),
        );
        break;
      }
      case "open.video.edit":
        result = await step("send", () =>
          post("/arcopen/fn/archive/edit", { resource_id: action.resourceId, ...action.metadata }),
        );
        break;
      case "open.video.delete":
        result = await step("send", () =>
          post("/arcopen/fn/archive/delete", { resource_id: action.resourceId }),
        );
        break;
      case "open.article.image":
        result = await step("image", () =>
          this.uploadImage(session, "/arcopen/fn/article/upload/image", action.image, group),
        );
        break;
      case "open.article.publish":
      case "open.article.edit":
      case "open.article.delete": {
        const fields = new FormData();
        const values: Record<string, unknown> =
          action.kind === "open.article.delete"
            ? { ids: action.articleId }
            : {
                ...action.metadata,
                ...(action.kind === "open.article.edit" ? { id: action.articleId } : {}),
              };
        for (const [key, value] of Object.entries(values)) fields.set(key, String(value));
        const endpoint =
          action.kind === "open.article.publish"
            ? "add"
            : action.kind === "open.article.edit"
              ? "edit"
              : "delete";
        result = await step("send", () => post(`/arcopen/fn/article/${endpoint}`, fields));
        break;
      }
    }
    return {
      accepted: true,
      ...(action.kind.endsWith(".publish") || action.kind.endsWith(".edit")
        ? { moderation: "pending_or_unknown" }
        : {}),
      data: scrub(result, {
        app_secret: session.authorization.appSecret,
        access_token: session.authorization.accessToken,
      }),
    };
  }
  async uploadImage(
    session: OpenSession,
    path: string,
    attachment: { file: string; sha256?: string | undefined },
    group: string,
  ): Promise<unknown> {
    const file = await localFile(
        this.mediaRoot,
        attachment.file,
        5 * 1024 * 1024,
        attachment.sha256,
      ),
      data = new FormData();
    data.set(
      "file",
      new Blob([new Uint8Array(file.bytes)], { type: imageType(file.bytes) }),
      basename(file.path),
    );
    return this.request(session, path, "POST", data, {}, group);
  }
}
