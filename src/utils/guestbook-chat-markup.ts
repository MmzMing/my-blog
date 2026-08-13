import { marked } from "marked";

const SAFE_IMAGE_SOURCE =
	/^(?:https?:\/\/|data:image\/(?:png|jpeg|gif|webp);base64,)/iu;
const MAX_INLINE_IMAGE_SOURCE_LENGTH = 180_000;
const QUOTE_PREVIEW_LENGTH = 72;
const ALLOWED_TAGS = new Set(["p", "br", "a", "img", "strong", "em", "code"]);
const ALLOWED_ATTRIBUTES: Record<string, Set<string>> = {
	a: new Set(["href", "title"]),
	img: new Set(["src", "alt", "title"]),
};

function sanitizeGuestbookHtml(rendered: string): string {
	const document = new DOMParser().parseFromString(rendered, "text/html");
	const elements = Array.from(document.body.querySelectorAll("*"));

	for (const element of elements) {
		const tag = element.tagName.toLowerCase();
		if (!ALLOWED_TAGS.has(tag)) {
			if (["script", "style", "iframe", "object", "embed"].includes(tag)) {
				element.remove();
				continue;
			}
			element.replaceWith(...Array.from(element.childNodes));
			continue;
		}

		const allowedAttributes = ALLOWED_ATTRIBUTES[tag] ?? new Set<string>();
		for (const attribute of Array.from(element.attributes)) {
			if (!allowedAttributes.has(attribute.name.toLowerCase())) {
				element.removeAttribute(attribute.name);
			}
		}

		if (tag === "a") {
			const href = element.getAttribute("href") || "";
			try {
				const url = new URL(href, window.location.origin);
				if (url.protocol !== "http:" && url.protocol !== "https:") {
					element.removeAttribute("href");
				}
			} catch {
				element.removeAttribute("href");
			}
			element.setAttribute("target", "_blank");
			element.setAttribute("rel", "nofollow noopener noreferrer");
		}

		if (tag === "img") {
			const src = element.getAttribute("src") || "";
			if (
				!SAFE_IMAGE_SOURCE.test(src) ||
				src.length > MAX_INLINE_IMAGE_SOURCE_LENGTH
			) {
				element.remove();
				continue;
			}
			element.setAttribute("loading", "lazy");
			element.setAttribute("decoding", "async");
			element.setAttribute("referrerpolicy", "no-referrer");
		}
	}

	return document.body.innerHTML;
}

function isWalineEmojiSource(source: string): boolean {
	if (
		!SAFE_IMAGE_SOURCE.test(source) ||
		source.length > MAX_INLINE_IMAGE_SOURCE_LENGTH
	) {
		return false;
	}

	try {
		const url = new URL(source, window.location.origin);
		return decodeURIComponent(url.pathname).includes("/@waline/emojis");
	} catch {
		return false;
	}
}

function appendQuotePreviewText(
	document: Document,
	container: HTMLElement,
	value: string,
	state: { length: number; truncated: boolean },
) {
	if (state.length >= QUOTE_PREVIEW_LENGTH) {
		state.truncated = true;
		return;
	}

	const normalized = value.replace(/\s+/gu, " ");
	if (!normalized) return;
	const remaining = QUOTE_PREVIEW_LENGTH - state.length;
	const characters = Array.from(normalized);
	const visible = characters.slice(0, remaining).join("");
	if (visible) {
		container.appendChild(document.createTextNode(visible));
		state.length += Array.from(visible).length;
	}
	if (characters.length > remaining) state.truncated = true;
}

export function renderGuestbookQuotePreview(body: string): string {
	const rendered = marked.parse(body, {
		async: false,
		breaks: true,
		gfm: true,
	});
	const document = new DOMParser().parseFromString(
		String(rendered),
		"text/html",
	);
	const preview = document.createElement("span");
	const state = { length: 0, truncated: false };

	const appendNode = (node: Node) => {
		if (state.length >= QUOTE_PREVIEW_LENGTH) {
			state.truncated = true;
			return;
		}
		if (node.nodeType === Node.TEXT_NODE) {
			appendQuotePreviewText(document, preview, node.textContent || "", state);
			return;
		}
		if (!(node instanceof HTMLElement)) return;

		if (node.tagName === "IMG") {
			const source = node.getAttribute("src") || "";
			if (isWalineEmojiSource(source)) {
				const image = document.createElement("img");
				image.className = "guestbook-message__quote-emoji";
				image.src = source;
				image.alt = node.getAttribute("alt") || "表情";
				image.loading = "lazy";
				image.decoding = "async";
				image.referrerPolicy = "no-referrer";
				preview.appendChild(image);
				state.length += 1;
				return;
			}
			appendQuotePreviewText(document, preview, "[图片]", state);
			return;
		}

		if (node.tagName === "BR") {
			appendQuotePreviewText(document, preview, " ", state);
			return;
		}

		for (const child of Array.from(node.childNodes)) appendNode(child);
		if (["P", "DIV", "LI", "BLOCKQUOTE"].includes(node.tagName)) {
			appendQuotePreviewText(document, preview, " ", state);
		}
	};

	for (const child of Array.from(document.body.childNodes)) appendNode(child);
	if (state.truncated) preview.appendChild(document.createTextNode("…"));

	preview.normalize();
	for (const textNode of Array.from(preview.childNodes)) {
		if (textNode.nodeType !== Node.TEXT_NODE) continue;
		textNode.textContent = (textNode.textContent || "").replace(/\s+/gu, " ");
	}

	return preview.innerHTML.trim() || "原消息暂无文字内容";
}

export function renderGuestbookMessage(body: string): string {
	const rendered = marked.parse(body, {
		async: false,
		breaks: true,
		gfm: true,
	});

	return sanitizeGuestbookHtml(String(rendered));
}
