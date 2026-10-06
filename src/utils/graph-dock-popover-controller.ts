/**
 * 图谱 dock 的筛选弹窗：锚定、开合、点外与 Escape。
 *
 * 弹窗与 dock 竖条都是 .knowledge-graph 的兄弟子节点，几何全部换算到
 * .knowledge-graph 的坐标系里写内联 left/top —— CSS 不参与这两个属性，
 * 否则断点规则和内联样式会互相打架。仓库没有 floating-ui 之类的定位库，
 * 也不为这一个弹窗引入：既有弹窗（navbar-dropdown-controller.ts:69、
 * navbar-profile-controller.ts:627）都是 getBoundingClientRect + 内联样式，
 * 这里跟随同一手法。
 *
 * 移动端反过来以 CSS 为主：横条位置是确定的，弹窗用 bottom/left/right 铺满即可，
 * JS 只写箭头的水平位置，并 removeProperty 掉桌面端可能留下的内联锚点。
 */

/** 与 categories.css 的 --kg-popover-margin 同值：弹窗夹在视窗内的最小边距 */
const POPOVER_EDGE_MARGIN = 16;
/** 弹窗右缘到 dock 外壳左缘的间距，让旋转 45° 的箭头尖正好搭在胶囊描边上 */
const POPOVER_TRIGGER_GAP = 8;
/** 箭头中心距弹窗上下缘的最小距离：0.75rem 方块转 45° 后纵向占 ±8.5px，留足余量 */
const ARROW_EDGE_INSET = 16;
const MOBILE_MEDIA = "(max-width: 768px)";

const clamp = (value: number, min: number, max: number): number =>
	Math.min(Math.max(value, min), max);

interface PopoverRefs {
	root: HTMLElement;
	/** dock 外壳：横向锚点要量它而不是按钮，按钮外面还套着一圈胶囊描边 */
	dock: HTMLElement;
	trigger: HTMLElement;
	popover: HTMLElement;
	arrow: HTMLElement;
	search: HTMLElement | null;
}

export function mountGraphDockPopover(root: HTMLElement): () => void {
	const trigger = root.querySelector<HTMLElement>("[data-kg-popover-trigger]");
	const dock = root.querySelector<HTMLElement>("[data-kg-dock]");
	const popover = root.querySelector<HTMLElement>("[data-kg-popover]");
	const arrow = popover?.querySelector<HTMLElement>(".kg-dock__arrow");
	if (!trigger || !dock || !popover || !arrow) return () => {};

	return mountPopover({
		root,
		dock,
		trigger,
		popover,
		arrow,
		search: popover.querySelector<HTMLElement>(".graph-panel__search input"),
	});
}

