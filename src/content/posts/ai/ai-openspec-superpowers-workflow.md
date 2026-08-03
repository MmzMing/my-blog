---
title:  OpenSpec+Superpowers实现流水线开发
published: 2026-06-03
description: OpenSpec 规范驱动开发与 Superpowers 工程化工作流的协同实践，建立"规范驱动规划 + 流程驱动执行"的 AI 编程闭环。
tags: [AI, Skill, 工作流]
category: 学习文档
image: ./cover/cover1.webp
draft: false
---


> [!NOTE] 提示
> 本文面向使用 AI 辅助编程的开发者，系统整理 OpenSpec 与 Superpowers 两个工具的核心能力、配置方法与协同流程。核心目标：建立"规范驱动规划 + 流程驱动执行"的 AI 工程化闭环，降低需求偏差与代码回归风险。

---

# 一、介绍

![OpenSpec + Superpowers 协同工作流：规范驱动规划与流程驱动执行的闭环](./image/ai-openspec-superpowers-workflow.assets/ai-openspec-superpowers-workflow-20260620163505.png)

## 1、Superpowers

**Superpowers** 是由 Jesse Vincent（obra）维护的 AI Agent 工程化开发工作流集合，核心理念是 **Process over Prompt（流程大于提示词）**。它通过一系列结构化的子技能，约束 AI 在编码前完成思考、规划、验收条件定义，在编码中遵循 TDD、子代理审查、代码审查，在编码后完成验证与分支收尾。

**核心价值**：

- 将资深工程师的工作纪律（TDD、代码审查、验证优先）编码为 AI 可遵循的流程。
- 防止 AI 一上来就写代码导致方向偏离。
- 通过强制验证与审查环节，减少"看起来对了但测试没跑"的回归风险。

## 2、OpenSpec

**OpenSpec** 是由 Fission AI 开源的规范驱动开发框架，核心理念是 **Spec before Code（代码之前先写规范）**。它通过结构化工件（proposal、specs、design、tasks）将需求意图、行为契约、技术方案与实现任务固化下来，作为人类与 AI 之间的"真相源"。

**核心价值**：

- 在 AI 写任何一行代码之前，先对齐需求范围与验收条件。
- 通过 Delta Specs 机制让规范像代码一样版本化演进。
- 将 BDD 风格的 Given/When/Then 场景直接转化为测试与验证依据。

---

# 二、作用

## 1、Superpowers 的功能特性与应用场景

| 特性 | 说明 | 适用场景 |
| --- | --- | --- |
| 头脑风暴 | 编码前探索需求边界、识别风险、输出验收条件 | 新功能开发、重大重构 |
| TDD 驱动 | 强制先写失败测试，再写实现，最后重构 | 任何需要保证正确性的逻辑开发 |
| 子代理开发 | 每个任务派发独立子代理 + 两阶段审查 | 复杂多文件改动 |
| 代码审查 | 派发 reviewer 子代理进行五轴审查 | 每次合并前 |
| Git 工作树 | 创建隔离工作区，避免污染主分支 | 并行处理多个变更 |
| 验证铁则 | 没有测试通过证据就不能声明完成 | 所有任务交付节点 |

## 2、OpenSpec 的功能特性与应用场景

| 特性 | 说明 | 适用场景 |
| --- | --- | --- |
| 结构化工件 | proposal / specs / design / tasks 四层文档 | 任何需要需求对齐的项目 |
| Delta Specs | 用 ADDED/MODIFIED/REMOVED 描述增量变更 | 迭代开发、需求变更 |
| 规范归档 | 变更完成后合并到主规范 | 知识沉淀、长期维护 |
| verify 校验 | 检查实现与规范的一致性 | 交付前验收 |
| 多工具支持 | 支持 Claude、Codex、Cursor 等 25+ AI 工具 | 跨工具团队协作 |

---

# 三、使用步骤

## 1、Superpowers 使用步骤

Superpowers 以 Claude Code 插件形式运行，安装后自动生效。日常开发中 AI 会根据当前任务自动匹配并调用相关子技能。

典型执行流程：

```mermaid
flowchart TD
    A["启动任务"] --> B["AI 检查适用的子技能"]
    B --> C["brainstorming<br/>对齐需求与验收条件"]
    C --> D["writing-plans<br/>拆分为 2-5 分钟粒度的任务"]
    D --> E["using-git-worktrees<br/>创建隔离工作区"]
    E --> F["subagent-driven-development<br/>派发子代理逐个完成任务"]
    F --> G["test-driven-development<br/>每个任务遵循 Red-Green-Refactor"]
    G --> H["verification-before-completion<br/>提交测试/命令输出作为完成证据"]
    H --> I["requesting-code-review<br/>子代理审查代码"]
    I --> J["finishing-a-development-branch<br/>测试通过 → merge/PR/keep/discard"]
```

