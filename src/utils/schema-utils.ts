import { homeConfig, siteConfig } from "@/config";

/**
 * 站点级 JSON-LD 实体（WebSite / Person / Organization）的唯一构造点。
 *
 * 这三个实体靠稳定的 @id（#website / #person / #organization）互相引用，而 JSON-LD 的
 * @id **不跨文档解析**：任何用 { "@id": ... } 引用它们的页面，都必须在同一份
 * <script type="application/ld+json"> 的 @graph 里带上被引用的节点，否则就是悬空引用
 * （Google 会判 Article 缺 author）。因此首页 / 关于页与文章页共用这里的构造函数，
 * 而不是各写一份——两份定义迟早字段漂移。
 */

/** 站点根绝对 URL（带尾斜杠），所有实体 @id 的前缀。 */
function resolveSiteRoot(site: URL | string | undefined): string {
	return new URL("/", site ?? siteConfig.site_url).href;
}

/** 作者个人页绝对 URL，作为 Person.url。 */
function resolveAboutUrl(site: URL | string | undefined): string {
	return new URL("/about/", site ?? siteConfig.site_url).href;
}

/** 站点默认 OG 图绝对 URL，供 Person.image 与 Organization.logo 使用。 */
function resolveDefaultImageUrl(site: URL | string | undefined): string {
	return new URL(siteConfig.defaultOgImage, site ?? siteConfig.site_url).href;
}

/** sameAs 表示"同一身份的其他地址"，只收绝对 http(s) 外链；站内相对链接与 mailto: 不算。 */
function resolveSameAs(): string[] {
	return homeConfig.links
		.filter((link) => /^https?:\/\//i.test(link.url))
		.map((link) => link.url);
}

export function buildWebSiteEntity(
	site: URL | string | undefined,
): Record<string, unknown> {
	const siteRoot = resolveSiteRoot(site);
	return {
		"@type": "WebSite",
		"@id": `${siteRoot}#website`,
		url: siteRoot,
		name: siteConfig.title,
		description: siteConfig.description,
		inLanguage: siteConfig.lang.replace("_", "-"),
		publisher: { "@id": `${siteRoot}#organization` },
	};
}

export function buildPersonEntity(
	site: URL | string | undefined,
): Record<string, unknown> {
	const siteRoot = resolveSiteRoot(site);
	return {
		"@type": "Person",
		"@id": `${siteRoot}#person`,
		name: homeConfig.name,
		url: resolveAboutUrl(site),
		description: siteConfig.description,
		image: resolveDefaultImageUrl(site),
		jobTitle: homeConfig.occupation,
		knowsAbout: siteConfig.keywords,
		sameAs: resolveSameAs(),
	};
}

export function buildOrganizationEntity(
	site: URL | string | undefined,
): Record<string, unknown> {
	const siteRoot = resolveSiteRoot(site);
	const imageUrl = resolveDefaultImageUrl(site);
	return {
		"@type": "Organization",
		"@id": `${siteRoot}#organization`,
		name: siteConfig.title,
		url: siteRoot,
		logo: {
			"@type": "ImageObject",
			"@id": `${siteRoot}#logo`,
			url: imageUrl,
		},
		sameAs: resolveSameAs(),
	};
}

/** 内联进 <script> 前必须转义 `<`，否则正文里的 `<` 会提前闭合标签。 */
export function serializeJsonLd(data: unknown): string {
	return JSON.stringify(data).replaceAll("<", "\\u003c");
}
