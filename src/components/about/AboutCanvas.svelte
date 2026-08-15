<script lang="ts">
import {
	clearCache,
	type LayoutCursor,
	layoutNextLineRange,
	materializeLineRange,
	type PreparedTextWithSegments,
	prepareWithSegments,
} from "@chenglou/pretext";
import { onDestroy, onMount } from "svelte";
import {
	hitTestLink,
	type LinkHitArea,
	parseMarkdownToParagraphs,
	type StyledParagraph,
} from "@/utils/about/markdown-segments";
import {
	type BallState,
	computeLineExclusions,
	createBall,
	createDragState,
	type DragState,
	stepPhysics,
	updateDragVelocity,
} from "@/utils/about/reflow-engine";

// ===== Props =====
let { text = "" } = $props<{ text: string }>();

// ===== DOM =====
let canvas = $state<HTMLCanvasElement | null>(null);
let container = $state<HTMLDivElement | null>(null);
let rafId = 0;

// ===== 渲染参数 =====
let dpr = 1;
let canvasW = 0;
let canvasH = 0;
const FONT_SIZE = 16;
const LINE_HEIGHT = 28;
const PADDING = 24;
const BALL_RATIO = 0.12;
const FONT_FAMILY = "'Roboto', sans-serif";

// ===== 段落系统 =====
interface ParagraphLayout {
	para: StyledParagraph;
	prepared: PreparedTextWithSegments;
	lines: { text: string; width: number; cursor: LayoutCursor }[];
	totalHeight: number;
}
let paragraphs: StyledParagraph[] = [];
let paraLayouts: ParagraphLayout[] = [];

// ===== 球体 =====
let ball: BallState = createBall(40, 800, 600);
let drag: DragState = createDragState();

// ===== 3D 倾斜 =====
let tiltX = 0;
let tiltY = 0;

// ===== 图片 =====
let ballImg: HTMLImageElement | null = null;
let imgLoaded = false;

// ===== 链接 =====
let linkAreas: LinkHitArea[] = [];
let hoveredLink: string | null = null;

// ===== 工具函数 =====

function buildFont(fontSize: number, weight: "normal" | "bold"): string {
	return `${weight === "bold" ? "bold " : ""}${fontSize}px ${FONT_FAMILY}`;
}

function hitTest(mx: number, my: number): boolean {
	const dx = mx - ball.x;
	const dy = my - ball.y;
	return dx * dx + dy * dy <= ball.radius * ball.radius;
}

// ===== 预计算段落布局（在 resize 时调用） =====
function computeParagraphLayouts() {
	const scaledFontSize = FONT_SIZE * dpr;
	paraLayouts = [];
	for (const para of paragraphs) {
		const segFont = buildFont(
			para.segments[0]?.fontSize ?? scaledFontSize,
			para.segments[0]?.fontWeight ?? "normal",
		);
		const allText = para.segments.map((s) => s.text).join("");
		const prepared = prepareWithSegments(allText, segFont, {
			whiteSpace: "normal",
			wordBreak: "normal",
			letterSpacing: 0.5 * dpr,
		});
		paraLayouts.push({ para, prepared, lines: [], totalHeight: 0 });
	}
}

// ===== 布局单个段落（每帧调用，带排斥区域） =====
function layoutParagraph(
	pl: ParagraphLayout,
	widths: number[],
	startLineIdx: number,
): number {
	pl.lines = [];
	const lineHeight = LINE_HEIGHT * dpr;
	let cursor: LayoutCursor = { segmentIndex: 0, graphemeIndex: 0 };
	let lineIdx = startLineIdx;

	while (true) {
		const lw = widths[lineIdx] ?? widths[widths.length - 1] ?? canvasW;
		const range = layoutNextLineRange(pl.prepared, cursor, lw);
		if (!range) break;

		// 物化文本（使用 Pretext 内置函数）
		const line = materializeLineRange(pl.prepared, range);
		pl.lines.push({ text: line.text, width: range.width, cursor: range.start });
		cursor = range.end;
		lineIdx++;

		if (lineIdx - startLineIdx > 50) break; // 安全限制
	}

	pl.totalHeight = pl.lines.length * lineHeight;
	return lineIdx;
}

