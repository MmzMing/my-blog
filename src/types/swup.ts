/**
 * Swup 4 运行时的最小类型面。
 *
 * `@swup/astro` 用 `globalInstance: true` 把实例挂在 `window.swup` 上，编译期拿不到
 * swup 自己导出的类型，于是原先只能写成 `any`。这里按 swup 4.9 的 `HookDefinitions`
 * 手写本仓库真正用到的那一部分，让钩子名、回调入参和导航选项都能被类型检查住。
 *
 * 两个容易踩的点：
 *   - 钩子名是冒号分段的（`content:replace`）。swup 3 的驼峰名（`contentReplaced`、
 *     `willReplaceContent`）在 swup 4 下不存在，写上去不会报错也永远不触发。
 *   - `navigate()` 的 `history` 只认 `"push"` / `"replace"`，传别的值会被静默忽略。
 */

/** 本仓库用到的 swup 4 钩子名。 */
export type SwupHookName =
	| "enable"
	| "disable"
	| "link:click"
	| "visit:start"
	| "visit:abort"
	| "visit:end"
	| "page:view"
	| "content:replace"
	| "content:scroll"
	| "history:popstate";

export interface SwupPageData {
	url: string;
	html: string;
}

export interface SwupVisitLocation {
	url: string;
	hash?: string;
}

export interface SwupVisit {
	readonly from: SwupVisitLocation;
	readonly to: SwupVisitLocation;
	readonly done: boolean;
}

/** 钩子第二个入参的形状。未列出的钩子没有额外入参。 */
interface SwupHookArgsMap {
	"link:click": { el: HTMLAnchorElement; event: Event };
	"page:view": { url: string; title: string };
	"content:replace": { page: SwupPageData };
	"history:popstate": { event: PopStateEvent };
}

export type SwupHookArgs<T extends SwupHookName> =
	T extends keyof SwupHookArgsMap ? SwupHookArgsMap[T] : undefined;

export type SwupHookHandler<T extends SwupHookName> = (
	visit: SwupVisit,
	args: SwupHookArgs<T>,
) => void;

export interface SwupHookOptions {
	/** 在钩子的默认逻辑之前执行 */
	before?: boolean;
	/** 只执行一次 */
	once?: boolean;
	/** 数值越小越先执行 */
	priority?: number;
}

/** `swup.hooks` 的注册接口，返回值是取消注册的函数。 */
export interface SwupHooks {
	on<T extends SwupHookName>(
		hook: T,
		handler: SwupHookHandler<T>,
		options?: SwupHookOptions,
	): () => void;
	before<T extends SwupHookName>(
		hook: T,
		handler: SwupHookHandler<T>,
		options?: SwupHookOptions,
	): () => void;
	once<T extends SwupHookName>(
		hook: T,
		handler: SwupHookHandler<T>,
		options?: SwupHookOptions,
	): () => void;
	off<T extends SwupHookName>(hook: T, handler?: SwupHookHandler<T>): void;
}

/** swup 4 的 history 动作，注意没有 `false`。 */
export type SwupHistoryAction = "push" | "replace";

export interface SwupNavigateOptions {
	history?: SwupHistoryAction;
	animate?: boolean;
	cache?: { read?: boolean; write?: boolean };
}

export interface SwupInstance {
	readonly hooks: SwupHooks;
	readonly visit: SwupVisit;
	navigate(url: string, options?: SwupNavigateOptions): void;
	/** 由 `@swup/preload-plugin` 提供，未启用时不存在 */
	preload?(url: string): Promise<unknown>;
}

/** 页面级孤岛挂载时拿到的上下文。 */
export interface PageIslandContext {
	/** 当前导航代数，首次加载为 0 */
	readonly generation: number;
}

export interface PageIslandOptions {
	/** 全局唯一标识，用于跨导航去重；重复注册会替换掉上一次的登记 */
	readonly name: string;
	/**
	 * 挂载。一代导航只会被调用一次。
	 * 返回值被忽略，清理逻辑请写在 `unmount` 里。
	 */
	mount(context: PageIslandContext): void;
	/**
	 * 卸载。在 `astro:before-swap`（容器被替换之前）调用，
	 * 此时被 pin 的节点和 ScrollTrigger 自插的 `.pin-spacer` 还在文档里。
	 * 未挂载时不会被调用。
	 */
	unmount?(): void;
	/** 返回 false 时跳过本代挂载，用于「只在某类页面生效」的孤岛 */
	match?(): boolean;
}

/** 挂在 window 上的运行时状态，仅供 `swup-lifecycle` 内部使用。 */
export interface SwupRuntimeState {
	generation: number;
	readonly islands: Map<string, SwupIslandRecord>;
	readonly persistent: Set<string>;
	readonly pendingReady: Array<(swup: SwupInstance) => void>;
	resolving: boolean;
}

export interface SwupIslandRecord extends PageIslandOptions {
	/** 最近一次尝试挂载的代数，-1 表示从未尝试 */
	attemptedGeneration: number;
	/** 当前已挂载的代数，-1 表示未挂载 */
	mountedGeneration: number;
}
