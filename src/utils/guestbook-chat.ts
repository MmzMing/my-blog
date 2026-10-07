import type { WalineComment, WalineRootComment } from "@waline/api";
import type {
	GuestbookChatMessage,
	GuestbookEmojiPack,
	GuestbookImageAttachment,
} from "@/types/guestbook-chat";

const REPLY_MARKER = /^<!--guestbook-reply:(\d+):([^>]*)-->\s*/u;
const MARKDOWN_IMAGE = /!\[[^\]]*\]\([^\s)]+(?:\s+"[^"]*")?\)/gu;
export const WALINE_INLINE_IMAGE_SIZE_LIMIT = 128_000;

export function hasGuestbookReplyMarker(value: string): boolean {
	return REPLY_MARKER.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function buildEmojiAssetURL(
	folder: string,
	item: string,
	type: string,
): string {
	if (/^https?:\/\//u.test(item)) return item;
	const filename = item.endsWith(`.${type}`) ? item : `${item}.${type}`;
	return new URL(filename, `${folder.replace(/\/+$/u, "")}/`).href;
}

function applyEmojiAssetPrefix(item: string, prefix: string): string {
	if (/^https?:\/\//u.test(item) || !prefix || item.startsWith(prefix)) {
		return item;
	}
	return `${prefix}${item}`;
}

async function loadGuestbookEmojiPack(
	source: string,
): Promise<GuestbookEmojiPack> {
	const folder = source.replace(/\/+$/u, "");
	const response = await fetch(`${folder}/info.json`);
	if (!response.ok) throw new Error(`表情包加载失败 (${response.status})`);

	const manifest: unknown = await response.json();
	if (!isRecord(manifest) || !Array.isArray(manifest.items)) {
		throw new Error("表情包配置格式不正确");
	}

	const items = manifest.items.filter(
		(item): item is string => typeof item === "string" && item.length > 0,
	);
	if (items.length === 0) throw new Error("表情包没有可用内容");

	const type =
		typeof manifest.type === "string" && manifest.type ? manifest.type : "png";
	const prefix = typeof manifest.prefix === "string" ? manifest.prefix : "";
	const iconName =
		typeof manifest.icon === "string" && manifest.icon
			? manifest.icon
			: items[0];

	return {
		name:
			typeof manifest.name === "string" && manifest.name
				? manifest.name
				: "Waline",
		icon: buildEmojiAssetURL(
			folder,
			applyEmojiAssetPrefix(iconName, prefix),
			type,
		),
		items: items.map((item) => ({
			key: `${prefix}${item}`,
			url: buildEmojiAssetURL(
				folder,
				applyEmojiAssetPrefix(item, prefix),
				type,
			),
		})),
	};
}

export async function loadGuestbookEmojiPacks(
	sources: string[],
): Promise<GuestbookEmojiPack[]> {
	const settled = await Promise.allSettled(
		sources.filter(Boolean).map(loadGuestbookEmojiPack),
	);
	const packs = settled.flatMap((result) =>
		result.status === "fulfilled" ? [result.value] : [],
	);
	if (packs.length === 0) throw new Error("Waline 表情加载失败，请稍后重试");
	return packs;
}

export async function uploadGuestbookImage(
	file: File,
	uploadURL: string,
): Promise<string> {
	if (!uploadURL) {
		if (file.size > WALINE_INLINE_IMAGE_SIZE_LIMIT) {
			throw new Error("Waline 原生图片不能超过 128 KB");
		}
		return await new Promise<string>((resolve, reject) => {
			const reader = new FileReader();
			reader.addEventListener("load", () => {
				if (typeof reader.result === "string") resolve(reader.result);
				else reject(new Error("图片读取失败，请重新选择"));
			});
			reader.addEventListener("error", () =>
				reject(new Error("图片读取失败，请重新选择")),
			);
			reader.readAsDataURL(file);
		});
	}
	const formData = new FormData();
	formData.append("file", file);

	const response = await fetch(uploadURL, {
		method: "POST",
		headers: { Accept: "application/json" },
		body: formData,
	});
	const payload: unknown = await response.json().catch(() => null);
	const data =
		isRecord(payload) && isRecord(payload.data) ? payload.data : null;
	const links = data && isRecord(data.links) ? data.links : null;
	const url =
		(links && typeof links.url === "string" ? links.url : "") ||
		(data && typeof data.url === "string" ? data.url : "") ||
		(isRecord(payload) && typeof payload.url === "string" ? payload.url : "");

	if (!response.ok || !url) {
		const message =
			isRecord(payload) && typeof payload.message === "string"
				? payload.message
				: "图片上传失败，请稍后重试";
		throw new Error(message);
	}

	return url;
}

export function appendGuestbookImage(
	content: string,
	attachment?: GuestbookImageAttachment | null,
): string {
	if (!attachment) return content;
	const alt = attachment.name.replace(/[[\]]/gu, "").trim() || "图片";
	const image = `![${alt}](${attachment.url})`;
	return content ? `${content}\n\n${image}` : image;
}

export function hasGuestbookImage(content: string): boolean {
	MARKDOWN_IMAGE.lastIndex = 0;
	return MARKDOWN_IMAGE.test(content);
}

export function getGuestbookTextLength(content: string): number {
	MARKDOWN_IMAGE.lastIndex = 0;
	return Array.from(content.replace(MARKDOWN_IMAGE, "").trim()).length;
}

function normalizeGuestbookTimestamp(value: number): number {
	const numeric = Number(value);
	if (!Number.isFinite(numeric)) return Date.now();
	return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
}

function decodeReplyNick(value: string): string {
	try {
		return decodeURIComponent(value);
	} catch {
		return value;
	}
}

function parseGuestbookMessageBody(raw: string): {
	body: string;
	replyToId?: string;
	replyToNick?: string;
	marker?: string;
} {
	const match = raw.match(REPLY_MARKER);
	if (!match) return { body: raw.trim() };

	const replyToNick = decodeReplyNick(match[2]);
	const withoutMarker = raw.replace(REPLY_MARKER, "").trim();
	// 旧版把「@昵称 」写进了正文，新数据改由服务端 pid 承载，这里补掉前缀才能新旧一致
	const mention = `@${replyToNick} `;

	return {
		body: withoutMarker.startsWith(mention)
			? withoutMarker.slice(mention.length).trim()
			: withoutMarker,
		replyToId: match[1],
		replyToNick,
		marker: match[0],
	};
}

function htmlToPlainText(value: string): string {
	if (typeof DOMParser === "undefined") return value;
	return (
		new DOMParser()
			.parseFromString(value, "text/html")
			.body.textContent?.trim() ?? ""
	);
}

function normalizeGuestbookLink(
	value: string | null | undefined,
): string | undefined {
	if (!value) return undefined;
	try {
		const url = new URL(value);
		return url.protocol === "http:" || url.protocol === "https:"
			? url.href
			: undefined;
	} catch {
		return undefined;
	}
}

export function normalizeGuestbookComment(
	comment: WalineComment,
): GuestbookChatMessage {
	const parsed = parseGuestbookMessageBody(
		comment.orig || htmlToPlainText(comment.comment),
	);
	// 引用关系优先取服务端的 pid（真回复，会触发邮件通知），历史数据才回退到正文里的注释标记
	const nativeReply = "pid" in comment && comment.pid ? comment.pid : null;

	return {
		id: String(comment.objectId),
		objectId: comment.objectId,
		rootId: "rid" in comment ? comment.rid : comment.objectId,
		userId: comment.user_id,
		nick: comment.nick || "匿名访客",
		avatar: comment.avatar || "",
		link: normalizeGuestbookLink(comment.link),
		body: parsed.body,
		createdAt: normalizeGuestbookTimestamp(comment.time),
		browser: comment.browser,
		os: comment.os,
		addr: comment.addr,
		label: comment.label,
		isAdmin: comment.type === "administrator",
		replyToId: nativeReply ? String(nativeReply) : parsed.replyToId,
		replyToNick:
			nativeReply && "reply_user" in comment
				? comment.reply_user?.nick
				: parsed.replyToNick,
		legacyReplyMarker: nativeReply ? undefined : parsed.marker,
		status: comment.status,
	};
}

export function flattenGuestbookComments(
	roots: WalineRootComment[],
): GuestbookChatMessage[] {
	return roots
		.flatMap((root) => [
			normalizeGuestbookComment(root),
			...root.children.map(normalizeGuestbookComment),
		])
		.sort((left, right) => left.createdAt - right.createdAt);
}

export function mergeGuestbookMessages(
	current: GuestbookChatMessage[],
	incoming: GuestbookChatMessage[],
): GuestbookChatMessage[] {
	const localMessages = current.filter((message) => message.localState);
	const serverMessages = new Map(
		current
			.filter((message) => !message.localState)
			.map((message) => [message.id, message]),
	);

	for (const message of incoming) serverMessages.set(message.id, message);

	return [...serverMessages.values(), ...localMessages].sort(
		(left, right) => left.createdAt - right.createdAt,
	);
}

export function buildGuestbookReplyFields(
	target: GuestbookChatMessage | null,
): { pid?: number; rid?: number } {
	if (!target?.objectId) return {};
	const pid = target.objectId;
	return { pid, rid: target.rootId ?? pid };
}

export function buildGuestbookEditedMessageBody(
	content: string,
	message: GuestbookChatMessage,
): string {
	if (!message.legacyReplyMarker) return content;
	return `${message.legacyReplyMarker}\n${content}`;
}

export function getGuestbookErrorMessage(error: unknown): string {
	if (error instanceof DOMException && error.name === "AbortError") return "";
	if (error instanceof Error) {
		const message = error.message;
		if (/failed to fetch|networkerror|network request/iu.test(message)) {
			return "无法连接到留言服务，请检查网络后重试";
		}
		if (/(401|403|unauthorized|forbidden|token|登录)/iu.test(message)) {
			return "登录状态已失效，请重新登录";
		}
		if (/(429|too many|too fast|rate limit|频繁|太快)/iu.test(message)) {
			return "游客留言有频率限制，请稍后再试";
		}
		if (/(required|word|length|content|字数|内容)/iu.test(message)) {
			return "消息内容不符合留言服务要求，请检查后重试";
		}
	}
	return "留言服务暂时不可用，请稍后重试";
}

export function isGuestbookAuthError(error: unknown): boolean {
	return (
		error instanceof Error &&
		/(401|403|unauthorized|forbidden|token|登录)/iu.test(error.message)
	);
}

export function getGuestbookInitials(name: string): string {
	return Array.from(name.trim() || "访")
		.slice(0, 2)
		.join("")
		.toUpperCase();
}