// ===== 绘制带样式的段落行 =====
function drawParagraphLine(
	ctx: CanvasRenderingContext2D,
	pl: ParagraphLayout,
	lineIdx: number,
	drawX: number,
	drawY: number,
	isDark: boolean,
) {
	const line = pl.lines[lineIdx];
	if (!line) return;

	const para = pl.para;
	const scaledFontSize = para.segments[0]?.fontSize ?? FONT_SIZE * dpr;

	// 简化：整行使用段落首段样式绘制
	const seg = para.segments[0];
	const color = seg?.href
		? isDark
			? "#6ab0ff"
			: "#4a9eff"
		: isDark
			? "rgba(255,255,255,0.87)"
			: "rgba(0,0,0,0.87)";

	ctx.fillStyle = color;
	ctx.font = buildFont(scaledFontSize, seg?.fontWeight ?? "normal");
	ctx.fillText(line.text, drawX, drawY);

	// 绘制装饰（下划线、删除线）
	if (seg?.decoration === "underline") {
		const textW = line.width;
		ctx.beginPath();
		ctx.moveTo(drawX, drawY + scaledFontSize + 2);
		ctx.lineTo(drawX + textW, drawY + scaledFontSize + 2);
		ctx.strokeStyle = color;
		ctx.lineWidth = 1 * dpr;
		ctx.stroke();
	} else if (seg?.decoration === "line-through") {
		const textW = line.width;
		ctx.beginPath();
		ctx.moveTo(drawX, drawY + scaledFontSize * 0.55);
		ctx.lineTo(drawX + textW, drawY + scaledFontSize * 0.55);
		ctx.strokeStyle = color;
		ctx.lineWidth = 1 * dpr;
		ctx.stroke();
	}

	// 记录链接命中区域
	if (seg?.href) {
		linkAreas.push({
			x: drawX,
			y: drawY,
			width: line.width,
			height: LINE_HEIGHT * dpr,
			href: seg.href,
		});
	}
}

// ===== 拖拽事件 =====

function onPointerDown(e: PointerEvent) {
	if (!canvas) return;
	const rect = canvas.getBoundingClientRect();
	const mx = (e.clientX - rect.left) * dpr;
	const my = (e.clientY - rect.top) * dpr;
	if (!hitTest(mx, my)) return;

	// 阻止触摸时的页面滚动
	e.preventDefault();

	drag = {
		isDragging: true,
		startX: mx,
		startY: my,
		lastX: mx,
		lastY: my,
		lastTime: performance.now(),
		velX: 0,
		velY: 0,
	};
	ball.vx = 0;
	ball.vy = 0;
	canvas.classList.add("is-dragging");
	canvas.setPointerCapture(e.pointerId);
}

function onPointerMove(e: PointerEvent) {
	if (!canvas) return;
	const rect = canvas.getBoundingClientRect();
	const mx = (e.clientX - rect.left) * dpr;
	const my = (e.clientY - rect.top) * dpr;

	if (drag.isDragging) {
		e.preventDefault();
		drag = updateDragVelocity(drag, mx, my, performance.now());
		ball.x = mx;
		ball.y = my;
	} else {
		// 检测链接悬停
		const hit = hitTestLink(linkAreas, mx, my);
		if (hit !== hoveredLink) {
			hoveredLink = hit;
			if (canvas) {
				canvas.style.cursor = hit ? "pointer" : "grab";
			}
		}
	}
}

function onPointerUp(_e: PointerEvent) {
	if (!drag.isDragging || !canvas) return;
	ball.vx = drag.velX * 8;
	ball.vy = drag.velY * 8;
	drag = createDragState();
	canvas.classList.remove("is-dragging");
}