## 2、OpenSpec 使用步骤

OpenSpec 通过 CLI 与 AI 命令两种方式工作。

**快速路径**：

```mermaid
flowchart TD
    A["/opsx:propose <change-name>"] -->|"生成 proposal.md、specs/、design.md、tasks.md"| B["人工审核四个工件"]
    B --> C["/opsx:apply"]
    C -->|"AI 按 tasks.md 逐项实现"| D["/opsx:verify"]
    D -->|"检查实现是否覆盖所有 Spec 场景"| E["/opsx:archive"]
    E -->|"归档变更，增量规范合并到主规范"| F[结束]
```

**探索路径**（需求模糊时使用）：

```mermaid
flowchart LR
    A["/opsx:explore"] --> B["/opsx:propose"] --> C["/opsx:apply"] --> D["/opsx:archive"]
```

**精细路径**（复杂项目、团队协作）：

```mermaid
flowchart LR
    A["/opsx:new"] --> B["/opsx:continue（逐个审核）"] --> C["/opsx:apply"] --> D["/opsx:verify"] --> E["/opsx:archive"]
```

---

# 四、相关 Skill

## 1、Superpowers 子技能

Superpowers 共包含 14 个子技能，覆盖完整 SDLC：

| 类别 | Skill | 用途 |
| --- | --- | --- |
| 核心开发 | `test-driven-development` | 强制 TDD：先写失败测试，再写实现 |
| 核心开发 | `systematic-debugging` | 4 阶段调试：复现→定位→修复→验证 |
| 核心开发 | `verification-before-completion` | 没有验证证据就没有完成声明 |
| 计划设计 | `brainstorming` | 动手前必须先头脑风暴 |
| 计划设计 | `writing-plans` | 拆分为 2-5 分钟的细粒度任务 |
| 计划设计 | `executing-plans` | 批量执行任务 + 人工检查点 |
| 代理统制 | `subagent-driven-development` | 每个任务派发新子代理 + 两阶段审查 |
| 代理统制 | `dispatching-parallel-agents` | 独立任务并行派发 |
| 代理统制 | `using-superpowers` | 元技能：始终检查是否有适用的技能 |
| 协作 Git | `requesting-code-review` | 派发 code-reviewer 子代理 |
| 协作 Git | `receiving-code-review` | 技术性评估反馈 |
| 协作 Git | `finishing-a-development-branch` | 验证测试 → 4 选项 → 执行 → 清理 |
| 协作 Git | `using-git-worktrees` | 创建隔离工作区 + 基线验证 |
| 协作 Git | `writing-skills` | 用 TDD 方法写新技能 |

## 2、OpenSpec 命令与能力

| 命令 | 作用 |
| --- | --- |
| `/opsx:explore` | 需求模糊时先调研，输出方案对比 |
| `/opsx:propose <name>` | 生成 proposal、specs、design、tasks 四个工件 |
| `/opsx:apply` | 按 tasks.md 逐项实现 |
| `/opsx:verify` | 检查实现与 Spec 的一致性 |
| `/opsx:archive` | 归档变更，合并增量规范 |
| `/opsx:new <name>` | 创建新的变更工作区 |
| `/opsx:continue` | 逐个审核并继续执行 |
| `/opsx:ff` | 快速切换变更上下文 |

---

# 五、安装

## 1、环境要求

- **Node.js**：≥ 20.19.0（OpenSpec CLI 要求）
- **AI 客户端**：Claude Code（Superpowers 与 OpenSpec 命令均支持）
- **Git**：用于工作区隔离与变更归档

## 2、安装 Superpowers

```bash
/plugin marketplace add obra/superpowers-marketplace
/plugin install superpowers@superpowers-marketplace
```

安装后无需手动触发，AI 会在每次任务前自动检查适用的子技能。

## 3、安装 OpenSpec

```bash
# 安装 CLI
npm install -g @fission-ai/openspec@latest

# 在项目根目录初始化
cd your-project
openspec init --tools claude
```

初始化后会生成 `.openspec` 目录和 `AGENTS.md` 文件：

```text
openspec/
├── specs/              # 系统当前行为规范（真相源）
│   └── <domain>/
│       └── spec.md
├── changes/            # 每个变更的工作区
│   └── <change-name>/
│       ├── proposal.md
│       ├── design.md
│       ├── tasks.md
│       └── specs/      # 增量规范（Delta Specs）
└── config.yaml
```

