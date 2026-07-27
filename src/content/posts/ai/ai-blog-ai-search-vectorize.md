---
title: AI 搜索 | Cloudflare Vectorize 实现问答搜索
published: 2026-05-14
description: 基于 Cloudflare Vectorize 实现博客 AI 语义搜索，涵盖 Markdown 分块、向量化、RAG 检索及 Worker 流式问答。
tags: [AI, RAG, Cloudflare]
category: 设计文档
draft: false
---

# 一、背景

博客已有 Pagefind 全文搜索，但它是关键词匹配——用户搜「缓存穿透怎么解决」，如果文章标题和正文中没有这几个字，就搜不到。

需要的是语义搜索：用户提问，AI 基于博客内容生成回答，并附上参考文章链接。

# 二、架构

```
┌─────────────────────────────────────────────┐
│  前端 Svelte 聊天组件                        │
│  POST /api/ai-chat → SSE 流式接收            │
└──────────────┬──────────────────────────────┘
               ▼
┌─────────────────────────────────────────────┐
│  Cloudflare Worker                          │
│  1. 问题 → embedding 向量                    │
│  2. Vectorize 检索 topK 相似段落             │
│  3. 拼接 prompt（系统指令 + 检索结果 + 问题）│
│  4. 调用 LLM 流式生成回答                    │
│  5. SSE 返回 chunk + 参考文章                │
└──────────────┬──────────────────────────────┘
               ▼
┌─────────────────────────────────────────────┐
│  Cloudflare Vectorize                       │
│  存储所有文章段落的向量 + metadata            │
└─────────────────────────────────────────────┘
```

核心是 RAG（Retrieval-Augmented Generation）：先检索再生成。

# 三、文档分块策略

直接把整篇文章向量化效果差——一篇 3000 字的文章，embedding 模型只能捕捉到主题，丢失细节。

做法是按 Markdown heading 切段：

```
## 缓存穿透
缓存穿透是指查询一个一定不存在的数据...

### 解决方案
1. 布隆过滤器...
2. 缓存空值...
```

每个段落保留上下文：文章标题 + 日期 + 分类 + 标签 + 章节标题路径 + 正文。打包成一个 chunk：

```
文章：Redis 缓存设计
日期：2025-03-15
分类：笔记
标签：Redis, 缓存
章节：缓存问题 > 缓存穿透

缓存穿透是指查询一个一定不存在的数据...
```

空字段（如无分类、无标签）自动省略，通过 `.filter(Boolean)` 过滤空行。过滤条件：正文少于 50 字的段落丢弃（太短没有检索价值）。

## 1、实现细节

分块逻辑在 `scripts/build-vectorize-index.js` 的 `splitByHeadings()` 中：

```javascript
function splitByHeadings(content, articleTitle) {
  const lines = content.split("\n");
  const chunks = [];
  let currentHeadingPath = [];
  let currentContent = [];

  function flush() {
    const text = currentContent.join("\n").trim();
    if (text.length < 50) return;
    chunks.push({ heading: currentHeadingPath.join(" > ") || articleTitle, text });
  }

  for (const line of lines) {
    const headingMatch = line.match(/^(#{1,4})\s+(.+)/);
    if (headingMatch) {
      flush();
      currentContent = [];
      const level = headingMatch[1].length;
      const title = headingMatch[2].trim();
      currentHeadingPath = currentHeadingPath.slice(0, level - 1);
      currentHeadingPath[level - 1] = title;
    } else {
      currentContent.push(line);
    }
  }
  flush();
  return chunks;
}
```

关键点：
- 只识别 `#` ~ `####` 四级标题，遇到标题就切段
- `currentHeadingPath` 维护层级路径，如 `缓存问题 > 缓存穿透 > 解决方案`
- 每个 chunk 的 ID 由 `slug::heading` 哈希生成，保证同一章节始终对应同一向量 ID
- 每个 chunk 携带 metadata（`articleTitle`、`articlePath`、`published`、`category`、`tags`、`heading`、`excerpt`），供检索结果展示和去重使用

## 2、与 LangChain 递归分块的对比

