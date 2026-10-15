/**
 * Hero 左上角标题的「矢量描边」文字动画，移植自 React Bits 的 TechText。
 *
 * 静止态是实心字；指针落在哪个字母，那个字母就换成虚线描边轮廓，轮廓外再套一个会跟手
 * 滑动的选择框，框边有沿周长巡游、随机闪烁的小方块；字母可拖离基线，松手弹簧回位；
 * 指针离开时镜头沿字标自动来回扫掠。
 *
 * 与参考实现的取舍：
 *   - 只保留逐字母揭示（参考的 reveal:'letter'），删掉以指针为圆心的圆形区域揭示。
 *   - 颜色不做 #rrggbb 解析：墨水色取自 --home-hero-ink（oklch），半透明一律走 globalAlpha。
 *   - 容器尺寸由占位文字撑出（见 .home-hero__wordmark），所以不保留参考实现为自适应容器
 *     预留的 0.9/0.66 收缩余量，只在字标宽度超出容器时等比缩小。
 *   - 标题在滚动时间线里被 gsap 缩放，指针坐标要按 rect/client 的比值反算回布局坐标系。
 */

export type HomeHeroWordmarkController = {
	setActive: (active: boolean) => void;
	destroy: () => void;
};

const NOOP_CONTROLLER: HomeHeroWordmarkController = {
	setActive: () => undefined,
	destroy: () => undefined,
};

const DASH_LENGTH = 4;
const DASH_GAP = 2;
const STROKE_WIDTH = 1.5;
const SPECK_COUNT = 15;
const SPRING = 320;
const DAMPING = 22;
const SWEEP_SPEED = 1;
const MAX_PIXEL_RATIO = 2;
/** 各状态量的一阶逼近时间常数（秒），沿用参考实现的手感数值 */
const LENS_POINTER_SECONDS = 0.05;
const LENS_SWEEP_SECONDS = 0.22;
const GLIDE_SECONDS = 0.08;
const DRAG_SECONDS = 0.03;
const OUTLINE_SECONDS = 0.09;
const FRAME_SECONDS = 0.1;

type Sprite = { image: HTMLCanvasElement; left: number; top: number };
type Box = { x1: number; y1: number; x2: number; y2: number };
type Vector = { x: number; y: number };

type Glyph = {
	char: string;
	x: number;
	box: Box;
	offset: Vector;
	velocity: Vector;
	outline: number;
	fill: Sprite;
	dashes: Sprite;
};

/** 整段字标的墨迹包围盒，扫掠路径与命中判定都以它为基准 */
type Word = {
	left: number;
	right: number;
	top: number;
	bottom: number;
};

type FontSpec = {
	family: string;
	weight: string;
	size: number;
	spacing: number;
};

const approach = (
	current: number,
	target: number,
	delta: number,
	seconds: number,
): number => current + (target - current) * (1 - Math.exp(-delta / seconds));

/** FNV 混合散列：给同一种子反复取值，保证重建画布后小方块的位置与节奏不变 */
function noise(...values: number[]): number {
	let hash = 2166136261;
	for (const value of values) {
		hash = Math.imul(hash ^ (value | 0), 16777619);
		hash ^= hash >>> 13;
		hash = Math.imul(hash, 0x5bd1e995);
		hash ^= hash >>> 15;
	}
	return (hash >>> 0) / 4294967296;
}

type WordmarkParts = {
	container: HTMLElement;
	canvas: HTMLCanvasElement;
	context: CanvasRenderingContext2D;
	placeholder: HTMLElement;
	scratchContext: CanvasRenderingContext2D;
};

export function initHomeHeroWordmark(
	hero: HTMLElement,
): HomeHeroWordmarkController {
	const container = hero.querySelector<HTMLElement>("[data-hero-wordmark]");
	const canvas = container?.querySelector<HTMLCanvasElement>("canvas");
	const placeholder = container?.querySelector<HTMLElement>("span");
	const context = canvas?.getContext("2d");
	const scratchContext = document.createElement("canvas").getContext("2d");
	if (!container || !canvas || !placeholder || !context || !scratchContext) {
		return NOOP_CONTROLLER;
	}
	return mountWordmark({
		container,
		canvas,
		context,
		placeholder,
		scratchContext,
	});
}

/**
 * 元素的存在性检查只在同步作用域里收窄，字标逻辑全写在下面的闭包里，
 * 所以拆一层把非空元素作为参数传进来。
 */