---

# 六、卸载

## 1、卸载 Superpowers

```bash
/plugin uninstall superpowers
```

卸载后，AI 不再自动调用 Superpowers 子技能。已创建的工作区与 Git 分支不受影响。

## 2、卸载 OpenSpec

```bash
# 卸载全局 CLI
npm uninstall -g @fission-ai/openspec
```

## 3、残留清理

清理 Superpowers 残留：

```bash
# Claude Code 插件目录（默认位置）
rm -rf ~/.claude/plugins/superpowers
```

清理 OpenSpec 残留：

```bash
# 删除项目内的 OpenSpec 目录与文件
rm -rf .openspec
rm -f AGENTS.md

# 可选：删除已归档的变更记录
rm -rf openspec/
```

---

# 七、协同使用方法

## 1、协同场景

单独使用 OpenSpec，可以解决"想清楚"的问题；单独使用 Superpowers，可以解决"做对了"的问题。两者结合时，Spec 成为 TDD 的输入源，TDD 成为 Spec 的质量保障。

适合协同使用的场景：

- 新功能开发：需求需要结构化对齐，代码需要 TDD 与审查保障。
- 复杂重构：涉及多文件改动，需要明确边界条件与回归测试。
- 团队协作：Spec 作为人类与 AI 之间的契约，降低沟通歧义。
- 长期维护：archive 沉淀知识，worktree 隔离风险。

## 2、协同优势

| 维度 | 单独 OpenSpec | 单独 Superpowers | 组合使用 |
| --- | --- | --- | --- |
| 需求对齐 | Spec 结构化对齐 | 靠 brainstorming 口头对齐 | Spec 结构化对齐 + brainstorming 深度探索 |
| 代码质量 | 无强制测试 | TDD 铁则 | TDD + Spec 双保险 |
| 知识沉淀 | archive 归档 | 只有 Git 历史 | 规范 + 代码 + 决策全保留 |
| 隔离性 | 变更目录隔离 | worktree 隔离 | 两层隔离，互不干扰 |
| 审查 | verify 自动检查 | 子代理审查 | 自动 + 子代理双重审查 |
| 回滚 | 变更目录可追溯 | Git 分支可回滚 | 规范回滚 + 代码回滚 |

## 3、协同操作步骤

```mermaid
flowchart TD
    subgraph Phase1 ["Phase 1: 规划（OpenSpec 主导）"]
        P1_A["/opsx:explore<br/>需求模糊时先探索"]
        P1_B["/opsx:propose<br/>生成 proposal + specs + design + tasks"]
        P1_C["人工审核工件<br/>确认意图、范围、验收条件"]
    end

    subgraph Phase2 ["Phase 2: 执行（Superpowers 主导）"]
        P2_A["git worktree 隔离<br/>using-git-worktrees"]
        P2_B["brainstorming<br/>对每个 task 做需求对齐"]
        P2_C["TDD 实现<br/>先写失败测试 → 写实现 → 重构"]
        P2_D["验证<br/>verification-before-completion"]
        P2_E["代码审查<br/>requesting-code-review"]
    end

    subgraph Phase3 ["Phase 3: 收尾（两者协同）"]
        P3_A["/opsx:verify<br/>检查实现是否匹配 Spec"]
        P3_B["finishing-a-branch<br/>测试通过 → merge/PR/keep/discard"]
        P3_C["/opsx:archive<br/>归档 + 合并规范"]
    end

    P1_A --> P1_B --> P1_C
    P1_C --> P2_A
    P2_A --> P2_B --> P2_C --> P2_D --> P2_E
    P2_E --> P3_A
    P3_A --> P3_B --> P3_C
```

## 4、实战示例：实现订单导出功能

**Step 1：OpenSpec 规划**

```bash
/opsx:propose order-export
```

需求描述：

> 实现订单导出接口，支持按时间范围导出 CSV。单次最多 5000 条，时间范围不超过 31 天，只能导出当前租户数据。

OpenSpec 生成四个工件。审核后确认关键内容：

