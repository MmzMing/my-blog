/** 巡航约每秒 56px；触边后短暂提速，再以 0.85s 时间常数衰减回巡航。 */
const CRUISE_SPEED = 56;
const EDGE_SPEED = 220;
const MAX_RELEASE_SPEED = 720;
const MAX_EDGE_SPEED = 960;
const DECAY_RATE = 1 / 0.85;
const DRAG_THRESHOLD = 6;

/**
 * 每张图片独立往返和拖拽，共用一个动画帧与 ResizeObserver。
 * 尺寸仅在观察器回调中读取，每帧只更新各自的 transform。
 */
export function startBlindsImageRail(
	viewport: HTMLElement,
	track: HTMLElement,
	signal: AbortSignal,
): (paused: boolean) => void {
	let paused = true;
	let frame = 0;
	let lastFrame = 0;
	let hasMeasured = false;
	let hasTravelRange = false;
	type ImageMotion = {
		element: HTMLElement;
		position: number;
		maximum: number;
		direction: number;
		speed: number;
		cruiseSpeed: number;
		pointerId: number | null;
		dragging: boolean;
		startX: number;
		startY: number;
		startPosition: number;
		lastPointerX: number;
		lastPointerTime: number;
		dragVelocity: number;
	};
	const images = Array.from(
		track.querySelectorAll<HTMLElement>("[data-scenes-stand]"),
	).map(
		(element, index): ImageMotion => ({
			element,
			position: 0,
			maximum: 0,
			direction: index % 2 === 0 ? 1 : -1,
			speed: EDGE_SPEED * (1 - (index % 3) * 0.1),
			cruiseSpeed: CRUISE_SPEED * (0.9 + (index % 3) * 0.1),
			pointerId: null,
			dragging: false,
			startX: 0,
			startY: 0,
			startPosition: 0,
			lastPointerX: 0,
			lastPointerTime: 0,
			dragVelocity: 0,
		}),
	);

	const render = (image: ImageMotion): void => {
		image.element.style.transform = `translate3d(${image.position.toFixed(3)}px, 0, 0)`;
	};
	const stop = (): void => {
		if (frame) cancelAnimationFrame(frame);
		frame = 0;
		lastFrame = 0;
	};
	const wake = (): void => {
		if (!frame && !paused && !signal.aborted && hasTravelRange) {
			frame = requestAnimationFrame(tick);
		}
	};
	function tick(time: number): void {
		frame = 0;
		if (paused || signal.aborted) return;
		const elapsed = lastFrame ? Math.min((time - lastFrame) / 1000, 0.05) : 0;
		lastFrame = time;
		// 指数衰减的位移用解析积分，30Hz / 144Hz 的行程和减速曲线一致。
		const decay = Math.exp(-DECAY_RATE * elapsed);
		for (const image of images) {
			if (image.pointerId === null && image.maximum > 0) {
				image.position +=
					image.direction *
					(image.cruiseSpeed * elapsed +
						((image.speed - image.cruiseSpeed) * (1 - decay)) / DECAY_RATE);
				image.speed =
					image.cruiseSpeed + (image.speed - image.cruiseSpeed) * decay;
				if (
					(image.position <= 0 && image.direction < 0) ||
					(image.position >= image.maximum && image.direction > 0)
				) {
					image.position = image.direction < 0 ? 0 : image.maximum;
					image.direction *= -1;
					// 依据撞边速度提速，避免快速拖拽后反而被固定回弹速度拉慢。
					image.speed = Math.min(
						MAX_EDGE_SPEED,
						Math.max(EDGE_SPEED, image.speed * 1.4),
					);
				}
			}
			render(image);
		}
		wake();
	}

	const measure = (): void => {
		const width = viewport.clientWidth;
		hasTravelRange = false;
		for (const [index, image] of images.entries()) {
			const ratio = image.maximum > 0 ? image.position / image.maximum : 0;
			image.maximum = Math.max(0, width - image.element.offsetWidth);
			image.position = hasMeasured
				? ratio * image.maximum
				: image.maximum * ((index + 0.5) / images.length);
			image.startPosition =
				image.position - (image.lastPointerX - image.startX);
			if (image.maximum > 0) hasTravelRange = true;
			render(image);
		}
		hasMeasured = true;
		if (!hasTravelRange) stop();
		else wake();
	};
	const releasePointer = (image: ImageMotion): void => {
		const captured = image.pointerId;
		image.pointerId = null;
		image.dragging = false;
		image.element.classList.remove("is-dragging");
		if (captured !== null && image.element.hasPointerCapture(captured)) {
			image.element.releasePointerCapture(captured);
		}
	};
	for (const image of images) {
		const onPointerDown = (event: PointerEvent): void => {
			if (
				paused ||
				!event.isPrimary ||
				event.button !== 0 ||
				image.pointerId !== null
			)
				return;
			image.pointerId = event.pointerId;
			image.startX = image.lastPointerX = event.clientX;
			image.startY = event.clientY;
			image.startPosition = image.position;
			image.lastPointerTime = event.timeStamp;
			image.dragVelocity = 0;
			image.element.setPointerCapture(event.pointerId);
		};
		const onPointerMove = (event: PointerEvent): void => {
			if (event.pointerId !== image.pointerId) return;
			const deltaX = event.clientX - image.startX;
			const deltaY = event.clientY - image.startY;
			if (!image.dragging) {
				if (Math.max(Math.abs(deltaX), Math.abs(deltaY)) < DRAG_THRESHOLD)
					return;
				if (Math.abs(deltaY) >= Math.abs(deltaX)) {
					releasePointer(image);
					return;
				}
				image.dragging = true;
				image.element.classList.add("is-dragging");
			}
			const elapsed = Math.max(1, event.timeStamp - image.lastPointerTime);
			const instantaneous =
				((event.clientX - image.lastPointerX) / elapsed) * 1000;
			image.dragVelocity +=
				(instantaneous - image.dragVelocity) * (1 - Math.exp(-elapsed / 55));
			image.lastPointerX = event.clientX;
			image.lastPointerTime = event.timeStamp;
			image.position = Math.min(
				image.maximum,
				Math.max(0, image.startPosition + deltaX),
			);
			event.preventDefault();
		};
		const onPointerEnd = (event: PointerEvent): void => {
			if (event.pointerId !== image.pointerId) return;
			const releasedVelocity =
				image.dragVelocity *
				Math.exp(-Math.max(0, event.timeStamp - image.lastPointerTime) / 120);
			if (image.dragging && event.type === "pointerup") {
				if (Math.abs(releasedVelocity) > 1)
					image.direction = Math.sign(releasedVelocity);
				image.speed = Math.min(
					MAX_RELEASE_SPEED,
					Math.max(image.cruiseSpeed, Math.abs(releasedVelocity)),
				);
			}
			releasePointer(image);
		};
		image.element.addEventListener("pointerdown", onPointerDown, { signal });
		image.element.addEventListener("pointermove", onPointerMove, {
			passive: false,
			signal,
		});
		image.element.addEventListener("pointerup", onPointerEnd, { signal });
		image.element.addEventListener("pointercancel", onPointerEnd, { signal });
		image.element.addEventListener("lostpointercapture", onPointerEnd, {
			signal,
		});
	}

	const observer = new ResizeObserver(measure);
	observer.observe(viewport);
	for (const image of images) observer.observe(image.element);
	measure();
	signal.addEventListener(
		"abort",
		() => {
			stop();
			observer.disconnect();
			for (const image of images) {
				releasePointer(image);
				image.element.style.removeProperty("transform");
			}
		},
		{ once: true },
	);
	return (nextPaused: boolean): void => {
		if (paused === nextPaused) return;
		paused = nextPaused;
		if (paused) {
			stop();
			for (const image of images) releasePointer(image);
		} else {
			wake();
		}
	};
}
