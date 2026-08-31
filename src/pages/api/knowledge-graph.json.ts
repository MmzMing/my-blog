import { getKnowledgeGraphData } from "@/utils/content-utils";

/**
 * 四层知识图谱数据端点。
 *
 * 走独立端点而不是内联进 /categories/ 的 data-* 属性：
 * 完整图约 74KB，内联要 HTML 实体转义（实测约 82KB），而 HTML 本身是
 * max-age=0 每次导航都要重新下载，还会被 swup 的 cache 常驻在内存里。
 * 独立 JSON 可以 max-age=3600，跨导航直接命中 HTTP 缓存。
 *
 * 首帧不等这个请求：分类图例与时间轴范围由 KnowledgeGraph.astro 内联的
 * 极小 meta（约 400 字节）服务端渲染，画布数据到了再补。
 */
export async function GET(): Promise<Response> {
	const graph = await getKnowledgeGraphData();

	return new Response(JSON.stringify(graph), {
		headers: {
			"Content-Type": "application/json; charset=utf-8",
			"Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
		},
	});
}