| 维度 | Heading 分块（本博客） | LangChain RecursiveCharacterTextSplitter |
|---|---|---|
| **切分依据** | 语义边界：Markdown 标题层级 | 字符边界：分隔符列表递归切分 |
| **文档结构理解** | 理解章节层级关系 | 纯文本处理，无结构感知 |
| **语义完整性** | 高，每个 chunk 对应完整小节 | 低，可能把一句话切成两半 |
| **Chunk 大小控制** | 被动，取决于标题下内容多少 | 主动，可精确控制 `chunk_size` |
| **超长处理** | 无，一个标题下几千字仍作为一个 chunk | 有，超长自动继续递归切分 |
| **元信息注入** | 自动注入文章标题、日期、分类、标签、章节路径 | 默认不注入，需额外处理 |
| **实现复杂度** | 简单（正则匹配标题） | 中等（递归逻辑 + 分隔符管理） |
| **适用场景** | 技术文档、博客等结构清晰的 Markdown | 小说、散文、无结构文本 |

LangChain 递归分块的核心逻辑（伪代码）：

```python
separators = ["\n\n", "\n", ". ", " ", ""]  # 从大到小
for sep in separators:
    chunks = text.split(sep)
    if all(len(c) <= chunk_size for c in chunks):
        break
    # 太长的继续用更小的分隔符递归切分
```

**本博客方案的潜在问题**：如果一个标题下的内容非常长（比如一个 `#` 下面有几千字），生成的 chunk 会很大，可能导致 embedding 质量下降、检索粒度太粗。

**改进方向**：先按 Heading 切分保留语义边界，再对超长段落做二次字符切分，同时让子 chunk 继承父标题路径。

# 四、向量化与存储

## 1、构建脚本

`scripts/build-vectorize-index.js` 负责：

1. 读取 `src/content/posts/` 下所有非 draft 文章
2. 按 heading 切段，生成 chunk 列表
3. 调用 embedding API 生成向量
4. 批量写入 Cloudflare Vectorize

支持增量更新——通过 `.vectorize-manifest.json` 记录每篇文章的内容 hash，只处理新增/修改/删除的文章。具体用法和底层 API 见下文「向量索引上传」小节。

## 2、Embedding 来源

两种模式，三者齐备时走第三方 API，否则用 Cloudflare Workers AI 免费模型：

| 模式 | 模型 | 维度 | 特点 |
|---|---|---|---|
| 第三方 API | Qwen3-Embedding-8B | 1024 | 中文效果好，需要 API Key |
| Workers AI | bge-base-en-v1.5 | 768 | 免费，英文为主 |

对话模型同样有两种模式：

| 模式 | 模型 | 特点 |
|---|---|---|
| 第三方 API | DeepSeek-V4-Flash | 效果好，需要 API Key |
| Workers AI | llama-3-8b-instruct | 免费，英文为主 |

配置在 `.env` 中（仅敏感信息），参考 `.env.example`：

```bash
# Cloudflare 凭证（必填）
CLOUDFLARE_API_TOKEN=xxx
CLOUDFLARE_ACCOUNT_ID=xxx

# 第三方 AI API Key（可选，有则走第三方 API，无则回退 Workers AI）
AI_API_KEY=sk-xxx
```

非敏感配置（API 地址、模型名称、向量维度等）统一在 `aiSearchConfig.ts` 中管理，无需在 `.env` 重复配置。

## 3、Cloudflare 凭证获取

**CLOUDFLARE_API_TOKEN**：

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 右上角头像 → **My Profile** → **API Tokens** → **Create Token**
3. 选择 **Create Custom Token**，权限勾选：
   - **Account** → **Vectorize** → **Edit**
   - **Account** → **Workers AI** → **Use**
4. 创建后复制 Token（页面关闭后无法再查看）

**CLOUDFLARE_ACCOUNT_ID**：

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. 点击任意域名 → 概览页右侧栏 **API** 区域 → 复制 **Account ID**
3. 或直接从 URL 中复制：`https://dash.cloudflare.com/<account_id>/...`

**AI_API_KEY**（可选）：

当前使用魔搭社区（ModelScope）的免费接口，注册即可获取：

