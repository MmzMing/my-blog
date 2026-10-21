import { visit } from "unist-util-visit";

/**
 * 把 MDX 指令转成 MDX JSX 节点，交给已 import 的 Astro 组件渲染。
 *
 * 块级：
 *   :::timeline{label="..."} + ```timeline 行式 DSL``` / :::
 *   :::accordion{label="..."} + ```accordion 行式 DSL``` / :::
 *   行式 DSL：{时间 · 标题 · 可选标签} + 详情行；
 *             {分组 · open} + - 名称 | 描述 | URL | 图标 | 颜色
 *   :::social-links{label="..."} + - 平台 | 昵称 | 备注 | URL | 图标 | brand | 状态（可选） / :::
 *   （social-links 容器会自动并入前一段末尾，渲染为行内头像组）
 *   ::chat + :u 用户 / :a 助手 / :s 系统 / :u{name="昵称"} 用户 + ::
 *   :::chat + 上述角色行 / :::（容器写法）
 *   :::folding{title="..."}、:::blur、:::card-list + Markdown 内容 / :::
 *   ::link-card{...}（连续多个会合并为响应式网格）、::link-banner{...}
 *   :::alert、:::quote、:::title、:::tabs + :::tab、:::emoji-tail
 *   ::pic、::video-embed、:copy、:code；[!cre:/story:/zoom:/repeat:] 艺术字
 * 行内：:profile-card{... avatar="$avatar"}、:badge[文字]、:key[Ctrl]、
 *       :tip[术语]{tip="解释"}、:blur[文字]
 *
 * 数组、图片等非字符串 props 也可以走 leaf 指令的 $变量 表达式；
 * 变量需在 MDX 顶层 import 或 export const 定义。
 */
const COMPONENTS = {
	accordion: {
		name: "Accordion",
		types: ["leafDirective", "containerDirective"],
	},
	alert: {
		name: "Alert",
		types: ["containerDirective"],
	},
	badge: {
		name: "Badge",
		types: ["textDirective", "leafDirective"],
	},
	blur: {
		name: "Blur",
		types: ["textDirective", "leafDirective", "containerDirective"],
	},
	"card-list": {
		name: "CardList",
		types: ["containerDirective"],
	},
	chat: {
		name: "Chat",
		types: ["leafDirective", "containerDirective"],
	},
	code: {
		name: "CodeLang",
		types: ["textDirective"],
	},
	copy: {
		name: "Copy",
		types: ["textDirective", "leafDirective"],
	},
	"emoji-tail": {
		name: "EmojiTail",
		types: ["containerDirective"],
	},
	folding: {
		name: "Folding",
		types: ["containerDirective"],
	},
	key: {
		name: "Key",
		types: ["textDirective", "leafDirective"],
	},
	"link-banner": {
		name: "LinkBanner",
		types: ["leafDirective"],
	},
	"link-card": {
		name: "LinkCard",
		types: ["leafDirective"],
	},
	pic: {
		name: "Pic",
		types: ["leafDirective", "containerDirective"],
	},
	"profile-card": {
		name: "ProfileCard",
		types: ["textDirective", "leafDirective"],
	},
	quote: {
		name: "Quote",
		types: ["containerDirective"],
	},
	"social-links": {
		name: "SocialLinks",
		types: ["textDirective", "leafDirective", "containerDirective"],
	},
	tab: {
		name: "Tab",
		types: ["containerDirective"],
	},
	tabs: {
		name: "Tabs",
		types: ["containerDirective"],
	},
	timeline: {
		name: "Timeline",
		types: ["leafDirective", "containerDirective"],
	},
	tip: {
		name: "Tip",
		types: ["textDirective", "leafDirective"],
	},
	title: {
		name: "Title",
		types: ["containerDirective"],
	},
	"video-embed": {
		name: "VideoEmbed",
		types: ["leafDirective"],
	},
};

const EXPRESSION_PROPS = {
	accordion: ["items"],
	chat: ["messages"],
	"profile-card": ["avatar"],
	"social-links": ["links"],
	timeline: ["items"],
};

