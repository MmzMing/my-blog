import { type CollectionEntry, render } from "astro:content";

type PostEntry = CollectionEntry<"posts">;
type RenderedPost = Awaited<ReturnType<typeof render>>;

const renderCache = new Map<string, Promise<RenderedPost>>();

/**
 * 文章详情页与列表页共享同一次 Markdown 渲染。
 * render() 会触发正文图片优化，重复调用会生成内容相同但哈希不同的图片变体。
 */
export function renderPostCached(entry: PostEntry): Promise<RenderedPost> {
	const cached = renderCache.get(entry.id);
	if (cached) return cached;
	const pending = render(entry);
	renderCache.set(entry.id, pending);
	return pending;
}