function mountWordmark(parts: WordmarkParts): HomeHeroWordmarkController {
	const { container, canvas, context, placeholder, scratchContext } = parts;
	const abortController = new AbortController();
	const resizeObserver = new ResizeObserver(() => resize());
	const pointer = { x: 0, y: 0, inside: false };
	const grab = { x: 0, y: 0 };
	const lens = { x: 0, y: 0 };
	const selection = { x1: 0, y1: 0, x2: 0, y2: 0, alpha: 0, index: -1 };
	let width = 1;
	let height = 1;
	let dpr = 1;
	let animationFrame = 0;
	let lastFrameAt = performance.now();
	let running = false;
	let destroyed = false;
	let layoutDirty = true;
	let shown = false;
	let requestedFont = "";
	let color = "";
	let word: Word | null = null;
	let glyphs: Glyph[] = [];
	let clock = 0;
	let pulse = 0;
	let placed = false;
	let dragging = -1;

	function readFont(): FontSpec {
		const style = getComputedStyle(placeholder);
		const size = Number.parseFloat(style.fontSize);
		const spacing = Number.parseFloat(style.letterSpacing);
		return {
			family: style.fontFamily || "sans-serif",
			weight: style.fontWeight || "700",
			size: Number.isFinite(size) && size > 0 ? size : 96,
			spacing: Number.isFinite(spacing) ? spacing : 0,
		};
	}

	function applyFont(
		target: CanvasRenderingContext2D,
		font: FontSpec,
		size: number,
	) {
		target.font = `${font.weight} ${size}px ${font.family}`;
		if ("letterSpacing" in target) {
			target.letterSpacing = `${font.spacing}px`;
		}
		target.textAlign = "left";
		target.textBaseline = "alphabetic";
	}

	/** 预渲染单个字母的实心图与虚线轮廓图，逐帧只做位图搬运 */
	function createSprite(
		font: FontSpec,
		size: number,
		baseline: number,
		glyph: { char: string; x: number; box: Box },
		stroke: boolean,
	): Sprite {
		const pad = Math.ceil(STROKE_WIDTH * 2 + 4);
		const left = glyph.box.x1 - pad;
		const top = glyph.box.y1 - pad;
		const image = document.createElement("canvas");
		image.width = Math.max(
			1,
			Math.ceil((glyph.box.x2 - glyph.box.x1 + pad * 2) * dpr),
		);
		image.height = Math.max(
			1,
			Math.ceil((glyph.box.y2 - glyph.box.y1 + pad * 2) * dpr),
		);
		const spriteContext = image.getContext("2d");
		if (!spriteContext) return { image, left, top };

		spriteContext.setTransform(dpr, 0, 0, dpr, -left * dpr, -top * dpr);
		applyFont(spriteContext, font, size);
		if (!stroke) {
			spriteContext.fillStyle = color;
			spriteContext.fillText(glyph.char, glyph.x, baseline);
			return { image, left, top };
		}

		spriteContext.lineJoin = "round";
		spriteContext.lineCap = "butt";
		spriteContext.lineWidth = STROKE_WIDTH * 2;
		spriteContext.strokeStyle = color;
		spriteContext.setLineDash([DASH_LENGTH, DASH_GAP]);
		spriteContext.strokeText(glyph.char, glyph.x, baseline);
		spriteContext.setLineDash([]);
		// 描边压住字身的那一半要挖掉，剩下的才是贴着字形外沿的虚线
		spriteContext.globalCompositeOperation = "destination-out";
		spriteContext.fillStyle = "#000000";
		spriteContext.fillText(glyph.char, glyph.x, baseline);
		spriteContext.globalCompositeOperation = "source-over";
		return { image, left, top };
	}

	/**
	 * 占位文字实际渲染出来的墨迹框（容器布局坐标系）。canvas 按它对齐，
	 * 字标位置才能和未挂载时的静态版式逐像素一致，不必去猜行盒与基线的关系。
	 * gsap 缩放标题时 rect 是视觉尺寸，按 rect/client 的比值换算回布局尺寸。
	 */
	function measurePlaceholderInk(): Box | null {
		const range = document.createRange();
		range.selectNodeContents(placeholder);
		const rects = Array.from(range.getClientRects());
		if (!rects.length) return null;
		const containerRect = container.getBoundingClientRect();
		const scaleX =
			containerRect.width / Math.max(1, container.clientWidth) || 1;
		const scaleY =
			containerRect.height / Math.max(1, container.clientHeight) || 1;
		const union = rects.reduce(
			(acc, rect) => ({
				x1: Math.min(acc.x1, rect.left),
				y1: Math.min(acc.y1, rect.top),
				x2: Math.max(acc.x2, rect.right),
				y2: Math.max(acc.y2, rect.bottom),
			}),
			{
				x1: rects[0].left,
				y1: rects[0].top,
				x2: rects[0].right,
				y2: rects[0].bottom,
			},
		);
		return {
			x1: (union.x1 - containerRect.left) / scaleX,
			y1: (union.y1 - containerRect.top) / scaleY,
			x2: (union.x2 - containerRect.left) / scaleX,
			y2: (union.y2 - containerRect.top) / scaleY,
		};
	}

	function buildLayout(): Word | null {
		const font = readFont();
		const text = placeholder.textContent?.replace(/\s+/g, " ").trim() ?? "";
		color = getComputedStyle(container).color;
		const wanted = `${font.weight} ${Math.round(font.size)}px ${font.family}`;
		if (document.fonts && text && wanted !== requestedFont) {
			requestedFont = wanted;
			// 字体迟到会改变墨迹尺寸，加载完标脏重排一次
			document.fonts
				.load(wanted, text)
				.then(invalidateLayout, invalidateLayout);
		}
		const ink = text ? measurePlaceholderInk() : null;
		if (!ink) {
			word = null;
			glyphs = [];
			return null;
		}

		const probe = scratchContext;
		applyFont(probe, font, font.size);
		const natural = probe.measureText(text);
		const naturalWidth = Math.max(
			1,
			natural.actualBoundingBoxLeft + natural.actualBoundingBoxRight,
		);
		// 名字过长把容器撑破时等比缩小，正常版式下 fit 恒为 1（保持原字号）
		const fit = Math.min(1, (width - ink.x1) / naturalWidth);
		const size = font.size * fit;
		applyFont(probe, font, size);
		const metrics = probe.measureText(text);
		const emBoxHeight =
			metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent;
		// 占位文字的 rect 是字符内容区（顶边 = 行盒顶 + half-leading，左沿 = 起笔点），
		// 不是墨迹框。按它还原真实基线与起笔点，canvas 字标才能与静态版式逐像素重合；
		// 若某浏览器给的是整个行盒，(rectH - emBox)/2 正好补回 half-leading，结果一致。
		const x = ink.x1 + metrics.actualBoundingBoxLeft * fit;
		const baseline =
			ink.y1 +
			(ink.y2 - ink.y1 - emBoxHeight) / 2 +
			metrics.fontBoundingBoxAscent;
		const next: Word = {
			left: x - metrics.actualBoundingBoxLeft,
			right: x + metrics.actualBoundingBoxRight,
			top: baseline - metrics.actualBoundingBoxAscent,
			bottom: baseline + metrics.actualBoundingBoxDescent,
		};
		word = next;

		const previous = glyphs;
		const nextGlyphs: Glyph[] = [];
		let prefix = "";
		Array.from(text).forEach((char) => {
			prefix += char;
			const own = probe.measureText(char);
			if (!char.trim()) return;
			const glyphX = x + probe.measureText(prefix).width - own.width;
			const base = {
				char,
				x: glyphX,
				box: {
					x1: glyphX - own.actualBoundingBoxLeft,
					y1: baseline - own.actualBoundingBoxAscent,
					x2: glyphX + own.actualBoundingBoxRight,
					y2: baseline + own.actualBoundingBoxDescent,
				},
			};
			// 同尺寸重建（换主题色、resize）时保留已被拖走的字母状态
			const kept = previous[nextGlyphs.length];
			nextGlyphs.push({
				...base,
				offset: kept?.char === char ? kept.offset : { x: 0, y: 0 },
				velocity: { x: 0, y: 0 },
				outline: 0,
				fill: createSprite(font, size, baseline, base, false),
				dashes: createSprite(font, size, baseline, base, true),
			});
		});

		glyphs = nextGlyphs;
		dragging = -1;
		selection.index = -1;
		return next;
	}

	/**
	 * 版式只在容器尺寸、字体、颜色变化时重建，而这些都由 resize / 字体迟到事件标脏，
	 * 所以逐帧只查一个标记，不在每帧读 getComputedStyle 与布局。
	 */
	function ensureLayout(): Word | null {
		if (word && !layoutDirty) return word;
		layoutDirty = false;
		return buildLayout();
	}

	function invalidateLayout() {
		if (destroyed) return;
		layoutDirty = true;
		if (running) {
			wake();
			return;
		}
		// 未激活时字体迟到也要重画静止帧，否则标题会停在旧字体上直到下次滚动
		if (ensureLayout()) render();
	}

	function glyphAt(x: number, y: number): number {
		if (!word || y < word.top - 24 || y > word.bottom + 24) return -1;
		let best = -1;
		let bestDistance = Number.POSITIVE_INFINITY;
		glyphs.forEach((glyph, index) => {
			const left = glyph.box.x1 + glyph.offset.x;
			const right = glyph.box.x2 + glyph.offset.x;
			const distance = x < left ? left - x : x > right ? x - right : 0;
			if (distance < bestDistance) {
				bestDistance = distance;
				best = index;
			}
		});
		return bestDistance < 28 ? best : -1;
	}

	function blit(
		target: CanvasRenderingContext2D,
		sprite: Sprite,
		dx: number,
		dy: number,
		originX: number,
		originY: number,
	) {
		target.drawImage(
			sprite.image,
			Math.round((sprite.left + dx) * dpr - originX),
			Math.round((sprite.top + dy) * dpr - originY),
		);
	}

	const crisp = (value: number): number =>
		(Math.round(value * dpr) + 0.5) / dpr;

	function perimeterPoint(
		distance: number,
		w: number,
		h: number,
	): [number, number, number, number] {
		const perimeter = 2 * (w + h);
		let walked = ((distance % perimeter) + perimeter) % perimeter;
		if (walked < w) return [selection.x1 + walked, selection.y1, 0, -1];
		walked -= w;
		if (walked < h) return [selection.x2, selection.y1 + walked, 1, 0];
		walked -= h;
		if (walked < w) return [selection.x2 - walked, selection.y2, 0, 1];
		walked -= w;
		return [selection.x1, selection.y2 - walked, -1, 0];
	}

	function drawSpecks(alpha: number) {
		const w = selection.x2 - selection.x1;
		const h = selection.y2 - selection.y1;
		if (w < 2 || h < 2) return;
		const perimeter = 2 * (w + h);
		const seed = selection.index + 1;
		const grid = 3;
		context.fillStyle = color;
		context.strokeStyle = color;

		for (let k = 0; k < SPECK_COUNT; k += 1) {
			const period = 0.5 + noise(seed, k, 11) * 1.2;
			const t = pulse / period + noise(seed, k, 17);
			const cycle = Math.floor(t);
			const life = t - cycle;
			if (life > 0.7) continue;
			const [px, py, nx, ny] = perimeterPoint(
				noise(seed, k, cycle) * perimeter,
				w,
				h,
			);
			const pick = noise(seed, k, cycle, 2);
			const size =
				pick < 0.46
					? 2
					: pick < 0.7
						? 3
						: pick < 0.84
							? 5
							: pick < 0.94
								? 8
								: 11;
			const large = size >= 8;
			const out =
				(large ? 9 : 4) + Math.floor(noise(seed, k, cycle, 1) * 5) * grid;
			const x =
				selection.x1 + Math.round((px + nx * out - selection.x1) / grid) * grid;
			const y =
				selection.y1 + Math.round((py + ny * out - selection.y1) / grid) * grid;
			const tone = noise(seed, k, cycle, 3);
			const blink = life < 0.06 || (life > 0.32 && life < 0.36) ? 0.35 : 1;
			const left = Math.round(x - size / 2);
			const top = Math.round(y - size / 2);
			context.globalAlpha =
				alpha * (large ? 0.3 + 0.4 * tone : 0.3 + 0.6 * tone) * blink;
			if (tone < 0.26 || (large && tone < 0.78)) {
				context.strokeRect(left + 0.5, top + 0.5, size, size);
				if (large && tone > 0.5) {
					context.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
				}
			} else {
				context.fillRect(left, top, size, size);
			}
		}

		// 两枚沿框周长巡游的拖尾光标
		for (let j = 0; j < 2; j += 1) {
			const head = (pulse * 0.42 * SWEEP_SPEED + j * 0.5) * perimeter;
			for (let i = 0; i < 4; i += 1) {
				const [x, y] = perimeterPoint(head - i * 6, w, h);
				const size = i === 0 ? 3 : 2;
				context.globalAlpha = alpha * [0.95, 0.55, 0.32, 0.16][i];
				context.fillRect(
					Math.round(x - size / 2),
					Math.round(y - size / 2),
					size,
					size,
				);
			}
		}
		context.globalAlpha = 1;
	}

	function drawSelection() {
		const glyph = glyphs[selection.index];
		if (!glyph || selection.alpha < 0.01) return;
		const alpha = selection.alpha;
		const x1 = crisp(selection.x1);
		const y1 = crisp(selection.y1);
		const x2 = crisp(selection.x2);
		const y2 = crisp(selection.y2);
		context.setTransform(dpr, 0, 0, dpr, 0, 0);

		const moved = Math.hypot(glyph.offset.x, glyph.offset.y);
		if (moved > 1) {
			const homeX = (glyph.box.x1 + glyph.box.x2) / 2;
			const homeY = (glyph.box.y1 + glyph.box.y2) / 2;
			context.beginPath();
			context.moveTo(homeX, homeY);
			context.lineTo(homeX + glyph.offset.x, homeY + glyph.offset.y);
			context.setLineDash([3, 4]);
			context.lineWidth = 1;
			context.strokeStyle = color;
			context.globalAlpha = 0.45 * alpha;
			context.stroke();
			context.setLineDash([]);
			context.globalAlpha = 0.7 * alpha;
			context.fillStyle = color;
			context.beginPath();
			context.rect(Math.round(homeX) - 2, Math.round(homeY) - 2, 4, 4);
			context.fill();
		}

		context.globalAlpha = 0.5 * alpha;
		context.strokeStyle = color;
		context.lineWidth = 1;
		context.beginPath();
		context.rect(x1, y1, x2 - x1, y2 - y1);
		context.stroke();

		context.globalAlpha = 0.95 * alpha;
		context.fillStyle = color;
		context.beginPath();
		for (const [cornerX, cornerY] of [
			[x1, y1],
			[x2, y1],
			[x2, y2],
			[x1, y2],
		]) {
			context.rect(Math.round(cornerX) - 2, Math.round(cornerY) - 2, 5, 5);
		}
		context.fill();

		drawSpecks(alpha);
		context.globalAlpha = 1;
	}

	function render() {
		// 首帧画好才交出显示权，避免占位文字与 canvas 之间闪一次空档；
		// 挂载瞬间容器还没尺寸时（layout 拿不到墨迹框）会由后续帧补上。
		if (!shown && glyphs.length) {
			shown = true;
			container.classList.add("is-mounted");
		}
		context.setTransform(1, 0, 0, 1, 0, 0);
		context.globalCompositeOperation = "source-over";
		context.clearRect(0, 0, canvas.width, canvas.height);
		for (const glyph of glyphs) {
			const moved = Math.hypot(glyph.offset.x, glyph.offset.y);
			if (moved <= 1) continue;
			// 离开基线的字母在原位留一份半透明虚线影
			context.globalAlpha = Math.min(1, moved / 24) * 0.55;
			blit(context, glyph.dashes, 0, 0, 0, 0);
		}
		for (const glyph of glyphs) {
			if (glyph.outline < 0.999) {
				context.globalAlpha = 1 - glyph.outline;
				blit(context, glyph.fill, glyph.offset.x, glyph.offset.y, 0, 0);
			}
			if (glyph.outline > 0.001) {
				context.globalAlpha = glyph.outline;
				blit(context, glyph.dashes, glyph.offset.x, glyph.offset.y, 0, 0);
			}
		}
		context.globalAlpha = 1;
		drawSelection();
	}

	function stepSprings(delta: number) {
		glyphs.forEach((glyph, index) => {
			if (index === dragging) {
				glyph.offset.x = approach(
					glyph.offset.x,
					pointer.x - grab.x,
					delta,
					DRAG_SECONDS,
				);
				glyph.offset.y = approach(
					glyph.offset.y,
					pointer.y - grab.y,
					delta,
					DRAG_SECONDS,
				);
				glyph.velocity.x = 0;
				glyph.velocity.y = 0;
			} else {
				const { offset, velocity } = glyph;
				if (
					Math.abs(offset.x) < 0.05 &&
					Math.abs(offset.y) < 0.05 &&
					Math.hypot(velocity.x, velocity.y) < 0.5
				) {
					offset.x = 0;
					offset.y = 0;
					velocity.x = 0;
					velocity.y = 0;
					return;
				}
				velocity.x += (-SPRING * offset.x - DAMPING * velocity.x) * delta;
				velocity.y += (-SPRING * offset.y - DAMPING * velocity.y) * delta;
				offset.x += velocity.x * delta;
				offset.y += velocity.y * delta;
			}
			// 指针捕获后能一路拖到容器外，字母越出画布就会被边缘切成残字，
			// 所以按字母墨迹盒把位移夹在画布范围内。
			glyph.offset.x = Math.min(
				Math.max(glyph.offset.x, -glyph.box.x1),
				width - glyph.box.x2,
			);
			glyph.offset.y = Math.min(
				Math.max(glyph.offset.y, -glyph.box.y1),
				height - glyph.box.y2,
			);
		});
	}

	function tick(now: number) {
		animationFrame = 0;
		const delta = Math.min(0.05, Math.max(0.001, (now - lastFrameAt) / 1000));
		lastFrameAt = now;
		const view = ensureLayout();
		if (!view) return;

		const sweeping = !pointer.inside && dragging < 0;
		if (sweeping) clock += delta * SWEEP_SPEED;
		pulse += delta;
		let targetX = pointer.x;
		let targetY = pointer.y;
		if (sweeping) {
			targetX =
				view.left +
				(view.right - view.left) * (0.5 - 0.5 * Math.cos(clock * 0.45));
			targetY =
				view.top +
				(view.bottom - view.top) * (0.45 + 0.1 * Math.sin(clock * 0.8));
		}
		// sweeping 与 pointer.inside / dragging 互斥互补，镜头恒有跟踪目标：
		// 指针在内跟指针，否则沿字标来回扫。placed 只用于首帧吸附，避免镜头
		// 从 (0,0) 滑进来。
		if (!placed) {
			lens.x = targetX;
			lens.y = targetY;
		}
		const lag = pointer.inside ? LENS_POINTER_SECONDS : LENS_SWEEP_SECONDS;
		lens.x = approach(lens.x, targetX, delta, lag);
		lens.y = approach(lens.y, targetY, delta, lag);
		placed = true;

		stepSprings(delta);

		const focus = dragging >= 0 ? dragging : glyphAt(lens.x, lens.y);
		if (focus >= 0) {
			const glyph = glyphs[focus];
			const boxLeft = glyph.box.x1 + glyph.offset.x - 6;
			const boxTop = glyph.box.y1 + glyph.offset.y - 6;
			const boxRight = glyph.box.x2 + glyph.offset.x + 6;
			const boxBottom = glyph.box.y2 + glyph.offset.y + 6;
			if (selection.index < 0 || selection.alpha < 0.02) {
				selection.x1 = boxLeft;
				selection.y1 = boxTop;
				selection.x2 = boxRight;
				selection.y2 = boxBottom;
			}
			const glide = focus === dragging ? DRAG_SECONDS : GLIDE_SECONDS;
			selection.x1 = approach(selection.x1, boxLeft, delta, glide);
			selection.y1 = approach(selection.y1, boxTop, delta, glide);
			selection.x2 = approach(selection.x2, boxRight, delta, glide);
			selection.y2 = approach(selection.y2, boxBottom, delta, glide);
			selection.index = focus;
		}
		selection.alpha = approach(
			selection.alpha,
			focus >= 0 ? 1 : 0,
			delta,
			FRAME_SECONDS,
		);

		glyphs.forEach((glyph, index) => {
			const target = index === focus && index !== dragging ? 1 : 0;
			glyph.outline = approach(glyph.outline, target, delta, OUTLINE_SECONDS);
			if (Math.abs(glyph.outline - target) <= 0.002) glyph.outline = target;
		});

		container.style.cursor =
			dragging >= 0 ? "grabbing" : focus >= 0 && pointer.inside ? "grab" : "";

		render();

		// 空闲扫掠本身每帧都在动，所以只要处于激活状态就续帧；停摆由 setActive /
		// 切后台负责，指针事件与字体迟到通过 wake 补回。
		if (running && !document.hidden)
			animationFrame = requestAnimationFrame(tick);
	}

	function wake() {
		if (animationFrame || !running || destroyed || document.hidden) return;
		lastFrameAt = performance.now();
		animationFrame = requestAnimationFrame(tick);
	}

	function resize() {
		width = Math.max(1, container.clientWidth);
		height = Math.max(1, container.clientHeight);
		dpr = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
		canvas.width = Math.round(width * dpr);
		canvas.height = Math.round(height * dpr);
		layoutDirty = true;
		wake();
	}

	/** gsap 会把标题缩放/位移，rect 是视觉尺寸，要按比值换算回布局坐标系 */
	function locate(event: PointerEvent) {
		const rect = container.getBoundingClientRect();
		const scaleX =
			container.clientWidth > 0 ? rect.width / container.clientWidth : 1;
		const scaleY =
			container.clientHeight > 0 ? rect.height / container.clientHeight : 1;
		pointer.x = (event.clientX - rect.left) / (scaleX || 1);
		pointer.y = (event.clientY - rect.top) / (scaleY || 1);
	}

	function onPointerMove(event: PointerEvent) {
		locate(event);
		pointer.inside = true;
		wake();
	}

	function onPointerLeave() {
		if (dragging >= 0) return;
		pointer.inside = false;
		wake();
	}

	function onPointerDown(event: PointerEvent) {
		locate(event);
		pointer.inside = true;
		if (event.pointerType === "mouse" && event.button !== 0) {
			wake();
			return;
		}
		const index = glyphAt(pointer.x, pointer.y);
		if (index >= 0) {
			dragging = index;
			grab.x = pointer.x - glyphs[index].offset.x;
			grab.y = pointer.y - glyphs[index].offset.y;
			container.setPointerCapture?.(event.pointerId);
		}
		wake();
	}

	function onPointerUp(event: PointerEvent) {
		if (dragging < 0) return;
		dragging = -1;
		container.releasePointerCapture?.(event.pointerId);
		const rect = container.getBoundingClientRect();
		pointer.inside =
			event.clientX >= rect.left &&
			event.clientX <= rect.right &&
			event.clientY >= rect.top &&
			event.clientY <= rect.bottom;
		wake();
	}

	function onVisibilityChange() {
		if (document.hidden) {
			cancelAnimationFrame(animationFrame);
			animationFrame = 0;
			return;
		}
		wake();
	}

	container.addEventListener("pointermove", onPointerMove, {
		passive: true,
		signal: abortController.signal,
	});
	container.addEventListener("pointerenter", onPointerMove, {
		passive: true,
		signal: abortController.signal,
	});
	container.addEventListener("pointerdown", onPointerDown, {
		passive: true,
		signal: abortController.signal,
	});
	container.addEventListener("pointerup", onPointerUp, {
		passive: true,
		signal: abortController.signal,
	});
	container.addEventListener("pointercancel", onPointerUp, {
		passive: true,
		signal: abortController.signal,
	});
	container.addEventListener("pointerleave", onPointerLeave, {
		passive: true,
		signal: abortController.signal,
	});
	document.addEventListener("visibilitychange", onVisibilityChange, {
		signal: abortController.signal,
	});
	resizeObserver.observe(container);
	// 主题切换只翻 <html> 的 dark 类，墨水色走 CSS 变量；canvas 里是位图，
	// 不重排重画就会一直停在旧主题的字色上。
	const themeObserver = new MutationObserver(invalidateLayout);
	themeObserver.observe(document.documentElement, {
		attributeFilter: ["class"],
	});

	resize();
	// 挂载瞬间就同步画一帧，别让标题先以占位文字露脸再跳到 canvas
	if (ensureLayout()) render();

	return {
		setActive(nextActive: boolean) {
			if (running === nextActive) return;
			running = nextActive;
			if (!running) {
				cancelAnimationFrame(animationFrame);
				animationFrame = 0;
				// 冻结在干净的静止帧上退场：标题正被时间线淡出，留着扫掠中间态会花
				selection.alpha = 0;
				selection.index = -1;
				for (const glyph of glyphs) glyph.outline = 0;
				render();
				return;
			}
			wake();
		},
		destroy() {
			destroyed = true;
			running = false;
			cancelAnimationFrame(animationFrame);
			animationFrame = 0;
			resizeObserver.disconnect();
			themeObserver.disconnect();
			abortController.abort();
			container.classList.remove("is-mounted");
			container.style.cursor = "";
			shown = false;
			glyphs = [];
			word = null;
			layoutDirty = true;
		},
	};
}