const BOOLEAN_PROPS = {
	alert: ["card", "flat"],
	pic: ["mirror", "full"],
	tabs: ["centered"],
};

function labelChildren(label) {
	if (Array.isArray(label.children)) return label.children;
	if (typeof label.value === "string") {
		return [{ type: "text", value: label.value }];
	}
	return [];
}

function identifierExpression(identifier) {
	return {
		type: "mdxJsxAttributeValueExpression",
		value: identifier,
		data: {
			estree: {
				type: "Program",
				sourceType: "module",
				comments: [],
				body: [
					{
						type: "ExpressionStatement",
						expression: { type: "Identifier", name: identifier },
					},
				],
			},
		},
	};
}

function parseAccordionBody(body) {
	const groups = [];
	let current = null;

	for (const rawLine of body.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line) continue;

		const header = line.match(/^\{(.+)\}$/);
		if (header) {
			const parts = header[1]
				.split("·")
				.map((part) => part.trim())
				.filter(Boolean);
			const open = parts.includes("open");
			const title = parts.filter((part) => part !== "open").join(" · ");
			if (!title) continue;

			current = {
				id: `group-${groups.length}`,
				title,
				open,
				cards: [],
			};
			groups.push(current);
			continue;
		}

		if (!current) continue;
		const cardMatch = line.match(/^[-*+]\s+(.+)$/);
		if (!cardMatch) continue;

		const [name, desc, url, icon, color, darkColor] = cardMatch[1]
			.split("|")
			.map((field) => field.trim());
		if (!name) continue;

		current.cards.push({
			name,
			...(desc ? { desc } : {}),
			url: url || "#",
			icon: icon || "material-symbols:link",
			color: color || "var(--deep-text)",
			...(darkColor ? { darkColor } : {}),
		});
	}

	return groups.filter((group) => group.cards.length > 0);
}

function parseTimelineBody(body) {
	const items = [];
	let current = null;

	const flush = () => {
		if (!current) return;
		const detail = current.detailLines.join(" ").trim();
		if (current.title && detail) {
			items.push({
				icon: current.icon,
				title: current.title,
				time: current.time,
				...(current.datetime ? { datetime: current.datetime } : {}),
				...(current.tag ? { tag: current.tag } : {}),
				...(current.tone ? { tone: current.tone } : {}),
				detail,
			});
		}
		current = null;
	};

	for (const rawLine of body.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line) continue;

		const header = line.match(/^\{(.+)\}$/);
		if (header) {
			flush();
			const options = {};
			const textParts = [];

			for (const part of header[1]
				.split("·")
				.map((value) => value.trim())
				.filter(Boolean)) {
				const option = part.match(/^(icon|tone|datetime)=(.+)$/);
				if (option) {
					options[option[1]] = option[2].trim();
				} else {
					textParts.push(part);
				}
			}

			current = {
				icon: options.icon || "material-symbols:circle",
				tone: options.tone,
				datetime: options.datetime,
				time: textParts[0] || "",
				title: textParts[1] || "",
				tag: textParts.slice(2).join(" · ") || undefined,
				detailLines: [],
			};
			continue;
		}

		if (current) current.detailLines.push(line);
	}

	flush();
	return items;
}

function parseChatName(value) {
	if (!value) return undefined;

	const match = value.match(
		/(?:^|\s)name\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s]+))/,
	);
	const name = (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
	return name || undefined;
}

function parseChatBody(body) {
	const messages = [];
	let current = null;

	for (const rawLine of body.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line === "::") continue;

		const match = line.match(/^:(u|a|s)(?:\{([^}]*)\})?\s+(.+)$/);
		if (match) {
			const role =
				match[1] === "u" ? "user" : match[1] === "a" ? "assistant" : "system";
			const name = parseChatName(match[2]);

			current = {
				role,
				...(name ? { name } : {}),
				text: match[3].trim(),
			};
			messages.push(current);
			continue;
		}

		if (current) current.text += ` ${line}`;
	}

	return messages;
}

