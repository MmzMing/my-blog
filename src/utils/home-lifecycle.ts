/**
 * 首页各层的挂载闸门。
 *
 * 首页组件（HomeHero / HomeTicker / HomeDataLayer / HomeBlinds / HomeMobile）的
 * `<script>` 被 Astro 输出在 `#swup-container` **内部**。Swup 用 DOMParser 解析新页面
 * 再替换容器，这样插进来的 script 不会自己执行 —— 真正让它们跑起来的是
 * SwupScriptsPlugin（`@swup/astro` 的 `reloadScripts` 默认开启）在 `content:replace`
 * 上把整个 document 的 script 克隆重插一遍。它们是 module script，重插后异步执行，
 * 落点相对 `page:view` 并不确定，于是同一个组件存在三条互相矛盾的初始化路径：
 *
 *   1. 首次进首页且模块落在 `page:view` 之后：本次导航的 `astro:page-load` 已经派发完，
 *      模块里注册的监听收不到，只能靠模块顶层那句自启；
 *   2. 首次进首页且模块落在 `page:view` 之前：顶层自启一次，紧接着 `astro:page-load`
 *      又启一次，同一层被挂载两遍（hero 的 fly-text 会被拆两次，画面就乱了）；
 *   3. 第二次及以后再进首页：这些 URL 已在 module map 里，重插不再执行，
 *      初始化又只由 `astro:page-load` 驱动。
 *
 * 这里把「什么时候挂载」收敛成一处，并用「本次首页 DOM 的根节点」当去重令牌：
 * 根节点每次导航都是新解析出来的，因此无论顶层自启与 `astro:page-load` 谁先谁后、
 * 触发几次，一次导航只会挂载一次；不在首页时 `querySelector` 取不到根节点，直接跳过。
 */

const HOME_ROOT_SELECTOR = ".home-page";

export type HomeLayerHooks = {
	/** 挂载：一次导航只会被调用一次 */
	boot: () => void;
	/**
	 * 卸载：在 `astro:before-swap`（容器被替换之前）调用。
	 * 此时被 pin 的节点与 ScrollTrigger 自插的 `.pin-spacer` 还在文档里，
	 * kill() 才不会落在游离节点上做 revert。
	 * 非首页导航同样会触发，因此必须能在「什么都没挂载」时安全调用。
	 */
	teardown?: () => void;
};

export function bindHomeLayer({ boot, teardown }: HomeLayerHooks): void {
	let bootedRoot: Element | null = null;

	const mount = () => {
		const root = document.querySelector(HOME_ROOT_SELECTOR);
		if (!root || root === bootedRoot) return;
		bootedRoot = root;
		boot();
	};

	const unmount = () => {
		// 一并断开对旧根节点的引用，避免整棵已脱离文档的首页 DOM 被这里留住
		bootedRoot = null;
		teardown?.();
	};

	mount();
	document.addEventListener("astro:page-load", mount);
	document.addEventListener("astro:before-swap", unmount);
}