function onClick(e: MouseEvent) {
	if (!canvas) return;
	const rect = canvas.getBoundingClientRect();
	const mx = (e.clientX - rect.left) * dpr;
	const my = (e.clientY - rect.top) * dpr;
	// 如果点击的是链接（且没有拖拽）
	if (!drag.isDragging) {
		const href = hitTestLink(linkAreas, mx, my);
		if (href) {
			window.open(href, "_blank", "noopener");
		}
	}
}

function onDblClick(e: MouseEvent) {
	if (!canvas) return;
	const rect = canvas.getBoundingClientRect();
	const mx = (e.clientX - rect.left) * dpr;
	const my = (e.clientY - rect.top) * dpr;
	if (hitTest(mx, my)) {
		ball.vy = -canvasH * 0.025;
	}
}

// ===== 主渲染循环 =====

function render() {
	if (!canvas || paraLayouts.length === 0) {
		rafId = requestAnimationFrame(render);
		return;
	}

	// 不可见时暂停渲染循环，由 IntersectionObserver 重新启动
	if (!isVisible) {
		rafId = null;
		return;
	}

	const ctx = canvas.getContext("2d");
	if (!ctx) return;

	const w = canvasW;
	const h = canvasH;

	// 1. 物理步进
	if (!drag.isDragging) {
		ball = stepPhysics(ball, 1, w, h);
	}

	// 2. 清除
	ctx.clearRect(0, 0, w, h);

	// 3. 预计算排斥区域
	const lineHeight = LINE_HEIGHT * dpr;
	const padding = PADDING * dpr;
	const fullW = w - padding * 2;
	const lineCount = Math.ceil(h / lineHeight);
	const exclusions = computeLineExclusions(
		ball,
		lineCount,
		lineHeight,
		padding,
	);

	// 计算每行可用宽度 + 绘制位置
	const lineWidths: number[] = [];
	const drawXs: number[] = [];
	for (let i = 0; i < lineCount; i++) {
		const ex = exclusions[i];
		if (!ex.hasExclusion) {
			lineWidths.push(fullW);
			drawXs.push(padding);
		} else {
			const leftW = Math.max(0, ex.exclusionLeft - padding);
			const rightW = Math.max(0, w - padding - ex.exclusionRight);
			if (leftW >= rightW) {
				lineWidths.push(Math.max(40, leftW));
				drawXs.push(padding);
			} else {
				lineWidths.push(Math.max(40, rightW));
				drawXs.push(Math.max(padding, ex.exclusionRight));
			}
		}
	}

	// 4. 布局 + 绘制所有段落
	linkAreas = [];
	const isDark = document.documentElement.classList.contains("dark");
	let currentLine = 0;
	let y = padding;

	for (const pl of paraLayouts) {
		// 水平线
		if (pl.para.type === "hr") {
			if (y < h) {
				ctx.beginPath();
				ctx.moveTo(padding, y);
				ctx.lineTo(w - padding, y);
				ctx.strokeStyle = isDark
					? "rgba(255,255,255,0.15)"
					: "rgba(0,0,0,0.15)";
				ctx.lineWidth = 1 * dpr;
				ctx.stroke();
			}
			y += lineHeight * pl.para.spacingAfter;
			currentLine = Math.ceil(y / lineHeight);
			continue;
		}

		// 布局段落（带排斥区域）
		const startLine = Math.max(currentLine, Math.floor(y / lineHeight));
		const endLine = layoutParagraph(pl, lineWidths, startLine);

		// 绘制每行
		for (let i = 0; i < pl.lines.length; i++) {
			const lineY = padding + (startLine + i) * lineHeight;
			if (lineY > h) break;
			drawParagraphLine(
				ctx,
				pl,
				i,
				drawXs[startLine + i] ?? padding,
				lineY,
				isDark,
			);
		}

		y =
			padding + endLine * lineHeight + lineHeight * (pl.para.spacingAfter - 1);
		currentLine = endLine;
	}

	// 5. 绘制球
	if (imgLoaded && ballImg) {
		ctx.save();
		ctx.beginPath();
		ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
		ctx.closePath();
		ctx.clip();
		ctx.drawImage(
			ballImg,
			ball.x - ball.radius,
			ball.y - ball.radius,
			ball.radius * 2,
			ball.radius * 2,
		);
		ctx.restore();
		ctx.beginPath();
		ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
		ctx.strokeStyle = isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.15)";
		ctx.lineWidth = 2 * dpr;
		ctx.stroke();
	} else {
		ctx.beginPath();
		ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2);
		ctx.fillStyle = isDark ? "#444" : "#ddd";
		ctx.fill();
	}

	// 6. 3D 容器倾斜
	const normX = (ball.x / w - 0.5) * 2;
	const normY = (ball.y / h - 0.5) * 2;
	tiltX += (normX * 3 - tiltX) * 0.06;
	tiltY += (normY * 2 - tiltY) * 0.06;
	if (container) {
		container.style.transform = `perspective(1000px) rotateY(${tiltX}deg) rotateX(${-tiltY}deg)`;
	}

	rafId = requestAnimationFrame(render);
}

