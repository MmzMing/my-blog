# 配置文件说明

本目录包含 Firefly 主题的所有配置文件，采用模块化设计，每个文件负责特定的功能模块。

## 📁 配置文件结构

```
src/config/
├── index.ts                   # 配置索引文件 - 统一导出
├── siteConfig.ts              # 站点基础配置
├── homeConfig.ts              # 首页与用户资料配置（含首页图片、技能图标、作品百叶窗）
├── musicConfig.ts             # 音乐播放器配置
├── commentConfig.ts           # 评论系统配置
├── announcementConfig.ts      # 公告配置
├── licenseConfig.ts           # 许可证配置
├── footerConfig.ts            # 页脚配置
├── expressiveCodeConfig.ts    # 代码高亮配置
├── fontConfig.ts              # 字体配置
├── sidebarConfig.ts           # 侧边栏配置
├── navBarConfig.ts            # 导航栏配置
├── pioConfig.ts               # 看板娘模型配置（Spine / Live2D）
├── friendsConfig.ts           # 友链配置
├── galleryConfig.ts           # 相册配置
├── sponsorConfig.ts           # 赞助配置
├── coverImageConfig.ts        # 封面图配置
├── calendarConfig.ts          # 日历小组件配置
├── aiSearchConfig.ts          # AI 搜索配置
├── llmsConfig.ts              # LLM 机器入口与 GEO 文案配置
├── collectionsApiConfig.ts    # 收藏 API 配置
├── plantumlConfig.ts          # PlantUML 图表配置
└── README.md                  # 本文件
```

## 🚀 使用方式

### 推荐：使用配置索引（统一导入）
```typescript
import { siteConfig, homeConfig } from '../config';
```

### 直接导入单个配置
```typescript
import { siteConfig } from '../config/siteConfig';
import { homeConfig } from '../config/homeConfig';
```

## 📋 配置文件列表

- `siteConfig.ts` - 站点基础配置（标题、描述、主题色等）
- `homeConfig.ts` - 首页与用户资料配置（头像、姓名、社交链接、首页图片、技能图标、作品百叶窗等）
- `musicConfig.ts` - 音乐播放器配置（导出 `musicPlayerConfig`）
- `commentConfig.ts` - 评论系统配置（Waline / Twikoo / Giscus / Artalk / Disqus）
- `announcementConfig.ts` - 公告配置（标题、内容、链接等）
- `licenseConfig.ts` - 许可证配置（CC 协议等）
- `footerConfig.ts` - 页脚配置
- `expressiveCodeConfig.ts` - 代码高亮配置（主题等）
- `fontConfig.ts` - 字体配置（字体族、大小等）
- `sidebarConfig.ts` - 侧边栏配置（导出 `sidebarLayoutConfig`）
- `navBarConfig.ts` - 导航栏配置（导出 `navBarConfig`）
- `pioConfig.ts` - 看板娘模型配置（导出 `spineModelConfig`、`live2dModelConfig`）
- `friendsConfig.ts` - 友链配置（导出 `friendsPageConfig`、`friendsConfig`、`getEnabledFriends`）
- `galleryConfig.ts` - 相册配置
- `sponsorConfig.ts` - 赞助配置（赞助方式、二维码等）
- `coverImageConfig.ts` - 封面图配置（随机封面图列表等）
- `calendarConfig.ts` - 日历小组件配置
- `aiSearchConfig.ts` - AI 搜索配置
- `llmsConfig.ts` - LLM 机器入口、主题说明与 GEO 文案配置
- `collectionsApiConfig.ts` - 收藏 API 配置
- `plantumlConfig.ts` - PlantUML 图表配置


```
