/**
 * 全站提示栈：新提示从底边升起、旧的往后叠；悬停 / 键盘聚焦 / 点按时展开成列表，
 * 右滑丢弃，复用同一个 id 的更新在原卡片上形变而不是再叠一张。
 *
 * 参考实现是 React + motion，这里只搬行为不搬运行时：堆叠几何、手势判定、计时
 * 暂停与恢复、焦点交接、无障碍语义逐条对齐，动画改用 CSS transition（栈体位移）
 * 与 Web Animations（进出场、文字与图标换入换出），弹簧手感用 cubic-bezier 近似。
 *
 * 视口由 `ToastStack.astro` 渲染在 Swup 容器外，跨导航保留 —— 提示是用户刚做的
 * 动作的结果，换页不该把它抹掉。store 是模块级单例，早于挂载的 `showToast` 先排队，
 * 挂载时一次性补渲染出来。
 */

import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";

export type ToastType = "success" | "info" | "warning" | "error" | "loading";

export interface ToastAction {
	label: string;
	/** 执行后提示随即关闭；处理器里 update 过这条就保留，便于把「撤销」就地变成结果提示。 */
	onClick: (id: string) => void;
}

export interface ToastOptions {
	/** 复用同一个 id 就地更新，不再叠一张。 */
	id?: string;
	type?: ToastType;
	title: string;
	description?: string;
	action?: ToastAction;
	/** 毫秒；缺省按类型给，loading 只等 update，Infinity 表示手动关闭。 */
	duration?: number;
}

interface ToastRecord {
	id: string;
	type: ToastType;
	title: string;
	description?: string;
	action?: ToastAction;
	duration: number;
	seq: number;
	version: number;
}

interface Target {
	y: number;
	scale: number;
	height: number;
	opacity: number;
	content: number;
}

interface Gesture {
	pointerId: number;
	startX: number;
	startY: number;
	origin: number;
	active: boolean;
	samples: { t: number; x: number }[];
}

/** 收起态每张卡往后只露出这么多像素 */
const PEEK = 14;
/** 展开态卡片间距 */
const GAP = 12;
/** 往后每叠一层缩小的比例 */
const STEP = 0.05;
/** 卡片上下两条 1px 描边，量内容高度时补回去 */
const BORDER = 2;
/** 右滑到这个距离时透明度已经淡掉大半 */
const SWIPE_FADE = 280;
/** 位移超过它才判定成拖拽，避免把点击吃掉 */
const DRAG_SLOP = 6;
/** 甩动速度只取最近这段时间的采样 */
const SAMPLE_WINDOW = 100;
/** 抬手前手指已停住就没有动量，超过这个间隔的采样算作废 */
const STALE_SAMPLE = 60;
/** 离场淡出时长 */
const EXIT_MS = 220;
const BASE_DURATION = 5000;
const LIMIT = 12;
const VISIBLE_TOASTS = 3;
/** 与 CSS 里的 --toast-stack-enter-motion / --toast-stack-standard-motion 同值 */
const ENTER_MOTION = "cubic-bezier(0.16, 1, 0.3, 1)";
const STANDARD_MOTION = "cubic-bezier(0.2, 0, 0, 1)";
const SWAP_MS = 320;
const BLUR_SOFT = "blur(4px)";
const BLUR_SUBTLE = "blur(2px)";

const TYPE_LABEL_KEYS: Record<ToastType, I18nKey> = {
	success: I18nKey.toastTypeSuccess,
	info: I18nKey.toastTypeInfo,
	warning: I18nKey.toastTypeWarning,
	error: I18nKey.toastTypeError,
	loading: I18nKey.toastTypeLoading,
};

/** lucide 的描边路径，纯静态常量；用户文案一律走 textContent，不拼进这里 */
const GLYPHS: Record<Exclude<ToastType, "loading">, string> = {
	// data-draw 标记的那条路径进场时描出来，见 ToastItem.drawGlyph
	success:
		'<circle cx="12" cy="12" r="10"/><path data-draw d="m9 12 2 2 4-4"/>',
	info: '<circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
	warning:
		'<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
	error:
		'<circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/>',
};
const CLOSE_GLYPH = '<path d="M18 6 6 18"/><path d="m6 6 12 12"/>';