function mountPopover(refs: PopoverRefs): () => void {
	const { root, dock, trigger, popover, arrow, search } = refs;
	const controller = new AbortController();
	const signal = controller.signal;
	const mobileQuery = window.matchMedia(MOBILE_MEDIA);

	const isOpen = (): boolean => popover.hasAttribute("data-open");

	/**
	 * 桌面：弹窗右缘贴到 dock 外壳左侧，竖直中心对齐触发按钮，再整体夹进取视窗内。
	 * 移动：位置交给 CSS，这里只把箭头水平对准按钮中心。
	 *
	 * 横向锚点用外壳、竖直锚点用按钮：外壳比按钮宽出一圈描边和内衬，
	 * 拿按钮量的话弹窗会怼到胶囊上。箭头偏移是相对弹窗内边距盒算的，
	 * 而这两个中心都是 root 坐标 —— 必须换算到同一原点，否则弹窗一旦被夹取，
	 * 箭头就飞到面板外面去了。
	 */
	function position(): void {
		const rootRect = root.getBoundingClientRect();
		const triggerRect = trigger.getBoundingClientRect();
		const dockRect = dock.getBoundingClientRect();
		const arrowHalf = arrow.offsetWidth / 2;
		const triggerCx = triggerRect.left - rootRect.left + triggerRect.width / 2;
		const triggerCy = triggerRect.top - rootRect.top + triggerRect.height / 2;

		if (mobileQuery.matches) {
			popover.style.removeProperty("left");
			popover.style.removeProperty("top");
			arrow.style.removeProperty("top");
			// 内联锚点刚清掉，要以 CSS 生效之后的实际位置当原点量
			const popRect = popover.getBoundingClientRect();
			const arrowLeft = triggerCx - (popRect.left - rootRect.left);
			arrow.style.left = `calc(${clamp(arrowLeft, arrowHalf, popRect.width - arrowHalf)}px - ${arrowHalf}px)`;
			return;
		}

		popover.style.removeProperty("right");
		arrow.style.removeProperty("left");

		// 上界取导航栏下缘：#top-row 在全屏图谱页里悬浮在画布之上（categories.css:21），
		// 只按 --kg-popover-margin 夹的话，矮视窗里弹窗会整块钻到导航栏底下
		const nav = document.getElementById("top-row");
		const topMin = nav
			? Math.max(
					POPOVER_EDGE_MARGIN,
					nav.getBoundingClientRect().bottom - rootRect.top,
				)
			: POPOVER_EDGE_MARGIN;

		const left = clamp(
			dockRect.left - rootRect.left - popover.offsetWidth - POPOVER_TRIGGER_GAP,
			POPOVER_EDGE_MARGIN,
			rootRect.width - popover.offsetWidth - POPOVER_EDGE_MARGIN,
		);
		const top = clamp(
			triggerCy - popover.offsetHeight / 2,
			topMin,
			Math.max(
				topMin,
				rootRect.height - popover.offsetHeight - POPOVER_EDGE_MARGIN,
			),
		);
		popover.style.left = `${left}px`;
		popover.style.top = `${top}px`;
		// 弹窗被夹走之后按钮未必还对着面板中线，箭头得跟着夹，别捅出边框
		const arrowTop = clamp(
			triggerCy - top,
			ARROW_EDGE_INSET,
			popover.offsetHeight - ARROW_EDGE_INSET,
		);
		arrow.style.top = `calc(${arrowTop}px - ${arrowHalf}px)`;
	}

	function setOpen(next: boolean): void {
		if (next === isOpen()) return;
		popover.toggleAttribute("data-open", next);
		popover.toggleAttribute("inert", !next);
		trigger.setAttribute("aria-expanded", String(next));
		if (!next) return;
		// 收起态下打开不做滑动过渡：直接就位后只播淡入，
		// 免得从上一次关闭时的旧坐标滑过来（同 navbar-dropdown-controller.ts:130）
		popover.style.transition = "none";
		arrow.style.transition = "none";
		position();
		void popover.offsetWidth;
		popover.style.transition = "";
		arrow.style.transition = "";
		// 移动端一聚焦就顶起软键盘，会把弹窗里剩下的分区全遮住
		if (!mobileQuery.matches) search?.focus({ preventScroll: true });
	}

	const onTriggerClick = (): void => setOpen(!isOpen());

	const onDocumentClick = (event: MouseEvent): void => {
		if (!isOpen()) return;
		const target = event.target;
		if (!(target instanceof Node)) return;
		// 点画布既用于取消选中，也该收掉弹窗；它和弹窗都在 root 内，特判一下
		if (target instanceof Element && target.closest("[data-kg-canvas]")) {
			setOpen(false);
			return;
		}
		if (!popover.contains(target) && !trigger.contains(target)) setOpen(false);
	};

	const onKeyDown = (event: KeyboardEvent): void => {
		if (event.key !== "Escape" || !isOpen()) return;
		setOpen(false);
		trigger.focus({ preventScroll: true });
	};

	const onResize = (): void => {
		if (isOpen()) position();
	};

	// 跨断点时两套几何不通用，直接收起最省事，也避免内联坐标残留
	const onBreakpoint = (): void => setOpen(false);

	trigger.addEventListener("click", onTriggerClick, { signal });
	document.addEventListener("click", onDocumentClick, { signal });
	document.addEventListener("keydown", onKeyDown, { signal });
	window.addEventListener("resize", onResize, { passive: true, signal });
	mobileQuery.addEventListener("change", onBreakpoint, { signal });

	return () => {
		controller.abort();
	};
}