1. 注册 [ModelScope](https://modelscope.cn)
2. 右上角头像 → **API-KEY 管理** → **创建 API Key**

## 4、Worker Secret 配置

Worker 运行时需要的 `AI_API_KEY` 不能写在代码中，需在 Cloudflare Dashboard 配置：

1. 登录 [Cloudflare Dashboard](https://dash.cloudflare.com)
2. **Workers & Pages** → 选择你的 Worker → **Settings** → **Variables and Secrets**
3. 添加 **Secret** 类型变量：`AI_API_KEY`，值为第三方 API 的 Key

## 5、向量索引上传

构建脚本 `scripts/build-vectorize-index.js` 通过 Cloudflare REST API 操作 Vectorize（不是 Wrangler CLI）：

```bash
# 首次使用前，确保 .env 已配置 CLOUDFLARE_API_TOKEN 和 CLOUDFLARE_ACCOUNT_ID

# 增量更新（只处理新增/修改/删除的文章）
node scripts/build-vectorize-index.js

# 全量重建（删除旧索引，重新创建并上传所有文章向量）
node scripts/build-vectorize-index.js --force
```

全量重建流程：删除旧索引 → 创建新索引（指定维度和 cosine 度量）→ 分批生成 embedding → 分批插入向量。增量更新通过 `.vectorize-manifest.json` 记录每篇文章的内容 hash，只处理有变化的文章。

底层 API 调用：

```javascript
// 插入向量
await fetch(`${API_BASE}/vectorize/v2/indexes/${INDEX_NAME}/insert`, {
  method: "POST",
  headers: { Authorization: `Bearer ${API_TOKEN}` },
  body: JSON.stringify({ vectors }),
});

// 删除向量
await fetch(`${API_BASE}/vectorize/v2/indexes/${INDEX_NAME}/delete-by-ids`, {
  method: "POST",
  headers: { Authorization: `Bearer ${API_TOKEN}` },
  body: JSON.stringify({ ids: batch }),
});

// 查询（Worker 运行时通过绑定调用，不需要 API Token）
const results = await env.VECTORIZE.query(queryVector, {
  topK: 10,
  returnMetadata: true,
});
```

# 五、Worker 端问答流程

`src/worker.js` 中的 `handleAIChat` 处理 `/api/ai-chat`：

## 1、统一配置管理

所有 AI 相关配置集中在 `src/config/aiSearchConfig.ts`，前端组件、构建脚本、Worker 三方共享：

```typescript
export const aiSearchConfig = {
  apiUrl: "https://api-inference.modelscope.cn/v1",  // API 地址
  modelName: "deepseek-ai/DeepSeek-V4-Flash",         // LLM 对话模型
  embeddingModel: "Qwen/Qwen3-Embedding-8B",          // 向量模型
  vectorizeDim: 1024,                                  // 向量维度
  batchSize: 500,                                      // 构建脚本批大小
  embedBatchSize: 50,                                  // Embedding 请求批大小
  indexName: "blog-ai-search",                         // Vectorize 索引名
};
```

Worker 运行时通过 `getAiConfig(env)` 读取配置，非敏感项从 `aiSearchConfig` 取值，仅 API Key 从环境变量 `env.AI_API_KEY` 注入。当配置项和 API Key 都存在时走第三方 API，否则回退到 Cloudflare Workers AI 内置模型。

## 2、Embedding

```javascript
async function getEmbedding(env, text) {
  const cfg = getAiConfig(env);
  if (useThirdParty(env)) {
    const res = await fetch(buildApiUrl(cfg.apiUrl, "/v1/embeddings"), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cfg.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: cfg.embeddingModel,
        input: text,
        dimensions: cfg.vectorizeDim,
        encoding_format: "float",
      }),
    });
    if (!res.ok)
      throw new Error(`Embedding API ${res.status}: ${await res.text()}`);
    const data = await res.json();
    return data.data?.[0]?.embedding;
  }
  const result = await env.AI.run("@cf/baai/bge-base-en-v1.5", { text });
  return result.data[0];
}
```

模型名和维度均从 `aiSearchConfig` 读取，切换模型只需改配置文件。

## 3、向量检索

```javascript
const queryVector = await getEmbedding(env, question);
const results = await env.VECTORIZE.query(queryVector, {
  topK: 10,
  returnMetadata: true,
});
```

过滤 `score < 0.2` 的低相似度结果，按 `articlePath` 去重后拼接上下文。每条匹配结果格式为 `【文章标题 - 章节标题】\n摘要`，用 `---` 分隔。去重后的文章信息（标题、路径、发布日期、摘要、相似度分数）作为 `refs` 事件先于回答发送。

## 4、Prompt 拼接与 system 注入防护

系统提示（system prompt）决定了 AI 的人格和行为准则。如果用户通过构造请求在 `history` 中插入 `role: "system"` 的消息，就可能覆盖或绕过预设人格——这称为 **system 注入攻击**。

防护措施：在拼接 messages 之前，过滤掉 history 中所有 `role === "system"` 的条目，确保只有服务端硬编码的 systemPrompt 生效：

```javascript
const safeHistory = history.filter((m) => m.role !== "system").slice(-6);

const messages = [
  { role: "system", content: systemPrompt },
  ...safeHistory,
  { role: "user", content: question },
];
```

当前人格设定为猫娘「喵墩」，系统提示包含完整的角色背景、语言规范、性格画像等，与博客检索规则拼接后传给 LLM。

## 5、流式返回

SSE 格式，四种事件类型：

```
data: {"type":"refs","articles":[...]}   ← 参考文章（先发）
data: {"type":"chunk","text":"..."}       ← 回答文本片段
data: {"type":"error","error":"..."}      ← 错误信息
data: {"type":"done"}                     ← 结束
```

LLM 后端由 `aiSearchConfig` 决定：配置了 `apiUrl` + `modelName` + `AI_API_KEY` 时走第三方 API（OpenAI 兼容格式流），否则回退 Workers AI（`@cf/meta/llama-3-8b-instruct`，Cloudflare 原生流）。

# 六、前端组件

`src/components/controls/AISearch.svelte`，Svelte 5 + runes。

核心交互：

- **入口**：导航栏「工具」菜单触发 `toggle-ai-search` 事件，或 `Ctrl+K` 快捷键
- **聊天面板**：全屏遮罩 + 居中卡片，移动端底部弹起
- **流式渲染**：逐字显示（打字机效果），光标闪烁动画
- **参考文章**：AI 回答下方显示可点击的原文链接
- **多轮对话**：保留最近 6 条历史消息作为上下文
- **Markdown 渲染**：使用 `marked` 库，支持代码块、列表、引用
- **会话管理**：localStorage 持久化，支持新建、切换、删除、上限控制
- **建议按钮**：空对话时显示预设问题，点击直接发送
- **模型名显示**：标题栏展示当前使用的对话模型名称
- **停止生成**：生成中可点击停止按钮中断流式响应
- **错误处理**：SSE `error` 事件和请求异常均以引用块形式展示

关键状态管理：

```svelte
let messages = $state<Message[]>([]);
let isLoading = $state(false);
let abortCtrl: AbortController | null = null;
let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
let sessionId = $state("");
let sessionList = $state<SessionMeta[]>([]);
let showSessionList = $state(false);
```

流式读取使用 `ReadableStream` + `TextDecoder`，逐行解析 SSE data。生成中可通过 `AbortController` 中断请求，同时取消 `reader`。前端处理四种 SSE 事件：`refs`（参考文章）、`chunk`（文本片段）、`error`（错误信息）、`done`（结束）。

## 1、会话管理

### 1.1 数据结构设计

```typescript
interface SessionMeta {
  id: string;      // 会话唯一标识
  title: string;   // 自动提取的第一条用户消息（前20字）
  updatedAt: number; // 最后更新时间戳
}
```

localStorage 存储策略：
- `ai-chat:sessions` — 会话元数据列表（JSON 数组）
- `ai-chat:session:{id}` — 单个会话的完整消息记录

### 1.2 新建会话

标题栏「新建会话」按钮（`add-circle-outline` 图标），点击后：
1. 保存当前会话到 localStorage
2. 生成新的 `sessionId`
3. 清空消息列表，开始新对话

```typescript
function startNewSession() {
  saveCurrentSession();
  sessionId = generateSessionId();
  messages = [];
  showSessionList = false;
}
```

### 1.3 历史会话列表

标题栏「历史」按钮（`history` 图标），点击展开/收起下拉面板：

```svelte
{#if showSessionList}
  <div class="ai-session-list">
    {#each sessionList as sess}
      <button
        class="ai-session-item"
        class:ai-session-item-active={sess.id === sessionId}
        onclick={() => switchSession(sess.id)}
      >
        <div class="ai-session-info">
          <span class="ai-session-title">{sess.title}</span>
          <span class="ai-session-time">{formatTime(sess.updatedAt)}</span>
        </div>
        <!-- 悬停显示删除按钮 -->
        <span onclick={(e) => { e.stopPropagation(); deleteSession(sess.id); }}>
          <Icon icon="material-symbols:close" size="sm" />
        </span>
      </button>
    {/each}
  </div>
{/if}
```

### 1.4 会话切换

点击历史会话项切换到该会话，自动保存当前会话后加载目标会话的消息：

```typescript
function switchSession(id: string) {
  if (id === sessionId) { showSessionList = false; return; }
  saveCurrentSession();
  sessionId = id;
  messages = loadSessionMessages(id);
  showSessionList = false;
  scrollToBottom();
}
```

### 1.5 会话删除

鼠标悬停会话项时出现删除按钮（`close` 图标），删除后若删除的是当前会话则自动新建会话：

```typescript
function deleteSession(id: string) {
  localStorage.removeItem(STORAGE_SESSION_PREFIX + id);
  sessionList = sessionList.filter((s) => s.id !== id);
  saveSessionListToStorage(sessionList);
  if (id === sessionId) {
    startNewSession();
  }
}
```

### 1.6 会话上限与自动清理

最多保留 **20 个会话**，超出时自动清理最旧的：

```typescript
const MAX_SESSIONS = 20;

// 保存时检查上限
if (sessionList.length > MAX_SESSIONS) {
  const removed = sessionList.splice(MAX_SESSIONS);
  for (const s of removed) {
    localStorage.removeItem(STORAGE_SESSION_PREFIX + s.id);
  }
}
```

### 1.7 自动保存时机

- **每次 AI 回复完成后**：`send()` 的 `finally` 块中调用 `saveCurrentSession()`
- **组件卸载时**：`onMount` 返回的清理函数中保存
- **新建/切换会话前**：先保存当前会话再操作

```typescript
function saveCurrentSession() {
  if (!sessionId || messages.length === 0) return;
  if (messages.some((m) => m.streaming)) return; // 流式中不保存
  localStorage.setItem(STORAGE_SESSION_PREFIX + sessionId, JSON.stringify(messages));
  // 更新 sessionList 元数据...
}
```

### 1.8 初始化恢复

组件挂载时自动恢复最近会话：

```typescript
onMount(() => {
  sessionList = loadSessionListFromStorage();
  if (sessionList.length > 0) {
    const latest = sessionList[0];
    sessionId = latest.id;
    messages = loadSessionMessages(latest.id);
  } else {
    sessionId = generateSessionId();
  }
  // ...
  return () => {
    saveCurrentSession(); // 卸载时保存
  };
});
```

# 七、敏感配置处理

非敏感配置集中在 `src/config/aiSearchConfig.ts`，三方共享。敏感信息（API Key）的配置方式见上文「Worker Secret 配置」小节。

# 八、资源消耗

| 资源 | 免费额度 | 单次问答消耗 | 日均可用 |
|---|---|---|---|
| Workers AI | 10k tokens/天 | ~500-1000 tokens | 10-20 次 |
| Vectorize | 30M 查询/月 | 1 次查询 | ~1M 次/天 |
| Worker 请求 | 100k/天 | 1 次请求 | 100k 次/天 |

个人博客完全够用。

# 九、文件清单

| 文件 | 作用 |
|---|---|
| `scripts/build-vectorize-index.js` | 向量索引构建脚本 |
| `src/worker.js` → `handleAIChat` | Worker 端 RAG 问答 API |
| `src/config/aiSearchConfig.ts` | AI 搜索统一配置中心 |
| `src/components/controls/AISearch.svelte` | 前端聊天 UI |
| `.env.example` | 环境变量模板（含获取说明） |
| `wrangler.toml` | Vectorize + AI 绑定配置 |
| `.vectorize-manifest.json` | 增量更新 manifest（gitignored） |

# 十、踩坑记录

**1. 向量维度不一致**

构建脚本用第三方 API 生成 1024 维向量，但 Vectorize 索引创建时指定了 768 维（Workers AI 的默认值）——写入直接报错。必须保证 `VECTORIZE_DIM` 和索引创建时的 `--dimensions` 一致。

**2. Embedding URL 拼接**

第三方 API 的 base URL 可能带 `/v1` 或 `/chat/completions` 后缀，需要统一清理再拼 `/v1/embeddings`：

```javascript
function buildApiUrl(base, suffix) {
  return base
    .replace(/\/+$/, "")
    .replace(/\/v1\/?$/, "")
    .replace(/\/chat\/completions\/?$/, "") + suffix;
}
```

**3. Workers AI 流式响应格式**

Workers AI 的流式响应和 OpenAI SSE 格式不同，不能用同一套解析逻辑。需要分别处理，且 Workers AI 可能回退到非流式模式（需要额外处理 `response` 字段）。

**4. 相似度阈值**

Vectorize 返回的 cosine score 分布因 embedding 模型而异。实测 Qwen3-Embedding 的 score 整体偏低，0.2 以下基本是无关内容。阈值需要根据实际效果调整。