function glyphSvg(paths: string, size: number): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${paths}</svg>`;
}

function glyphMarkup(type: ToastType): string {
	if (type === "loading")
		return '<span class="toast-stack__spinner" aria-hidden="true"></span>';
	return glyphSvg(GLYPHS[type], 18);
}

function durationFor(type: ToastType, base: number): number {
	if (type === "loading") return Number.POSITIVE_INFINITY;
	if (type === "warning" || type === "error") return base * 1.6;
	return base;
}

/** 以这个初速度甩出去，按快速滚动的衰减能滑到哪儿 */
function project(velocity: number): number {
	return (velocity / 1000) * 0.99 * 100;
}

/** 越界的阻力：还跟着走，但越走越沉，像滚动的 overscroll */
function rubberBand(distance: number, dimension: number): number {
	return (1 - 1 / ((distance * 0.55) / dimension + 1)) * dimension;
}

function isFocusVisible(element: Element): boolean {
	try {
		return element.matches(":focus-visible");
	} catch {
		return true;
	}
}

/* ========== 队列 ========== */

type Listener = () => void;

interface ToastStore {
	toast: (options: ToastOptions) => string;
	update: (id: string, patch: Partial<Omit<ToastOptions, "id">>) => void;
	dismiss: (id?: string) => void;
	runAction: (id: string) => void;
	subscribe: (listener: Listener) => () => void;
	getSnapshot: () => ToastRecord[];
}

function createToastStore(base: number, limit: number): ToastStore {
	let records: ToastRecord[] = [];
	let seq = 0;
	const listeners = new Set<Listener>();

	function commit(next: ToastRecord[]): void {
		records = next;
		for (const listener of listeners) listener();
	}

	function update(id: string, patch: Partial<Omit<ToastOptions, "id">>): void {
		const found = records.find((item) => item.id === id);
		if (!found) return;
		const type = patch.type ?? found.type;
		const record: ToastRecord = {
			...found,
			...patch,
			type,
			duration: patch.duration ?? durationFor(type, base),
			version: found.version + 1,
		};
		commit(records.map((item) => (item.id === id ? record : item)));
	}

	function toast(options: ToastOptions): string {
		const { id, ...content } = options;
		if (id && records.some((item) => item.id === id)) {
			update(id, content);
			return id;
		}
		const type = options.type ?? "info";
		seq += 1;
		const record: ToastRecord = {
			...content,
			id: id ?? `toast-${seq}`,
			type,
			duration: options.duration ?? durationFor(type, base),
			seq,
			version: 0,
		};
		commit([record, ...records].slice(0, limit));
		return record.id;
	}

	function dismiss(id?: string): void {
		if (id === undefined) {
			if (records.length) commit([]);
			return;
		}
		if (!records.some((item) => item.id === id)) return;
		commit(records.filter((item) => item.id !== id));
	}

	function runAction(id: string): void {
		const found = records.find((item) => item.id === id);
		if (!found?.action) return;
		const { version } = found;
		found.action.onClick(id);
		// 处理器自己 update 过就留着这条提示，否则动作完成即收掉
		if (records.find((item) => item.id === id)?.version === version)
			dismiss(id);
	}

	return {
		toast,
		update,
		dismiss,
		runAction,
		subscribe: (listener) => {
			listeners.add(listener);
			return () => {
				listeners.delete(listener);
			};
		},
		getSnapshot: () => records,
	};
}

const store = createToastStore(BASE_DURATION, LIMIT);

/** 弹出一条提示并返回它的 id；同 id 已存在时等同于 `updateToast`。 */
export function showToast(options: ToastOptions): string {
	return store.toast(options);
}

/** 就地形变一条提示：图标、文案与高度动画到新内容，计时重新开始。 */
export function updateToast(
	id: string,
	patch: Partial<Omit<ToastOptions, "id">>,
): void {
	store.update(id, patch);
}

/** 关掉一条提示，不传 id 关掉全部。 */
export function dismissToast(id?: string): void {
	store.dismiss(id);
}

/* ========== 堆叠几何 ========== */

/**
 * 收起态后面的卡借用最前面那张的高度，边缘才对齐；展开态各用各的并留出间距。
 * 列表盒只当悬停靶子，尺寸要盖住卡片之间的缝，鼠标在缝里移动才不会把栈收回去。
 */
function layoutStack(
	records: ToastRecord[],
	heights: Map<string, number>,
	expanded: boolean,
	visibleToasts: number,
): { targets: Target[]; listHeight: number } {
	const heightOf = (record: ToastRecord): number => heights.get(record.id) ?? 0;
	const front = records.length ? heightOf(records[0]) : 0;
	const tops: number[] = [0];
	records.forEach((record, index) => {
		const stride = index < visibleToasts ? heightOf(record) + GAP : 0;
		tops.push(tops[index] + stride);
	});

	const targets = records.map((record, index): Target => {
		const visible = index < visibleToasts;
		const depth = Math.min(index, visibleToasts);
		const height = heightOf(record);
		if (expanded) {
			return {
				y: -tops[index],
				scale: 1,
				height,
				opacity: visible ? 1 : 0,
				content: 1,
			};
		}
		return {
			y: -PEEK * depth,
			scale: 1 - STEP * depth,
			height: index === 0 ? height : front,
			opacity: visible ? 1 : 0,
			content: index === 0 ? 1 : 0,
		};
	});

	const listHeight = records.length
		? expanded
			? tops[records.length] - GAP
			: front + PEEK * (Math.min(records.length, visibleToasts) - 1)
		: 0;
	return { targets, listHeight };
}

/* ========== 单张卡片 ========== */

interface ItemHooks {
	onMeasure: (id: string, height: number) => void;
	onDragChange: (dragging: boolean) => void;
	onTap: () => void;
	onHandOff: (leaving: HTMLElement, keyboard: boolean) => void;
	onGone: (id: string) => void;
	isReduced: () => boolean;
}

class ToastItem {
	readonly el: HTMLLIElement;

	private readonly card: HTMLElement;
	private readonly content: HTMLElement;
	private readonly iconHost: HTMLElement;
	private readonly labelHost: HTMLElement;
	private readonly titleHost: HTMLElement;
	private readonly descriptionHost: HTMLElement;
	private readonly closeEl: HTMLButtonElement;

	private record: ToastRecord;
	private readonly hooks: ItemHooks;
	private readonly fillEl: HTMLElement;
	private observer: ResizeObserver | null = null;
	private progressAnim: Animation | null = null;
	private applied: Target | null = null;
	private wasExpanded: boolean | null = null;
	private actionSlot: HTMLElement | null = null;
	private remaining: number;
	/** null 表示还没经过第一次布局，保证新卡片一进场就上计时器 */
	private isPaused: boolean | null = null;
	private timer = 0;
	private startedAt = 0;
	private isLeaving = false;
	private swiped = false;
	private offsetXValue = 0;
	private gesture: Gesture | null = null;
	private suppressClick = false;
	private pointerType = "mouse";

	constructor(record: ToastRecord, hooks: ItemHooks) {
		this.record = record;
		this.hooks = hooks;
		this.remaining = record.duration;

		this.el = document.createElement("li");
		this.el.className = "toast-stack__item";
		this.el.style.zIndex = String(record.seq);
		this.el.addEventListener("keydown", this.onKeyDown);

		this.card = document.createElement("div");
		this.card.className = "toast-stack__card";
		this.card.addEventListener("pointerdown", this.onPointerDown);
		this.card.addEventListener("pointermove", this.onPointerMove);
		this.card.addEventListener("pointerup", this.onPointerUp);
		this.card.addEventListener("pointercancel", this.onPointerCancel);
		this.card.addEventListener("click", this.onCardClick);

		this.content = document.createElement("div");
		this.content.className = "toast-stack__content";

		this.iconHost = document.createElement("span");
		this.iconHost.className = "toast-stack__icon";
		this.iconHost.dataset.type = record.type;
		this.iconHost.setAttribute("aria-hidden", "true");
		this.iconHost.append(this.createGlyph(record.type));

		this.labelHost = document.createElement("span");
		this.labelHost.className = "toast-stack__sr";
		this.labelHost.textContent = `${i18n(TYPE_LABEL_KEYS[record.type])}: `;

		this.titleHost = document.createElement("span");
		this.titleHost.className = "toast-stack__title";
		this.titleHost.append(this.createLine(record.title));

		this.descriptionHost = document.createElement("div");
		this.descriptionHost.className = "toast-stack__description";
		if (record.description)
			this.descriptionHost.append(this.createLine(record.description));

		const copy = document.createElement("div");
		copy.className = "toast-stack__copy";
		copy.append(this.labelHost, this.titleHost, this.descriptionHost);

		this.closeEl = document.createElement("button");
		this.closeEl.type = "button";
		this.closeEl.className = "toast-stack__close";
		this.closeEl.setAttribute("aria-label", i18n(I18nKey.close));
		this.closeEl.innerHTML = glyphSvg(CLOSE_GLYPH, 16);
		this.closeEl.addEventListener("click", () => store.dismiss(this.record.id));

		this.content.append(this.iconHost, copy, this.closeEl);
		this.syncAction(record.action);

		// 倒计时铺在卡片底色上：整张卡就是进度条，和悬浮目录那张卡的充能同一手法
		const progress = document.createElement("div");
		progress.className = "toast-stack__progress";
		progress.setAttribute("aria-hidden", "true");
		this.fillEl = document.createElement("span");
		this.fillEl.className = "toast-stack__progress-fill";
		progress.append(this.fillEl);
		this.card.append(progress, this.content);
		this.el.append(this.card);

		this.restartProgress();
	}

	get id(): string {
		return this.record.id;
	}

	isGone(): boolean {
		return this.isLeaving;
	}

	/** 得先挂进文档才量得到高度，所以由调用方 append 之后再调一次。 */
	measure(): void {
		this.reportHeight();
		if (typeof ResizeObserver === "undefined") return;
		this.observer = new ResizeObserver(() => this.reportHeight());
		this.observer.observe(this.content);
	}

	/** 同一 id 在淡出没结束前又亮起来：撤掉离场，接着用这张卡。 */
	revive(record: ToastRecord): void {
		if (!this.isLeaving) return;
		this.isLeaving = false;
		for (const animation of this.el.getAnimations()) animation.cancel();
		this.el.removeAttribute("inert");
		this.swiped = false;
		this.setOffset(0);
		this.measure();
		// 重弹的这条和旧的内容版本号相同，逐字段比对会被短路，整张卡强制换一遍
		this.apply(record, true);
	}

	update(record: ToastRecord): void {
		if (record.version === this.record.version) return;
		this.apply(record, false);
	}

	private apply(record: ToastRecord, force: boolean): void {
		const previous = this.record;
		this.record = record;
		this.el.style.zIndex = String(record.seq);
		if (force || record.type !== previous.type) this.swapGlyph(record.type);
		if (force || record.title !== previous.title)
			this.swapText(this.titleHost, record.title);
		if (force || record.description !== previous.description)
			this.swapText(this.descriptionHost, record.description);
		if (force || record.action !== previous.action)
			this.syncAction(record.action);
		this.restartTimer();
	}

	layout(
		target: Target,
		expanded: boolean,
		front: boolean,
		hidden: boolean,
		paused: boolean,
	): void {
		if (this.isPaused !== paused) {
			this.isPaused = paused;
			this.syncTimer();
		}
		if (target.height <= 0) return;

		const entering = this.applied === null;
		const morph = !entering && this.wasExpanded !== expanded;
		this.wasExpanded = expanded;
		this.el.dataset.front = String(front);
		this.el.dataset.expanded = String(expanded);
		if (morph) this.el.dataset.morph = "true";
		else this.el.removeAttribute("data-morph");
		if (hidden) this.el.setAttribute("inert", "");
		else this.el.removeAttribute("inert");

		if (entering) {
			// 起点摆到视窗外那条边之下，回流一帧再写目标值，transition 才真的跑起来
			this.el.classList.add("is-instant");
			this.write({ ...target, y: target.y + target.height, opacity: 0 });
			void this.el.offsetHeight;
			this.el.classList.remove("is-instant");
		}
		this.applied = target;
		this.write(target);
	}

	leave(): void {
		if (this.isLeaving) return;
		this.isLeaving = true;
		this.clearTimer();
		this.progressAnim?.pause();
		this.disconnect();

		const active = document.activeElement;
		if (active instanceof HTMLElement && this.el.contains(active)) {
			this.hooks.onHandOff(this.el, isFocusVisible(active));
		}
		this.el.setAttribute("inert", "");

		const applied = this.applied;
		// 收回边角的位移交给 transition，它从当前值起步；淡出用 WAAPI 拿完成信号
		if (applied && !this.swiped && !this.hooks.isReduced()) {
			this.write({
				...applied,
				y: applied.y + 10,
				scale: applied.scale * 0.96,
			});
		}
		const animation = this.el.animate(
			[
				{ opacity: getComputedStyle(this.el).opacity },
				{ opacity: 0, offset: 1 },
			],
			{ duration: EXIT_MS, easing: STANDARD_MOTION, fill: "forwards" },
		);
		animation.finished.then(this.destroy).catch(() => {
			// revive() 会取消这条动画，被取消的提示不能顺手拆掉自己
			if (this.isLeaving) this.destroy();
		});
	}

	private destroy = (): void => {
		this.clearTimer();
		this.disconnect();
		this.progressAnim?.cancel();
		this.progressAnim = null;
		this.el.remove();
		this.hooks.onGone(this.record.id);
	};

	private disconnect(): void {
		this.observer?.disconnect();
		this.observer = null;
	}

	private reportHeight(): void {
		this.hooks.onMeasure(this.record.id, this.content.offsetHeight + BORDER);
	}

	private write(target: Target): void {
		this.el.style.transform = `translate3d(0, ${target.y}px, 0) scale(${target.scale})`;
		this.el.style.height = `${target.height}px`;
		this.el.style.opacity = String(target.opacity);
		this.content.style.opacity = String(target.content);
	}

	private createGlyph(type: ToastType): HTMLElement {
		const glyph = document.createElement("span");
		glyph.className = "toast-stack__glyph";
		glyph.innerHTML = glyphMarkup(type);
		this.drawGlyph(glyph);
		return glyph;
	}

	/**
	 * 勾是描出来的：pathLength 归一到 1 之后，虚线一整段正好盖住全路径，
	 * dashoffset 从 1 收到 0 就是由起笔画到收笔；fill both 让延迟的那一拍先空着。
	 */
	private drawGlyph(glyph: HTMLElement): void {
		if (this.hooks.isReduced()) return;
		const path = glyph.querySelector<SVGPathElement>("[data-draw]");
		if (!path) return;
		path.setAttribute("pathLength", "1");
		path.style.strokeDasharray = "1";
		path.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
			duration: SWAP_MS,
			delay: 120,
			easing: ENTER_MOTION,
			fill: "both",
		});
	}

	private swapGlyph(type: ToastType): void {
		this.iconHost.dataset.type = type;
		this.labelHost.textContent = `${i18n(TYPE_LABEL_KEYS[type])}: `;
		const outgoing = this.currentChild(this.iconHost);
		const incoming = this.createGlyph(type);
		this.iconHost.append(incoming);
		if (outgoing) {
			this.retire(outgoing, [
				{ opacity: 1, transform: "none", filter: "blur(0px)" },
				{ opacity: 0, transform: "scale(0.6)", filter: BLUR_SUBTLE },
			]);
		}
		this.playEnter(incoming, [
			{ opacity: 0, transform: "scale(0.6)", filter: BLUR_SUBTLE },
			{ opacity: 1, transform: "none", filter: "blur(0px)" },
		]);
	}

	private createLine(text: string): HTMLElement {
		const line = document.createElement("span");
		line.className = "toast-stack__line";
		line.textContent = text;
		return line;
	}

	private swapText(host: HTMLElement, text: string | undefined): void {
		const outgoing = this.currentChild(host);
		if (outgoing) {
			this.retire(outgoing, [
				{ opacity: 1, transform: "none", filter: "blur(0px)" },
				{ opacity: 0, transform: "translateY(-0.3em)", filter: BLUR_SUBTLE },
			]);
		}
		if (!text) return;
		const incoming = this.createLine(text);
		host.append(incoming);
		this.playEnter(incoming, [
			{ opacity: 0, transform: "translateY(0.3em)", filter: BLUR_SOFT },
			{ opacity: 1, transform: "none", filter: "blur(0px)" },
		]);
	}

	/** 连点两次复制时，上一次换出的那份可能还在淡出，别把它当成当前内容。 */
	private currentChild(host: HTMLElement): HTMLElement | null {
		for (const node of host.children) {
			if (!node.hasAttribute("data-leaving")) return node as HTMLElement;
		}
		return null;
	}

	/** 换出去的那份先脱流，新内容立刻占位，容器高度的变化交给栈体的形变动画。 */
	private retire(node: HTMLElement, frames: Keyframe[]): void {
		node.dataset.leaving = "true";
		const animation = node.animate(frames, {
			duration: 200,
			easing: STANDARD_MOTION,
			fill: "forwards",
		});
		animation.finished.then(() => node.remove()).catch(() => node.remove());
	}

	private playEnter(node: HTMLElement, frames: Keyframe[]): void {
		if (this.hooks.isReduced()) return;
		node.animate(frames, { duration: SWAP_MS, easing: ENTER_MOTION });
	}

	private syncAction(action?: ToastAction): void {
		this.actionSlot?.remove();
		this.actionSlot = null;
		if (!action) return;

		const slot = document.createElement("div");
		slot.className = "toast-stack__action-slot";
		const button = document.createElement("button");
		button.type = "button";
		button.className = "toast-stack__action";
		button.textContent = action.label;
		button.addEventListener("click", () => {
			const keyboard = isFocusVisible(button);
			store.runAction(this.record.id);
			// 动作把提示就地改成结果时卡片还在，键盘焦点不该掉回页面
			if (
				keyboard &&
				!store.getSnapshot().some((item) => item.id === this.record.id)
			) {
				this.closeEl.focus();
			}
		});
		slot.append(button);
		this.content.insertBefore(slot, this.closeEl);
		this.actionSlot = slot;
		void slot.offsetWidth;
		slot.dataset.open = "true";
	}

	private syncTimer(): void {
		this.clearTimer();
		if (this.isLeaving || this.isPaused || !Number.isFinite(this.remaining)) {
			this.progressAnim?.pause();
			return;
		}
		this.startedAt = performance.now();
		this.timer = window.setTimeout(
			() => store.dismiss(this.record.id),
			Math.max(this.remaining, 0),
		);
		// 进度条只跟着计时器走，暂停、恢复和重新形变都不用各算一遍
		if (this.progressAnim?.playState === "paused") this.progressAnim.play();
	}

	/** 形变等于重新给一次完整寿命：先丢掉旧计时，别把已经走过的时间扣到新寿命上。 */
	private restartTimer(): void {
		if (this.timer) {
			window.clearTimeout(this.timer);
			this.timer = 0;
		}
		this.remaining = this.record.duration;
		this.restartProgress();
		this.syncTimer();
	}

	private restartProgress(): void {
		const duration = this.record.duration;
		if (!Number.isFinite(duration)) {
			this.progressAnim?.cancel();
			this.progressAnim = null;
			this.card.dataset.countdown = "false";
			return;
		}
		if (!this.progressAnim) {
			const effect = new KeyframeEffect(
				this.fillEl,
				[{ transform: "scaleX(1)" }, { transform: "scaleX(0)" }],
				{ duration, easing: "linear", fill: "forwards" },
			);
			this.progressAnim = new Animation(effect, document.timeline);
		} else {
			this.progressAnim.effect?.updateTiming({ duration });
		}
		this.progressAnim.pause();
		this.progressAnim.currentTime = 0;
		this.card.dataset.countdown = "true";
	}

	private clearTimer(): void {
		if (!this.timer) return;
		window.clearTimeout(this.timer);
		this.timer = 0;
		this.remaining -= performance.now() - this.startedAt;
	}

	private onKeyDown = (event: KeyboardEvent): void => {
		if (event.key !== "Escape") return;
		event.stopPropagation();
		store.dismiss(this.record.id);
	};

	private onPointerDown = (event: PointerEvent): void => {
		this.pointerType = event.pointerType;
		this.suppressClick = false;
		const target = event.target as Element;
		if (event.button !== 0 || this.isLeaving || target.closest("button, a"))
			return;
		this.gesture = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startY: event.clientY,
			origin: this.offsetXValue,
			active: false,
			samples: [],
		};
	};

	private onPointerMove = (event: PointerEvent): void => {
		const current = this.gesture;
		if (!current || current.pointerId !== event.pointerId) return;
		if (!current.active) {
			const dx = event.clientX - current.startX;
			const dy = event.clientY - current.startY;
			if (Math.hypot(dx, dy) < DRAG_SLOP) return;
			// 竖向意图留给页面滚动
			if (Math.abs(dy) > Math.abs(dx)) {
				this.gesture = null;
				return;
			}
			// 从这一刻开始跟手，越过阈值的那几像素不会让卡片跳一下
			current.active = true;
			current.startX = event.clientX;
			this.suppressClick = true;
			this.card.setPointerCapture(event.pointerId);
			this.card.dataset.dragging = "";
			window.getSelection()?.removeAllRanges();
			this.hooks.onDragChange(true);
		}
		const raw = current.origin + event.clientX - current.startX;
		// 往右跟手 1:1；往左是反方向，按 overscroll 阻力衰减
		this.setOffset(raw >= 0 ? raw : -rubberBand(-raw, this.card.offsetWidth));
		current.samples.push({ t: event.timeStamp, x: raw });
		while (
			current.samples.length > 2 &&
			event.timeStamp - current.samples[0].t > SAMPLE_WINDOW
		) {
			current.samples.shift();
		}
	};

	private onPointerUp = (event: PointerEvent): void => {
		this.endGesture(event, false);
	};

	private onPointerCancel = (event: PointerEvent): void => {
		this.endGesture(event, true);
	};

	private endGesture(event: PointerEvent, cancelled: boolean): void {
		const current = this.gesture;
		if (!current || current.pointerId !== event.pointerId) return;
		this.gesture = null;
		if (!current.active) return;
		delete this.card.dataset.dragging;
		this.hooks.onDragChange(false);

		const first = current.samples[0];
		const last = current.samples[current.samples.length - 1];
		const velocity =
			cancelled ||
			!first ||
			!last ||
			last.t === first.t ||
			event.timeStamp - last.t > STALE_SAMPLE
				? 0
				: ((last.x - first.x) / (last.t - first.t)) * 1000;
		const width = this.card.offsetWidth;
		const offset = this.offsetXValue;
		if (
			!cancelled &&
			offset > 0 &&
			velocity > -200 &&
			offset + project(velocity) > width * 0.4
		) {
			this.swiped = true;
			this.setOffset(this.hooks.isReduced() ? 0 : width + 40);
			store.dismiss(this.record.id);
			return;
		}
		this.setOffset(0);
	}

	private onCardClick = (event: MouseEvent): void => {
		if (this.suppressClick) {
			this.suppressClick = false;
			return;
		}
		// 触屏没有 hover，点卡片当成开合栈
		if (
			this.pointerType !== "mouse" &&
			!(event.target as Element).closest("button, a")
		) {
			this.hooks.onTap();
		}
	};

	private setOffset(value: number): void {
		this.offsetXValue = value;
		this.card.style.transform = value ? `translateX(${value}px)` : "";
		this.card.style.opacity =
			value > 0 ? String(1 - Math.min(value / SWIPE_FADE, 1) * 0.75) : "";
	}
}

/* ========== 挂载 ========== */

/** 绑定 `ToastStack.astro` 渲染出来的视口；常驻组件，整个文档生命周期只挂一次。 */
export function mountToastStack(root: HTMLElement): void {
	const list = root.querySelector<HTMLElement>(".toast-stack__list");
	if (!list) return;
	bindStack(root, list);
}

function bindStack(root: HTMLElement, list: HTMLElement): void {
	const items = new Map<string, ToastItem>();
	const heights = new Map<string, number>();
	let returnFocus: HTMLElement | null = null;
	let hovered = false;
	let focused = false;
	let tapped = false;
	let dragging = false;
	let pageHidden = false;
	let rendering = false;
	let rerenderQueued = false;

	const reduceQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
	const isReduced = (): boolean => reduceQuery.matches;

	/** 高度回报可能发生在渲染途中，那一趟本来就会用到新值，不必再排一次。 */
	function scheduleRender(): void {
		if (rendering) return;
		if (rerenderQueued) return;
		rerenderQueued = true;
		queueMicrotask(() => {
			rerenderQueued = false;
			render();
		});
	}

	const hooks: ItemHooks = {
		onMeasure: (id, height) => {
			if (heights.get(id) === height) return;
			heights.set(id, height);
			scheduleRender();
		},
		onDragChange: (value) => {
			dragging = value;
		},
		onTap: () => {
			tapped = !tapped;
			render();
		},
		onHandOff: (leaving, keyboard) => {
			// 键盘用户落到下一张，没有下一张就回到进栈之前的位置
			const nodes = Array.from(list.children) as HTMLElement[];
			const at = nodes.indexOf(leaving);
			const candidates = nodes.filter(
				(node) => node !== leaving && !node.hasAttribute("inert"),
			);
			const next =
				candidates.find((node) => nodes.indexOf(node) > at) ??
				candidates[candidates.length - 1];
			const button = next?.querySelector<HTMLElement>("button");
			if (keyboard && button) button.focus();
			else if (keyboard && returnFocus?.isConnected) returnFocus.focus();
			else (document.activeElement as HTMLElement | null)?.blur();
		},
		onGone: (id) => {
			items.delete(id);
			if (![...items.values()].some((item) => item.isGone())) {
				for (const key of [...heights.keys()]) {
					if (!items.has(key)) heights.delete(key);
				}
			}
			scheduleRender();
		},
		isReduced,
	};

	function render(): void {
		rendering = true;
		try {
			const records = store.getSnapshot();
			if (tapped && records.length === 0) tapped = false;
			const expanded = records.length > 0 && (hovered || focused || tapped);
			const paused = expanded || dragging || pageHidden;
			const live = new Set(records.map((record) => record.id));

			for (const record of records) {
				const existing = items.get(record.id);
				if (existing) {
					existing.revive(record);
					existing.update(record);
					continue;
				}
				const created = new ToastItem(record, hooks);
				items.set(record.id, created);
				list.prepend(created.el);
				created.measure();
			}
			for (const [id, item] of items) {
				if (!live.has(id)) item.leave();
			}

			const { targets, listHeight } = layoutStack(
				records,
				heights,
				expanded,
				VISIBLE_TOASTS,
			);
			records.forEach((record, index) => {
				items
					.get(record.id)
					?.layout(
						targets[index],
						expanded,
						index === 0,
						index >= VISIBLE_TOASTS,
						paused,
					);
			});
			list.style.height = `${listHeight}px`;
			list.dataset.expanded = String(expanded);
		} finally {
			rendering = false;
		}
	}

	store.subscribe(render);
	render();

	document.addEventListener("visibilitychange", () => {
		pageHidden = document.visibilityState === "hidden";
		render();
	});

	root.addEventListener("focusin", (event) => {
		const from = event.relatedTarget;
		if (!(from instanceof Node) || !root.contains(from)) {
			returnFocus = from instanceof HTMLElement ? from : null;
		}
		// 只有键盘聚焦才展开栈，鼠标点按钮不该把它钉住
		if (event.target instanceof Element && isFocusVisible(event.target)) {
			focused = true;
			render();
		}
	});

	root.addEventListener("focusout", (event) => {
		const to = event.relatedTarget;
		if (to instanceof Node && root.contains(to)) return;
		focused = false;
		render();
	});

	const isMouse = (event: PointerEvent): boolean =>
		event.pointerType === "mouse";
	list.addEventListener("pointerenter", (event) => {
		if (!isMouse(event) || hovered) return;
		hovered = true;
		render();
	});
	list.addEventListener("pointermove", (event) => {
		if (!isMouse(event) || hovered) return;
		hovered = true;
		render();
	});
	list.addEventListener("pointerleave", (event) => {
		if (!isMouse(event) || !hovered) return;
		hovered = false;
		render();
	});

	// Alt+T 把焦点送进栈里；修饰键之后浏览器通常不画焦点环，所以自己要求并展开
	document.addEventListener("keydown", (event) => {
		if (
			!event.altKey ||
			event.metaKey ||
			event.ctrlKey ||
			event.code !== "KeyT"
		)
			return;
		const target = list.querySelector<HTMLElement>(
			":scope > li:not([inert]) button",
		);
		if (!target) return;
		event.preventDefault();
		target.focus();
		focused = true;
		render();
	});

	document.addEventListener("pointerdown", (event) => {
		if (!tapped || root.contains(event.target as Node)) return;
		tapped = false;
		render();
	});
}
