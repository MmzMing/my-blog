/**
 * Swup 生命周期统一入口。
 *
 * ── 为什么需要它 ──
 * `@swup/astro` 只桥接三个 DOM 事件（node_modules/@swup/astro/src/script.ts）：
 *
 *   astro:before-swap  ← hooks.before("content:replace")   容器被替换之前
 *   astro:after-swap   ← hooks.on("content:replace")       容器已替换
 *   astro:page-load    ← hooks.on("page:view")             导航完成
 *
 * 三个都是裸 `Event`（没有 detail、拿不到 visit），而且**首次加载一个都不会派发** ——
 * swup 的 `page:view` 只在一次 visit 内触发，直接打开页面并没有 visit。所以
 * 「首次加载 + 每次导航各初始化一次」这个最常见的需求，只靠 DOM 事件拼不出来。
 *
 * ── SwupScriptsPlugin 让时机进一步不确定 ──
 * `content:replace` 时它会把 document 里所有不带 `data-swup-ignore-script` 的
 * `<script>` 克隆重插一遍：
 *   - 外部 module 脚本（Astro 编译产物）→ module map 命中，**不再执行**；
 *   - `is:inline` 内联脚本 → **每次导航都重新执行**。
 * 于是同一个组件的初始化时机有三种可能：落在 `page:view` 之前、之后，或者再也不执行。
 * 仓库里因此长出过六七套互不兼容的写法（顶层自启 + astro:page-load、
 * DOMContentLoaded 兜底、window.__xxx_done 布尔、dataset 标记……），
 * 双重初始化和「导航后不再初始化」这两类 bug 都出自这里。
 *
 * ── 收敛办法：导航代数 ──
 * 用「导航代数」当唯一去重令牌。`astro:before-swap` 时先卸载已挂载的孤岛，再把代数 +1。
 * 该事件在容器被替换**之前**派发，所以新容器里的脚本不论何时执行，看到的都已经是新代数；
 * `astro:page-load` 只负责补一次挂载扫描。三种时机由此收敛成同一个结果：
 * **一代只挂一次，且一定挂得上。**
 *
 * ── 怎么选 API ──
 *   definePageIsland        页面级：随容器进出，需要 mount / unmount（绝大多数场景）
 *   definePersistentIsland  常驻级：容器外组件，整个文档生命周期只跑一次
 *   onNavigation            只在导航后同步状态，首次加载不跑（服务端 HTML 已经是对的）
 *   onSwupHook              需要 swup 原生钩子（visit:start / link:click 等）时用
 *
 * `is:inline` 脚本不要用本模块：内联脚本在解析阶段就执行，早于任何 module 脚本，
 * 拿不到这里的导出。它们只需监听上面三个 DOM 事件，并在交互时点惰性读
 * `window.swup?.preload`。
 */

import type {
	PageIslandOptions,
	SwupHookHandler,
	SwupHookName,
	SwupHookOptions,
	SwupInstance,
	SwupIslandRecord,
	SwupRuntimeState,
} from "@/types/swup";

/** 代数哨兵：表示「从未挂载 / 从未尝试」 */
const GENERATION_NONE = -1;

/**
 * 出错的孤岛不能连坐：一个 mount / unmount 抛异常，不该让同代其它孤岛挂不上或拆不掉。
 * 生产构建会 drop console.*，这里的日志只服务开发期定位。
 */
function runGuarded(scope: string, phase: string, task?: () => void): void {
	if (!task) return;
	try {
		task();
	} catch (error) {
		console.error(`[swup-lifecycle] ${scope} ${phase} 失败:`, error);
	}
}

function unmountMounted(runtime: SwupRuntimeState): void {
	for (const island of runtime.islands.values()) {
		if (island.mountedGeneration === GENERATION_NONE) continue;
		island.mountedGeneration = GENERATION_NONE;
		runGuarded(island.name, "unmount", island.unmount);
	}
}

function mountIsland(
	runtime: SwupRuntimeState,
	island: SwupIslandRecord,
): void {
	if (island.attemptedGeneration === runtime.generation) return;
	island.attemptedGeneration = runtime.generation;
	if (island.match && !island.match()) return;

	// 先记代数再 mount：mount 中途抛异常也要让 unmount 有机会被调用，
	// 否则挂了一半的监听与观察者永远收不回来
	const generation = runtime.generation;
	island.mountedGeneration = generation;
	runGuarded(island.name, "mount", () => island.mount({ generation }));
}

function mountAll(runtime: SwupRuntimeState): void {
	for (const island of runtime.islands.values()) {
		mountIsland(runtime, island);
	}
}

/**
 * 取运行时状态，首次调用时创建并挂上两个 document 监听。
 * 状态存在 window 上而不是模块作用域：dev 期 HMR 可能重新求值本模块，
 * 存在 window 上才能保证同一文档里始终只有一份代数与孤岛登记表。
 */
