---
title: Skill学习 | 收集
published: 2026-04-12
description: 收集实用的 AI Agent Skill，涵盖工程化工作流、技能创建器、技术图表生成等开发辅助工具。
tags: [AI, Skill, Agent]
category: 学习文档
draft: false
---

> [!NOTE] 提示
> 在拿到陌生的SKILL时候，一定要让AI先解释一下，再开始使用。否则很有可能染上赛博花柳。

# 一、superpowers — 工程化开发工作流

- **地址**: [obra/superpowers](https://github.com/obra/superpowers)
- **简短解释**: AI Agent 开发工作流的决定版，核心理念是 **Process over Prompt**，给 AI 套上软件工程的纪律与护栏，强制先思考、再规划、后编码、必验证。
- **包含哪些 skill**:
  - `test-driven-development` — 强制 TDD
  - `systematic-debugging` — 4 阶段调试
  - `verification-before-completion` — 无验证证据无完成声明
  - `brainstorming` — 编码前头脑风暴与需求探索
  - `writing-plans` — 拆分为 2-5 分钟细粒度任务
  - `executing-plans` — 批量执行任务 + 人工检查点
  - `subagent-driven-development` — 子代理 + 两阶段审查
  - `dispatching-parallel-agents` — 并行派发独立任务
  - `using-superpowers` — 元技能，检查适用技能
  - `requesting-code-review` — 派发 reviewer 子代理
  - `receiving-code-review` — 技术性评估反馈
  - `finishing-a-development-branch` — 分支收尾流程
  - `using-git-worktrees` — 隔离工作区
  - `writing-skills` — 用 TDD 写新技能
- **安装**:
  ```bash
  /plugin marketplace add obra/superpowers-marketplace
  /plugin install superpowers@superpowers-marketplace
  ```
- **卸载**:
  ```bash
  /plugin uninstall superpowers
  ```

---

# 二、skill-creator — 技能创建器

- **地址**: [anthropics/skills/skill-creator](https://github.com/anthropics/skills/tree/main/skills/skill-creator)
- **简短解释**: Anthropic 官方元技能，用来创建新 Skill 的 Skill，提供标准化创建框架。
- **包含哪些 skill**: 自身即技能创建器，覆盖捕获意图、编写 SKILL.md、创建测试、评估基准、迭代优化、描述优化等流程。
- **安装**: 无
- **卸载**: 无

---

# 三、fireworks-tech-graph — 技术图表生成

- **地址**: [yizhiyanhua-ai/fireworks-tech-graph](https://github.com/yizhiyanhua-ai/fireworks-tech-graph)
- **简短解释**: 从自然语言生成生产级 SVG + PNG 技术图表，无需学习 Mermaid/PlantUML 语法。
- **包含哪些 skill**: 7 种图表风格——架构图、流程图、时序图、UML 类图、AI/Agent 工作流模式图、网络拓扑图、状态机图。
- **安装**: 无
- **卸载**: 无

---

# 四、addyosmani/agent-skills — 生产级工程技能集

- **地址**: [addyosmani/agent-skills](https://github.com/addyosmani/agent-skills)
- **简短解释**: Addy Osmani 维护的生产级 AI Agent 工程技能集合，覆盖从需求定义到生产发布的完整软件生命周期，强调流程、验证与反合理化。
- **包含哪些 skill**: 24 个 skill（23 个生命周期 skill + 1 个元 skill）
  - Define: `interview-me`、`idea-refine`、`spec-driven-development`
  - Plan: `planning-and-task-breakdown`
  - Build: `incremental-implementation`、`test-driven-development`、`context-engineering`、`source-driven-development`、`doubt-driven-development`、`frontend-ui-engineering`、`api-and-interface-design`
  - Verify: `browser-testing-with-devtools`、`debugging-and-error-recovery`
  - Review: `code-review-and-quality`、`code-simplification`、`security-and-hardening`、`performance-optimization`
  - Ship: `git-workflow-and-versioning`、`ci-cd-and-automation`、`deprecation-and-migration`、`documentation-and-adrs`、`observability-and-instrumentation`、`shipping-and-launch`
  - Meta: `using-agent-skills`
- **安装**:
  ```bash
  /plugin marketplace add addyosmani/agent-skills
  /plugin install agent-skills@addy-agent-skills
  ```
- **卸载**:
  ```bash
  /plugin uninstall agent-skills
  ```

---

# 五、mattpocock/skills — 工程师实战技能集

- **地址**: [mattpocock/skills](https://github.com/mattpocock/skills)
- **简短解释**: TypeScript 专家 Matt Pocock 维护的个人技能集，从真实工程实践中蒸馏而来。
- **包含哪些 skill**: 多个 TypeScript 与工程实战相关 skill，具体以仓库目录为准。
- **安装**: 无
- **卸载**: 无