/**
 * `::chat` 是 leaf 指令，后面的消息行会被 Markdown 并进普通段落，
 * 结尾 `::` 也会成为段落文本，因此按源码行定位并移除被吞掉的兄弟节点。
 */
function extractChatLeafBody(node, file, parent, index) {
	const source = file?.value;
	const startLine = node.position?.end?.line;

	if (typeof source !== "string" || typeof startLine !== "number") {
		return null;
	}

	const lines = source.split(/\r?\n/);
	let closingIndex = -1;

	for (let i = startLine; i < lines.length; i += 1) {
		if (lines[i].trim() === "::") {
			closingIndex = i;
			break;
		}
	}

	const bodyLines = [];
	const bodyLimit = closingIndex === -1 ? lines.length : closingIndex;

	for (let i = startLine; i < bodyLimit; i += 1) {
		if (closingIndex === -1 && !lines[i].trim()) break;
		bodyLines.push(lines[i]);
	}

	if (closingIndex !== -1 && Array.isArray(parent?.children)) {
		const closingLine = closingIndex + 1;
		let removeCount = 0;

		for (let i = index + 1; i < parent.children.length; i += 1) {
			const siblingLine = parent.children[i].position?.start?.line;
			if (typeof siblingLine === "number" && siblingLine <= closingLine) {
				removeCount += 1;
			} else {
				break;
			}
		}

		if (removeCount > 0) parent.children.splice(index + 1, removeCount);
	}

	return bodyLines.join("\n");
}

function parseSocialLinksBody(body) {
	const links = [];

	for (const rawLine of body.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line) continue;

		const match = line.match(/^[-*+]\s+(.+)$/);
		if (!match) continue;

		const [platform, handle, note, href, icon, brand, status] = match[1]
			.split("|")
			.map((field) => field.trim());
		if (!platform || !href) continue;

		links.push({
			platform,
			handle: handle || "",
			...(note ? { note } : {}),
			href,
			icon: icon || "material-symbols:link",
			...(brand ? { brand } : {}),
			...(status ? { status } : {}),
		});
	}

	return links;
}

function parsePicBody(body) {
	const items = [];

	for (const rawLine of body.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line) continue;

		const match = line.match(/^[-*+]\s+(.+)$/);
		if (!match) continue;

		const [src, caption, alt] = match[1]
			.split("|")
			.map((field) => field.trim());
		if (!src) continue;

		items.push({
			src,
			...(caption ? { caption } : {}),
			...(alt ? { alt } : {}),
		});
	}

	return items;
}

function nodeText(node) {
	if (node.type === "text" || node.type === "inlineCode") return node.value;
	if (Array.isArray(node.children)) {
		return node.children.map((child) => nodeText(child)).join("");
	}
	return "";
}

function bodyFromChildren(children) {
	const lines = [];

	for (const child of children) {
		if (child.type === "list") {
			for (const item of child.children) {
				lines.push(`- ${nodeText(item).trim()}`);
			}
			continue;
		}

		if (child.type === "code") {
			lines.push(child.value);
			continue;
		}

		const text = nodeText(child).trim();
		if (text) lines.push(text);
	}

	return lines.join("\n");
}

function getDirectiveBody(node, file, children) {
	const source = file?.value;
	const startLine = node.position?.start?.line;
	const endLine = node.position?.end?.line;

	if (typeof source === "string" && startLine && endLine) {
		return source
			.split(/\r?\n/)
			.slice(startLine, endLine - 1)
			.join("\n");
	}

	return bodyFromChildren(children);
}

