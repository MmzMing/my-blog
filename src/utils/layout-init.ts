/**
 * Layout 客户端初始化编排 —— 全站「非页面级」客户端行为的唯一入口。
 *
 * 这里只负责编排，不写具体实现：常驻控制器的安装、Swup 切页钩子的注册、
 * 以及跨导航要重跑的容器内增强。想知道某个行为什么时候跑，看这一个文件就够。
 *
 * 页面级组件**不要**加到这里 —— 它们各自在自己的 `<script>` 里用
 * [swup-lifecycle.ts](./swup-lifecycle.ts) 的 `definePageIsland` 登记，
 * 这样组件被删掉时其生命周期也一起消失，不会在这里留下悬空调用。
 *
 * 从 `Layout.astro` 迁出的依据是 CLAUDE.md 5.7：客户端行为写成 `src/utils/` 下的纯 TS 模块，
 * 由组件 `<script>` 导入，不把逻辑内联进组件。
 */

import { ArticleOutlineRailRuntime } from "@/utils/article-outline-controller";
import { scheduleContentOverflowEnhancements } from "@/utils/content-overflow";
import { installLazyCollapsibleCodeController } from "@/utils/lazy-collapsible-code-controller";
import { initPageLoader } from "@/utils/page-loader-controller.js";
import { installSwupCssPrefetch } from "@/utils/swup-css-prefetch";
import {
	definePageIsland,
	definePersistentIsland,
} from "@/utils/swup-lifecycle";
import { setupSwupTransitions } from "@/utils/swup-transitions";

/** 加密文章解密后正文才插入，需要补跑一次内容增强 */
const DECRYPT_RESCAN_DELAY = 200;

export function initLayout(): void {
	// 超长代码块的懒折叠：事件委托挂在 document 上，装一次就够
	definePersistentIsland(
		"layout:lazy-collapsible-code",
		installLazyCollapsibleCodeController,
	);

	// 文章右侧大纲轨道：运行时内部已按页面级孤岛登记，这里只负责创建它
	definePersistentIsland("layout:article-outline-rail", () => {
		window.__articleOutlineRailRuntime = new ArticleOutlineRailRuntime();
		window.__articleOutlineRailRuntime.start();
	});

	// 进度条、回顶、主题校正、侧边栏显隐
	definePersistentIsland("layout:swup-transition", setupSwupTransitions);

	// hover 预载时顺带预取目标页 CSS，消除按页拆包后 Swup 首访的串行样式表等待
	definePersistentIsland("layout:swup-css-prefetch", installSwupCssPrefetch);

	// 首屏加载页
	definePersistentIsland("layout:page-loader", () => {
		initPageLoader();
	});

	// 正文里的 KaTeX 公式与宽表格包裹：容器内的东西，随导航重跑
	definePageIsland({
		name: "layout:content-overflow",
		mount: scheduleContentOverflowEnhancements,
	});

	definePersistentIsland("layout:decrypt-rescan", () => {
		document.addEventListener("password:decrypted", () => {
			setTimeout(scheduleContentOverflowEnhancements, DECRYPT_RESCAN_DELAY);
		});
	});
}