function getRuntime(): SwupRuntimeState {
	const existing = window.__fireflySwupRuntime;
	if (existing) return existing;

	const runtime: SwupRuntimeState = {
		generation: 0,
		islands: new Map(),
		persistent: new Set(),
		pendingReady: [],
		resolving: false,
	};
	window.__fireflySwupRuntime = runtime;

	// 卸载必须发生在代数自增之前：此刻旧容器、被 pin 的节点和 ScrollTrigger 自插的
	// .pin-spacer 都还在文档里，kill() 才不会落在游离节点上做 revert
	document.addEventListener("astro:before-swap", () => {
		unmountMounted(runtime);
		runtime.generation += 1;
	});
	// 新容器脚本可能早于也可能晚于 page:view 执行，这里只是补扫一遍
	document.addEventListener("astro:page-load", () => mountAll(runtime));

	return runtime;
}

/* ========== 实例访问 ========== */

/** 取当前 swup 实例，未就绪时返回 null。 */
export function getSwup(): SwupInstance | null {
	return window.swup ?? null;
}

/**
 * swup 实例就绪后执行；已就绪时**同步**执行，保证钩子能赶在第一次导航之前注册上。
 *
 * `window.swup` 是 `new Swup()` 返回后同步赋的值，而 `swup:enable` 要等一个微任务，
 * 所以「先查实例、查不到再等事件」这个顺序不能颠倒 —— 反过来会漏掉实例已在、
 * enable 已派发完的那种情况。`swup:any` 是兜底：万一 enable 派发完我们才挂上监听，
 * 之后任何一个钩子都能把队列冲掉。
 */
export function onSwupReady(callback: (swup: SwupInstance) => void): void {
	const runtime = getRuntime();
	const swup = getSwup();
	if (swup) {
		runGuarded("swup-ready", "callback", () => callback(swup));
		return;
	}

	runtime.pendingReady.push(callback);
	if (runtime.resolving) return;
	runtime.resolving = true;

	const drain = (): void => {
		const instance = getSwup();
		if (!instance) return;
		document.removeEventListener("swup:enable", drain);
		document.removeEventListener("swup:any", drain);
		runtime.resolving = false;
		for (const queued of runtime.pendingReady.splice(0)) {
			runGuarded("swup-ready", "callback", () => queued(instance));
		}
	};

	document.addEventListener("swup:enable", drain);
	document.addEventListener("swup:any", drain);
}

/** 注册 swup 原生钩子，实例就绪时序由内部处理。 */
export function onSwupHook<T extends SwupHookName>(
	hook: T,
	handler: SwupHookHandler<T>,
	options?: SwupHookOptions,
): void {
	onSwupReady((swup) => {
		if (options?.before) swup.hooks.before(hook, handler, options);
		else if (options?.once) swup.hooks.once(hook, handler, options);
		else swup.hooks.on(hook, handler, options);
	});
}

/** 预载目标页。未启用 preload 插件或预载失败都静默跳过，不影响正常点击导航。 */
export function preloadUrl(url: string): void {
	const swup = getSwup();
	if (!swup?.preload) return;
	void swup.preload(url).catch(() => {
		// 预载纯属加速，失败就走正常导航，不需要告诉用户
	});
}

/* ========== 孤岛注册 ========== */

/**
 * 页面级孤岛：首次加载与每次导航各挂载一次，容器替换前卸载。
 * 用于 Swup 容器（`#swup-container` / 两侧动态侧边栏）内部的组件。
 */
export function definePageIsland(options: PageIslandOptions): void {
	const runtime = getRuntime();

	// is:inline 脚本每次导航都会重新执行并重新注册。正常路径下旧登记已在
	// astro:before-swap 里拆过，这里是防御：真还挂着就先拆掉，避免监听叠加
	const previous = runtime.islands.get(options.name);
	if (previous && previous.mountedGeneration !== GENERATION_NONE) {
		previous.mountedGeneration = GENERATION_NONE;
		runGuarded(previous.name, "unmount", previous.unmount);
	}

	const island: SwupIslandRecord = {
		...options,
		attemptedGeneration: GENERATION_NONE,
		mountedGeneration: GENERATION_NONE,
	};
	runtime.islands.set(options.name, island);
	mountIsland(runtime, island);
}

/**
 * 常驻孤岛：整个文档生命周期只执行一次。
 * 用于 Swup 容器**之外**的组件 —— 它们的 DOM 跨导航持久存在，重复初始化只会叠加监听。
 */
export function definePersistentIsland(name: string, setup: () => void): void {
	const runtime = getRuntime();
	if (runtime.persistent.has(name)) return;
	runtime.persistent.add(name);
	runGuarded(name, "setup", setup);
}

/* ========== 语义化 DOM 事件订阅 ========== */

/**
 * 导航完成后执行，**首次加载不执行**。
 * 适用于「服务端渲染出来的初始状态本来就是对的，只需在导航后重新同步」的常驻组件。
 * 需要覆盖首次加载请改用 `definePageIsland` 或 `definePersistentIsland`。
 */
export function onNavigation(
	handler: () => void,
	options?: { signal?: AbortSignal },
): void {
	getRuntime();
	document.addEventListener("astro:page-load", handler, options);
}

/**
 * 容器替换前执行。常驻组件用它清理指向旧容器 DOM 的引用。
 * 页面级组件请用 `definePageIsland` 的 `unmount`，不要自己挂这个事件。
 */
export function onBeforeSwap(
	handler: () => void,
	options?: { signal?: AbortSignal },
): void {
	getRuntime();
	document.addEventListener("astro:before-swap", handler, options);
}