export function remarkMdxDirectiveComponents() {
	return (tree, file) => {
		const path = file?.path || file?.history?.[0] || "";
		if (!path.endsWith(".mdx")) return;

		visit(tree, (node, index, parent) => {
			const componentName = node.name?.toLowerCase();
			const config = COMPONENTS[componentName];
			if (!config?.types.includes(node.type)) return;

			const expressionProps = EXPRESSION_PROPS[componentName] ?? [];
			const booleanProps = BOOLEAN_PROPS[componentName] ?? [];
			const attributes = Object.entries(node.attributes ?? {}).map(
				([name, value]) => {
					const stringValue =
						value === null || value === undefined ? null : String(value);

					if (
						booleanProps.includes(name) &&
						(stringValue === null || stringValue === "")
					) {
						return {
							type: "mdxJsxAttribute",
							name,
							value: "true",
						};
					}

					if (
						typeof stringValue === "string" &&
						expressionProps.includes(name) &&
						stringValue.startsWith("$")
					) {
						const identifier = stringValue.slice(1);
						if (/^[A-Za-z_$][\w$]*$/.test(identifier)) {
							return {
								type: "mdxJsxAttribute",
								name,
								value: identifierExpression(identifier),
							};
						}
					}

					return {
						type: "mdxJsxAttribute",
						name,
						value: stringValue,
					};
				},
			);

			const isFlow = node.type !== "textDirective";
			const isContainer = node.type === "containerDirective";
			let children = node.children ?? [];
			let handled = false;
			let inlineSocialLinks = false;

			if (
				isContainer &&
				(componentName === "accordion" || componentName === "timeline")
			) {
				const code = children.find((child) => child.type === "code");
				let dataString = "";

				if (code && typeof code.value === "string") {
					if (code.lang === "json") {
						dataString = code.value;
					} else {
						const data =
							componentName === "accordion"
								? parseAccordionBody(code.value)
								: parseTimelineBody(code.value);
						if (data.length > 0) dataString = JSON.stringify(data);
					}
				} else {
					const body = getDirectiveBody(node, file, children);
					const data =
						componentName === "accordion"
							? parseAccordionBody(body)
							: parseTimelineBody(body);
					if (data.length > 0) dataString = JSON.stringify(data);
				}

				if (
					dataString &&
					!attributes.some((attribute) => attribute.name === "items")
				) {
					attributes.push({
						type: "mdxJsxAttribute",
						name: "items",
						value: dataString,
					});
				}

				children = [];
				handled = true;
			} else if (isContainer && componentName === "social-links") {
				const body = getDirectiveBody(node, file, children);
				const links = parseSocialLinksBody(body);

				if (
					links.length > 0 &&
					!attributes.some((attribute) => attribute.name === "links")
				) {
					attributes.push({
						type: "mdxJsxAttribute",
						name: "links",
						value: JSON.stringify(links),
					});
				}

				children = [];
				handled = true;
				inlineSocialLinks = links.length > 0;
			} else if (isContainer && componentName === "pic") {
				const code = children.find((child) => child.type === "code");
				const body =
					code && typeof code.value === "string"
						? code.value
						: getDirectiveBody(node, file, children);
				const gallery = parsePicBody(body);

				if (gallery.length > 0) {
					if (!attributes.some((attribute) => attribute.name === "items")) {
						attributes.push({
							type: "mdxJsxAttribute",
							name: "items",
							value: JSON.stringify(gallery),
						});
					}

					children = [];
					handled = true;
				}
			} else if (componentName === "chat") {
				const body = isContainer
					? getDirectiveBody(node, file, children)
					: extractChatLeafBody(node, file, parent, index);
				const messages = body ? parseChatBody(body) : [];

				if (messages.length > 0) {
					if (!attributes.some((attribute) => attribute.name === "messages")) {
						attributes.push({
							type: "mdxJsxAttribute",
							name: "messages",
							value: JSON.stringify(messages),
						});
					}
					children = [];
					handled = true;
				}
			}

			if (
				isContainer &&
				componentName === "blur" &&
				!attributes.some((attribute) => attribute.name === "block")
			) {
				attributes.push({
					type: "mdxJsxAttribute",
					name: "block",
					value: null,
				});
			}

			if (isContainer && componentName === "folding") {
				const label = children.find((child) => child.data?.directiveLabel);
				const title = label ? nodeText(label).trim() : "";

				if (
					title &&
					!attributes.some((attribute) => attribute.name === "title")
				) {
					attributes.push({
						type: "mdxJsxAttribute",
						name: "title",
						value: title,
					});
				}
			}

			if (!handled) {
				const label = children.find((child) => child.data?.directiveLabel);
				if (label) {
					children = isContainer
						? children.filter((child) => child !== label)
						: labelChildren(label);
				}
			}

			node.type = isFlow ? "mdxJsxFlowElement" : "mdxJsxTextElement";
			node.name = config.name;
			node.attributes = attributes;
			node.children = children;
			node.data = inlineSocialLinks ? { inlineSocialLinks: true } : {};
		});

		transformArtText(tree);
		groupLinkCards(tree);
		mergeInlineSocialLinks(tree);
	};
}