```markdown
# proposal.md 要点
- 目标：订单导出 CSV 接口
- 范围内：CSV 生成、权限校验、数量限制、时间范围校验
- 范围外：异步导出、邮件通知、Excel 格式

# specs/ 关键场景
Given 用户是 tenant-A 的管理员
When  请求导出 tenant-A 在 2024-01-01 到 2024-01-31 的订单
Then  返回 CSV，字段为 order_no, amount, status, created_at

Given 用户尝试导出 tenant-B 的数据
When  请求导出
Then  返回 403，错误信息为 "无权访问该租户数据"

# tasks.md 清单
1.1 创建 OrderExportController
1.2 实现 OrderExportService（查询 + CSV 生成）
1.3 添加权限校验（只能导出当前租户）
1.4 添加数量限制（≤5000 条）
1.5 添加时间范围校验（≤31 天）
1.6 编写单元测试（覆盖 4 种边界场景）
```

**Step 2：Superpowers 执行**

进入执行阶段后，Superpowers 自动接管：

```text
🧠 brainstorming：对 task 1.1 做需求对齐
   → 确认 Controller 路径、请求参数格式、返回体结构

🌿 git worktree：创建隔离工作区
   → git worktree add ../project-order-export -b feat/order-export

🔴 TDD：先写失败测试
   → test: 导出正常路径返回 CSV
   → test: 超过 5000 条返回 400
   → test: 越权租户返回 403
   → test: 时间范围超限返回 400

🟢 实现：让测试通过
   → 实现 Controller、Service、权限校验

🔵 验证：verification-before-completion
   → 贴出 mvn test 输出
   → 贴出 git diff --stat

🔍 代码审查：requesting-code-review
   → 子代理检查权限绕过风险、SQL 注入、边界条件
```

**Step 3：协同收尾**

```bash
/opsx:verify    # 检查实现是否覆盖所有 Spec 场景
/opsx:archive   # 归档，增量规范合并到主规范
```

Superpowers 的 `finishing-a-development-branch` 负责最终的测试验证与 Git 清理。

## 5、关键协同点

1. **Spec 是 TDD 的输入源**：OpenSpec `specs/` 中的 Given/When/Then 场景可直接转化为测试用例。
2. **verify 对齐 Spec 与实现**：Superpowers 的 `verification-before-completion` 关注"测试通过没"，OpenSpec 的 `verify` 关注"实现跟 Spec 对上了没"。
3. **archive 沉淀知识**：OpenSpec 归档规范，Superpowers 归档代码，两者共同形成可追溯的变更记录。

---

# 八、常见问题

## 1、Q1：OpenSpec 与 Superpowers 必须一起使用吗？

**A**：不是必须。OpenSpec 更适合需求复杂、需要结构化对齐的场景；Superpowers 更适合任何需要工程纪律的编码任务。两者组合可覆盖完整闭环，但单独使用也能产生价值。

## 2、Q2：Superpowers 安装后为什么不生效？

**A**：检查以下三点：

1. 是否正确执行了 `/plugin install` 命令；
2. Claude Code 版本是否支持该插件；
3. 当前任务是否触发了相应的子技能（部分子技能只在特定场景下激活）。

## 3、Q3：OpenSpec 的 Spec 应该写到什么粒度？

**A**：Spec 应描述行为契约（Given/When/Then），不写实现细节。判断标准：如果实现方式变了但外部行为不变，就不该出现在 Spec 里。

## 4、Q4：如何处理开发过程中的需求变更？

**A**：回到 OpenSpec 修改 Spec，重新生成 Delta，然后再用 Superpowers 执行。不要在代码里绕过 Spec。

## 5、Q5：团队如何协作使用 OpenSpec？

**A**：将 `.openspec` 目录纳入版本控制，每个变更独立目录，通过 PR 流程审核 proposal 与 specs。归档后的主规范作为团队共享的真相源。

---

# 九、总结

- **OpenSpec 管"想清楚"**：通过结构化工件将需求、设计、任务固化，作为人类与 AI 的对齐依据。
- **Superpowers 管"做对了"**：通过 TDD、审查、验证铁则确保代码质量。
- **协同使用时**：Spec 成为 TDD 的输入源，TDD 与 verify 共同保证"做对了且做对的事"。

推荐工程流程：

```mermaid
flowchart TD
    A["/opsx:explore"] --> B["/opsx:propose"] --> C["人工审核"] --> D["/opsx:apply"]

    B -->|"brainstorming / writing-plans"| E["需求对齐与任务拆分"]
    D -->|"git worktree / TDD / verification / code review"| F["编码实现与审查"]
    F --> G["/opsx:verify"]
    G --> H["finishing-a-branch"] --> I["/opsx:archive"]
```

对于短期原型，可以精简流程；对于需要长期维护的代码，建议完整执行上述闭环。

---

# 十、参考资料

- [Fission-AI/OpenSpec](https://github.com/Fission-AI/OpenSpec)
- [obra/superpowers](https://github.com/obra/superpowers)
