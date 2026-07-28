// AI 搜索配置
// 支持第三方 API（如 ModelScope）和 Cloudflare Workers AI 两种后端
// 配置了 API Key 时走第三方，否则回退 Workers AI 内置模型
export const aiSearchConfig = {
	// AI 搜索站点总开关（修改后需要重新构建部署）
	enabled: false,
	// ── AI 服务商配置 ──────────────────────────────
	provider: {
		// 第三方 API 地址（当前使用魔搭社区 ModelScope）
		apiUrl: "https://api-inference.modelscope.cn/v1",
		// 第三方对话模型
		chatModel: "deepseek-ai/DeepSeek-V4-Flash",
		// 第三方 Embedding 模型
		embeddingModel: "Qwen/Qwen3-Embedding-8B",
		// Embedding 向量维度（必须与 Vectorize 索引维度一致）
		embeddingDimensions: 1024,
		// Workers AI 回退对话模型
		workersAiChatModel: "@cf/meta/llama-3-8b-instruct",
		// Workers AI 回退 Embedding 模型
		workersAiEmbeddingModel: "@cf/baai/bge-large-en-v1.5",
	},
	// ── 请求限制 ──────────────────────────────────
	request: {
		// 请求体最大字节数
		maxBodyBytes: 16 * 1024,
		// 用户问题最大字符数
		maxQuestionCharacters: 1000,
		// 历史记录最大条数
		maxHistoryEntries: 20,
		// 历史记录总字符数上限
		maxHistoryCharacters: 2000,
		// 历史窗口（携带最近 N 轮对话）
		historyWindow: 6,
	},
	// ── 向量检索 ──────────────────────────────────
	retrieval: {
		// 返回 Top-K 结果数
		topK: 10,
		// 最低相似度阈值（低于此值的结果将被过滤）
		minScore: 0.2,
	},
	// ── 频率限制 ──────────────────────────────────
	rateLimit: {
		// 窗口内最大请求数
		maxRequests: 10,
		// 窗口时间（秒）
		windowSeconds: 60,
	},
	// ── 向量索引 ──────────────────────────────────
	index: {
		// Vectorize 索引名称
		name: "blog-ai-search",
		// 清单文件 Schema 版本
		manifestSchemaVersion: 2,
		// 批量写入索引时的每批条数
		batchSize: 500,
		// Embedding API 的批量处理条数
		embeddingBatchSize: 50,
		// 最小分块字符数（低于此值的块将被丢弃）
		minimumChunkCharacters: 50,
		// 摘要最大字符数（页面展示用）
		maximumExcerptCharacters: 500,
	},
} as const;

// 对外公开的配置（不含敏感字段，可供客户端使用）
export const aiSearchPublicConfig = {
	// AI 搜索是否启用
	enabled: aiSearchConfig.enabled,
	// 使用的对话模型名称
	modelName: aiSearchConfig.provider.chatModel,
} as const;