const ART_TEXT_PATTERN = /\[!(cre|story|zoom|repeat):([^\]]+)\]/g;

/**
 * 把 [!cre:文字] 这类轻量标记转换成行内 ArtText 组件。
 */
function transformArtText(parent) {
	if (!Array.isArray(parent.children)) return;

	const children = [];

	for (const child of parent.children) {
		if (child.type === "text" && child.value.includes("[!")) {
			const value = child.value;
			let lastIndex = 0;
			ART_TEXT_PATTERN.lastIndex = 0;
			let match = ART_TEXT_PATTERN.exec(value);

			while (match !== null) {
				if (match.index > lastIndex) {
					children.push({
						type: "text",
						value: value.slice(lastIndex, match.index),
					});
				}

				children.push({
					type: "mdxJsxTextElement",
					name: "ArtText",
					attributes: [
						{
							type: "mdxJsxAttribute",
							name: "variant",
							value: match[1],
						},
					],
					children: [{ type: "text", value: match[2] }],
					data: {},
				});
				lastIndex = match.index + match[0].length;
				match = ART_TEXT_PATTERN.exec(value);
			}

			if (lastIndex < value.length) {
				children.push({
					type: "text",
					value: value.slice(lastIndex),
				});
			}
			continue;
		}

		transformArtText(child);
		children.push(child);
	}

	parent.children = children;
}

/**
 * 连续的 LinkCard 合并进一个网格容器，单张卡片保持独立居中。
 */
function groupLinkCards(parent) {
	if (!Array.isArray(parent.children)) return;

	for (const child of parent.children) {
		groupLinkCards(child);
	}

	let index = 0;
	while (index < parent.children.length) {
		const node = parent.children[index];
		const isLinkCard =
			node.type === "mdxJsxFlowElement" && node.name === "LinkCard";

		if (!isLinkCard) {
			index += 1;
			continue;
		}

		const cards = [];
		let cursor = index;

		while (cursor < parent.children.length) {
			const child = parent.children[cursor];

			if (child.type === "mdxJsxFlowElement" && child.name === "LinkCard") {
				cards.push(child);
				cursor += 1;
				continue;
			}

			if (child.type === "text" && /^\s*$/.test(child.value)) {
				cursor += 1;
				continue;
			}

			break;
		}

		if (cards.length < 2) {
			index = cursor;
			continue;
		}

		parent.children.splice(index, cursor - index, {
			type: "mdxJsxFlowElement",
			name: "div",
			attributes: [
				{
					type: "mdxJsxAttribute",
					name: "class",
					value: "mdx-link-card-grid",
				},
			],
			children: cards,
			data: {},
		});
		index += 1;
	}
}

/**
 * social-links 仍写成独立的 :::social-links 容器，解析完成后把组件节点
 * 追加到前一段末尾，避免在正文里额外占一行。
 */
function mergeInlineSocialLinks(parent) {
	if (!Array.isArray(parent.children)) return;

	for (let i = parent.children.length - 1; i >= 0; i -= 1) {
		const child = parent.children[i];

		if (child.data?.inlineSocialLinks && i > 0) {
			const previous = parent.children[i - 1];

			if (previous.type === "paragraph" && Array.isArray(previous.children)) {
				previous.children.push(
					{ type: "text", value: " " },
					{
						type: "mdxJsxTextElement",
						name: child.name,
						attributes: child.attributes,
						children: [],
						data: {},
					},
				);
				parent.children.splice(i, 1);
				continue;
			}
		}

		mergeInlineSocialLinks(child);
	}
}
