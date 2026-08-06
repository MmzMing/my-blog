/**
 * 主题知识库配置。
 *
 * 这里是站点主题体系的唯一数据源，负责描述一个主题的 URL 标识、展示信息
 * 以及文章自动归类时使用的关键词。专题页、文章详情页的专题标签、知识库
 * JSON 接口和文章自动归类逻辑都会读取本文件，因此新增或调整主题时应优先
 * 修改这里，而不是在各个页面组件中重复维护主题文案。
 */
export type TopicDefinition = {
	/** 主题的稳定 URL 标识，同时也是文章 frontmatter 中 topics 的取值。 */
	slug: string;
	/** 主题在页面和机器可读数据中的显示名称。 */
	title: string;
	/** 主题页的简介，用于帮助读者和 AI 快速判断主题覆盖范围。 */
	description: string;
	/** 自动归类文章时用于匹配标题、分类和标签的关键词。 */
	keywords: string[];
};

/**
 * 所有公开主题的定义列表。
 *
 * `slug` 必须保持唯一，并且只能使用稳定、适合放入 URL 的值。关键词匹配
 * 当前采用不区分大小写的包含匹配：关键词越有代表性，自动归类结果越可靠；
 * 过于宽泛的关键词可能把无关文章归入该主题。没有显式主题且没有匹配结果
 * 的文章会由知识库逻辑归入 `deployment`，因此该主题应始终保留。
 */
export const topicDefinitions: TopicDefinition[] = [
	{
		// 覆盖 AI 搜索、RAG、Prompt、智能体及 AI 辅助开发等内容。
		slug: "ai",
		title: "AI 工程与工作流",
		description: "记录 AI 搜索、RAG、Prompt、智能体与 AI 辅助开发的工程实践。",
		keywords: ["ai", "rag", "prompt", "skill", "工作流", "astrbot", "机器人"],
	},
	{
		// 覆盖登录协议、身份校验、验证码、令牌以及实时认证链路等内容。
		slug: "auth-security",
		title: "认证、登录与安全",
		description:
			"围绕登录、OAuth2、JWT、扫码登录、验证码和令牌安全的方案设计。",
		keywords: [
			"认证",
			"登录",
			"oauth",
			"jwt",
			"安全",
			"验证码",
			"token",
			"websocket",
		],
	},
	{
		// 覆盖 Redis 数据结构、缓存设计、数据库和分布式性能优化等内容。
		slug: "redis-performance",
		title: "Redis 与高性能设计",
		description:
			"分析 Redis 数据结构、缓存、Bitmap、分布式系统与数据库性能优化。",
		keywords: [
			"redis",
			"bitmap",
			"缓存",
			"高性能",
			"性能优化",
			"分布式",
			"数据库",
			"oracle",
		],
	},
	{
		// 覆盖 Java 线程模型、线程池、虚拟线程和异步编排等内容。
		slug: "java-concurrency",
		title: "Java 与并发编程",
		description: "整理 Java 线程池、虚拟线程、异步编排和企业级并发实践。",
		keywords: ["java", "线程池", "虚拟线程", "并发", "spring"],
	},
	{
		// 覆盖博客框架、部署平台、容器、站点运维和观测等工程内容。
		slug: "deployment",
		title: "部署与博客工程",
		description:
			"记录 Astro、Firefly、Docker、Vercel、Cloudflare 和个人站点的工程化实践。",
		keywords: [
			"部署",
			"docker",
			"vercel",
			"cloudflare",
			"astro",
			"firefly",
			"博客",
			"minio",
			"umami",
		],
	},
];

/**
 * 根据主题 slug 获取完整主题定义。
 *
 * 页面组件使用返回值生成主题名称、简介和链接；知识库生成器则用它校验
 * frontmatter 中显式填写的主题是否存在。找不到主题时返回 `undefined`，
 * 调用方可以据此忽略无效主题，而不会生成指向不存在专题页的链接。
 */
export function getTopicDefinition(slug: string): TopicDefinition | undefined {
	return topicDefinitions.find((topic) => topic.slug === slug);
}