// ===== 计算内容总高度 =====
function calcContentHeight(): number {
	const lineHeight = LINE_HEIGHT * dpr;
	const padding = PADDING * dpr;
	const fullW = canvasW - padding * 2;
	let y = padding;
	let currentLine = 0;

	for (const pl of paraLayouts) {
		if (pl.para.type === "hr") {
			y += lineHeight * pl.para.spacingAfter;
			currentLine = Math.ceil(y / lineHeight);
			continue;
		}
		const startLine = Math.max(currentLine, Math.floor(y / lineHeight));
		// 简单估算：用完整宽度布局来计算行数
		const tempLines: number[] = new Array(100).fill(fullW);
		const endLine = layoutParagraph(pl, tempLines, startLine);
		y =
			padding + endLine * lineHeight + lineHeight * (pl.para.spacingAfter - 1);
		currentLine = endLine;
	}

	return y + padding * 2;
}

// ===== Resize =====

function onResize() {
	if (!canvas || !container) return;
	dpr = window.devicePixelRatio || 1;
	const containerW = container.getBoundingClientRect().width;
	canvasW = containerW * dpr;

	// 先解析 Markdown → 样式化段落
	paragraphs = parseMarkdownToParagraphs(text, FONT_SIZE * dpr);
	computeParagraphLayouts();

	// 根据内容计算高度
	const contentH = calcContentHeight();
	const minH = 500 * dpr;
	canvasH = Math.max(minH, contentH);

	// 设置容器和 canvas 尺寸
	const cssH = canvasH / dpr;
	container.style.height = `${cssH}px`;
	canvas.width = canvasW;
	canvas.height = canvasH;

	// 重新初始化球体
	const radius = Math.min(canvasW, canvasH) * BALL_RATIO;
	ball = createBall(radius, canvasW, canvasH);
}

// ===== 生命周期 =====

let isVisible = true;
let visibilityObserver: IntersectionObserver | null = null;

onMount(() => {
	onResize();

	ballImg = new Image();
	ballImg.onload = () => {
		imgLoaded = true;
	};
	ballImg.src = "/assets/images/about.avif";

	// IntersectionObserver：离开视口时暂停渲染循环
	if (container) {
		visibilityObserver = new IntersectionObserver(
			(entries) => {
				isVisible = entries[0]?.isIntersecting ?? true;
				if (isVisible && !rafId) {
					rafId = requestAnimationFrame(render);
				}
			},
			{ threshold: 0 },
		);
		visibilityObserver.observe(container);
	}

	rafId = requestAnimationFrame(render);
	window.addEventListener("resize", onResize);
});

onDestroy(() => {
	cancelAnimationFrame(rafId);
	window.removeEventListener("resize", onResize);
	visibilityObserver?.disconnect();
	clearCache();
	paraLayouts = [];
	paragraphs = [];
	ballImg = null;
});
</script>

<div class="about-canvas-wrap" bind:this={container}>
	<canvas
		bind:this={canvas}
		onpointerdown={onPointerDown}
		onpointermove={onPointerMove}
		onpointerup={onPointerUp}
		onpointercancel={onPointerUp}
		onclick={onClick}
		ondblclick={onDblClick}
	></canvas>
</div>
