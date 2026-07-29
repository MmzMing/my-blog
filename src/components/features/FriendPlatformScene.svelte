<script lang="ts">
import { onDestroy, onMount } from "svelte";
import * as THREE from "three";
import type { FriendLink } from "@/types/config";

type ArrivalPhase = "idle" | "arriving" | "opening" | "open";

interface Props {
	phase: ArrivalPhase;
	runId: number;
	statusText: string;
	routeCode: string;
	routeColor: string;
	stations: FriendLink[];
	enabledUrls: string[];
	selectedUrl: string;
	applyEnabled: boolean;
	onStationSelect: (friend: FriendLink) => void;
	onMore: () => void;
	onApply: () => void;
}

let {
	phase,
	runId,
	statusText,
	routeCode,
	routeColor,
	stations,
	enabledUrls,
	selectedUrl,
	applyEnabled,
	onStationSelect,
	onMore,
	onApply,
}: Props = $props();
let container: HTMLDivElement;

let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;
let animationId = 0;
let resizeObserver: ResizeObserver | undefined;
let themeObserver: MutationObserver | undefined;
let visibilityObserver: IntersectionObserver | undefined;
let visible = true;
let currentPhase: ArrivalPhase = "idle";
let activeRun = -1;
let arrivalProgress = 0;
let doorProgress = 0;
let focusProgress = 0;
let lastTime = 0;
let reducedMotion = false;
let trainGroup: THREE.Group;
let screenDoorLeft: THREE.Group;
let screenDoorRight: THREE.Group;
let trainDoorLeft: THREE.Group;
let trainDoorRight: THREE.Group;
let platformClockHand: THREE.Line;
let scanLight: THREE.Line;
const lineMaterial = new THREE.LineBasicMaterial({ color: 0x111111 });
const fillMaterial = new THREE.MeshBasicMaterial({
	color: 0xffffff,
	polygonOffset: true,
	polygonOffsetFactor: 2,
	polygonOffsetUnits: 2,
});
const glassMaterial = new THREE.MeshBasicMaterial({
	color: 0xd7d7d7,
	transparent: true,
	opacity: 0.2,
	depthWrite: false,
	side: THREE.DoubleSide,
});
const safetyMaterial = new THREE.MeshBasicMaterial({ color: 0xe0b400 });
const pointer = new THREE.Vector2();
const cameraTarget = new THREE.Vector3();
const raycaster = new THREE.Raycaster();
const ROUTE_BOARD_WIDTH = 15.8;
const ROUTE_BOARD_HEIGHT = 2.65;
type TextSurface = {
	canvas: HTMLCanvasElement;
	context: CanvasRenderingContext2D;
	texture: THREE.CanvasTexture;
	text: string;
	fontSize: number;
};
const textSurfaces: TextSurface[] = [];
let overheadStatusSurface: TextSurface | undefined;
let routeBoardCanvas: HTMLCanvasElement | undefined;
let routeBoardContext: CanvasRenderingContext2D | undefined;
let routeBoardTexture: THREE.CanvasTexture | undefined;
let routeBoardDisplay: THREE.Mesh | undefined;
let hoveredRouteTarget = "";

$effect(() => {
	currentPhase = phase;
	if (activeRun !== runId) {
		activeRun = runId;
		resetInteraction();
	}
	updateOverheadStatus(statusText);
	paintRouteBoard(
		routeCode,
		routeColor,
		stations,
		enabledUrls,
		selectedUrl,
		applyEnabled,
	);
});

function easeOutCubic(value: number): number {
	return 1 - (1 - value) ** 3;
}

function easeInOutCubic(value: number): number {
	return value < 0.5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2;
}

function geometryFromPoints(
	points: Array<[number, number, number]>,
): THREE.BufferGeometry {
	return new THREE.BufferGeometry().setFromPoints(
		points.map(([x, y, z]) => new THREE.Vector3(x, y, z)),
	);
}

function line(points: Array<[number, number, number]>): THREE.Line {
	return new THREE.Line(geometryFromPoints(points), lineMaterial);
}

function loop(points: Array<[number, number, number]>): THREE.LineLoop {
	return new THREE.LineLoop(geometryFromPoints(points), lineMaterial);
}

function outlinedBox(
	width: number,
	height: number,
	depth: number,
): THREE.Group {
	const geometry = new THREE.BoxGeometry(width, height, depth);
	const group = new THREE.Group();
	group.add(new THREE.Mesh(geometry, fillMaterial));
	group.add(
		new THREE.LineSegments(new THREE.EdgesGeometry(geometry, 18), lineMaterial),
	);
	return group;
}

function wireBox(
	width: number,
	height: number,
	depth: number,
): THREE.LineSegments {
	const geometry = new THREE.BoxGeometry(width, height, depth);
	return new THREE.LineSegments(
		new THREE.EdgesGeometry(geometry, 18),
		lineMaterial,
	);
}

function addAt<T extends THREE.Object3D>(
	object: T,
	x: number,
	y: number,
	z: number,
	parent: THREE.Object3D = scene,
): T {
	object.position.set(x, y, z);
	parent.add(object);
	return object;
}

function createDoorPanel(width = 3.05): THREE.Group {
	const panel = new THREE.Group();
	panel.add(wireBox(width, 5.35, 0.12));

	const glass = new THREE.Mesh(
		new THREE.PlaneGeometry(width - 0.28, 3.65),
		glassMaterial,
	);
	glass.position.set(0, 0.52, 0.07);
	panel.add(glass);

	const lower = outlinedBox(width - 0.08, 1.02, 0.1);
	lower.position.set(0, -2.08, 0.02);
	panel.add(lower);

	panel.add(
		line([
			[0, -2.66, 0.08],
			[0, 2.66, 0.08],
		]),
	);
	panel.add(
		line([
			[-width / 2, -0.5, 0.08],
			[width / 2, -0.5, 0.08],
		]),
	);

	const safetyStripe = new THREE.Mesh(
		new THREE.BoxGeometry(width - 0.18, 0.18, 0.08),
		safetyMaterial,
	);
	safetyStripe.position.set(0, -0.22, 0.1);
	panel.add(safetyStripe);
	return panel;
}

function createFixedScreenPanel(width: number): THREE.Group {
	const panel = new THREE.Group();
	panel.add(wireBox(width, 5.35, 0.16));

	const glass = new THREE.Mesh(
		new THREE.PlaneGeometry(width - 0.3, 3.65),
		glassMaterial,
	);
	glass.position.set(0, 0.52, 0.09);
	panel.add(glass);

	const lower = outlinedBox(width - 0.1, 1.02, 0.12);
	lower.position.set(0, -2.08, 0.02);
	panel.add(lower);

	for (const x of [-width / 4, 0, width / 4]) {
		panel.add(
			line([
				[x, -2.66, 0.1],
				[x, 2.66, 0.1],
			]),
		);
	}
	panel.add(
		line([
			[-width / 2, -0.5, 0.1],
			[width / 2, -0.5, 0.1],
		]),
	);

	const safetyStripe = new THREE.Mesh(
		new THREE.BoxGeometry(width - 0.2, 0.18, 0.08),
		safetyMaterial,
	);
	safetyStripe.position.set(0, -0.22, 0.12);
	panel.add(safetyStripe);
	return panel;
}

function paintTextSurface(
	surface: (typeof textSurfaces)[number],
	dark: boolean,
): void {
	const { canvas, context, text, fontSize, texture } = surface;
	context.clearRect(0, 0, canvas.width, canvas.height);
	context.fillStyle = dark ? "#000000" : "#ffffff";
	context.fillRect(0, 0, canvas.width, canvas.height);
	context.strokeStyle = dark ? "#ffffff" : "#000000";
	context.lineWidth = 8;
	context.strokeRect(5, 5, canvas.width - 10, canvas.height - 10);
	context.fillStyle = dark ? "#ffffff" : "#000000";
	let fittedFontSize = fontSize;
	context.font = `800 ${fittedFontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
	while (
		context.measureText(text).width > canvas.width - 96 &&
		fittedFontSize > 26
	) {
		fittedFontSize -= 2;
		context.font = `800 ${fittedFontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
	}
	context.textAlign = "center";
	context.textBaseline = "middle";
	context.fillText(text, canvas.width / 2, canvas.height / 2);
	texture.needsUpdate = true;
}

function updateOverheadStatus(text: string): void {
	if (!overheadStatusSurface || overheadStatusSurface.text === text) return;
	overheadStatusSurface.text = text;
	paintTextSurface(overheadStatusSurface, isDarkTheme());
}

function textPlane(
	text: string,
	width: number,
	height: number,
	fontSize = 50,
): THREE.Mesh {
	const canvas = document.createElement("canvas");
	canvas.width = 1024;
	canvas.height = 256;
	const context = canvas.getContext("2d");
	if (!context) throw new Error("2D canvas is unavailable");
	const texture = new THREE.CanvasTexture(canvas);
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
	const surface = { canvas, context, texture, text, fontSize };
	textSurfaces.push(surface);
	paintTextSurface(surface, isDarkTheme());
	return new THREE.Mesh(
		new THREE.PlaneGeometry(width, height),
		new THREE.MeshBasicMaterial({
			map: texture,
			transparent: false,
			side: THREE.DoubleSide,
		}),
	);
}

function routeStationX(index: number, count: number): number {
	if (count <= 1) return 930;
	return 300 + (index / (count - 1)) * 1240;
}

function shortRouteLabel(value: string): string {
	const glyphs = Array.from(value.trim());
	return glyphs.length > 9 ? `${glyphs.slice(0, 8).join("")}…` : value;
}

function roundedRectPath(
	context: CanvasRenderingContext2D,
	x: number,
	y: number,
	width: number,
	height: number,
	radius: number,
): void {
	const safeRadius = Math.min(radius, width / 2, height / 2);
	context.beginPath();
	context.moveTo(x + safeRadius, y);
	context.lineTo(x + width - safeRadius, y);
	context.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
	context.lineTo(x + width, y + height - safeRadius);
	context.quadraticCurveTo(
		x + width,
		y + height,
		x + width - safeRadius,
		y + height,
	);
	context.lineTo(x + safeRadius, y + height);
	context.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
	context.lineTo(x, y + safeRadius);
	context.quadraticCurveTo(x, y, x + safeRadius, y);
	context.closePath();
}

function paintRouteBoard(
	code: string,
	boardRouteColor: string,
	boardStations: FriendLink[],
	enabled: string[],
	selected: string,
	canApply: boolean,
): void {
	if (!routeBoardCanvas || !routeBoardContext || !routeBoardTexture) return;
	const context = routeBoardContext;
	const dark = isDarkTheme();
	const paper = dark ? "#050505" : "#ffffff";
	const ink = dark ? "#ffffff" : "#111111";
	const muted = dark ? "#8f8f8f" : "#777777";
	const disabledColor = dark ? "#5d5d5d" : "#a0a0a0";

	context.clearRect(0, 0, routeBoardCanvas.width, routeBoardCanvas.height);
	context.fillStyle = paper;
	context.fillRect(0, 0, routeBoardCanvas.width, routeBoardCanvas.height);
	context.strokeStyle = ink;
	context.lineWidth = 12;
	context.strokeRect(
		6,
		6,
		routeBoardCanvas.width - 12,
		routeBoardCanvas.height - 12,
	);

	context.fillStyle = boardRouteColor;
	context.beginPath();
	context.arc(92, 250, 48, 0, Math.PI * 2);
	context.fill();
	context.fillStyle = "#ffffff";
	context.font = "800 34px ui-monospace, SFMono-Regular, Menlo, monospace";
	context.textAlign = "center";
	context.textBaseline = "middle";
	context.fillText(code, 92, 250);

	context.fillStyle = ink;
	context.font = "800 29px system-ui, sans-serif";
	context.textAlign = "left";
	context.fillText("友链中央站", 44, 52);
	context.fillStyle = muted;
	context.font = "700 18px ui-monospace, SFMono-Regular, Menlo, monospace";
	context.fillText("FRIEND LINK CENTRAL", 44, 82);

	const routeY = 250;
	const firstX = boardStations.length
		? routeStationX(0, boardStations.length)
		: 300;
	const lastX = boardStations.length
		? routeStationX(boardStations.length - 1, boardStations.length)
		: 1540;
	context.strokeStyle = boardRouteColor;
	context.lineWidth = 34;
	context.lineCap = "round";
	context.beginPath();
	context.moveTo(firstX, routeY);
	context.lineTo(lastX, routeY);
	context.stroke();

	for (const [index, station] of boardStations.entries()) {
		const x = routeStationX(index, boardStations.length);
		const isEnabled = enabled.includes(station.siteurl);
		const isSelected = selected === station.siteurl;
		const isHovered = hoveredRouteTarget === `station:${index}`;
		const stationColor = isEnabled ? boardRouteColor : disabledColor;

		context.save();
		context.translate(x - 12, 177);
		context.rotate(-0.64);
		context.fillStyle = isEnabled ? ink : muted;
		context.font = `${isSelected ? "800" : "700"} 27px system-ui, sans-serif`;
		context.textAlign = "left";
		context.fillText(shortRouteLabel(station.title), 0, 0);
		context.restore();

		if (isSelected) {
			context.fillStyle = paper;
			context.strokeStyle = stationColor;
			context.lineWidth = 13;
			context.beginPath();
			context.arc(x, routeY, 38, 0, Math.PI * 2);
			context.fill();
			context.stroke();
		}

		context.fillStyle = isSelected ? stationColor : paper;
		context.strokeStyle = stationColor;
		context.lineWidth = isHovered ? 13 : 10;
		context.beginPath();
		context.arc(x, routeY, isHovered ? 30 : 26, 0, Math.PI * 2);
		context.fill();
		context.stroke();
		if (isSelected) {
			context.fillStyle = "#ffffff";
			context.beginPath();
			context.arc(x, routeY, 9, 0, Math.PI * 2);
			context.fill();
		}
	}

	context.strokeStyle = ink;
	context.lineWidth = 5;
	context.beginPath();
	context.moveTo(1648, 24);
	context.lineTo(1648, 360);
	context.stroke();

	const drawAction = (
		key: string,
		label: string,
		x: number,
		y: number,
		width: number,
		height: number,
	): void => {
		const hovered = hoveredRouteTarget === key;
		roundedRectPath(context, x, y, width, height, 12);
		context.fillStyle = hovered ? boardRouteColor : paper;
		context.fill();
		context.strokeStyle = hovered ? boardRouteColor : ink;
		context.lineWidth = 4;
		context.stroke();
		context.fillStyle = hovered ? "#ffffff" : ink;
		context.font = "800 28px system-ui, sans-serif";
		context.textAlign = "center";
		context.textBaseline = "middle";
		context.fillText(label, x + width / 2, y + height / 2);
	};

	if (canApply) {
		drawAction("more", "查看更多", 1690, 48, 310, 126);
		drawAction("apply", "+  加入线路", 1690, 210, 310, 126);
	} else {
		drawAction("more", "查看更多", 1690, 74, 310, 236);
	}

	routeBoardTexture.needsUpdate = true;
}

function buildInteractiveRouteBoard(): void {
	routeBoardCanvas = document.createElement("canvas");
	routeBoardCanvas.width = 2048;
	routeBoardCanvas.height = 384;
	routeBoardContext = routeBoardCanvas.getContext("2d") ?? undefined;
	if (!routeBoardContext) throw new Error("2D canvas is unavailable");
	routeBoardTexture = new THREE.CanvasTexture(routeBoardCanvas);
	routeBoardTexture.colorSpace = THREE.SRGBColorSpace;
	routeBoardTexture.anisotropy = Math.min(
		4,
		renderer.capabilities.getMaxAnisotropy(),
	);

	const board = new THREE.Group();
	board.add(outlinedBox(16, 2.85, 0.22));
	routeBoardDisplay = new THREE.Mesh(
		new THREE.PlaneGeometry(ROUTE_BOARD_WIDTH, ROUTE_BOARD_HEIGHT),
		new THREE.MeshBasicMaterial({ map: routeBoardTexture }),
	);
	routeBoardDisplay.position.z = 0.13;
	routeBoardDisplay.renderOrder = 3;
	board.add(routeBoardDisplay);

	addAt(board, 0, 6.32, -0.88);
	board.rotation.y = -0.025;
	paintRouteBoard(
		routeCode,
		routeColor,
		stations,
		enabledUrls,
		selectedUrl,
		applyEnabled,
	);
}

function isDarkTheme(): boolean {
	return document.documentElement.classList.contains("dark");
}

function applyTheme(): void {
	const dark = isDarkTheme();
	lineMaterial.color.set(dark ? 0xffffff : 0x111111);
	fillMaterial.color.set(dark ? 0x050505 : 0xffffff);
	glassMaterial.color.set(dark ? 0x252525 : 0xd7d7d7);
	safetyMaterial.color.set(dark ? 0xf2c94c : 0xe0b400);
	for (const surface of textSurfaces) paintTextSurface(surface, dark);
	paintRouteBoard(
		routeCode,
		routeColor,
		stations,
		enabledUrls,
		selectedUrl,
		applyEnabled,
	);
}

function buildRoomShell(): void {
	const floor = outlinedBox(19, 0.12, 12);
	addAt(floor, 0, -0.08, 0);

	for (let z = -5; z <= 5.5; z += 0.8) {
		addAt(
			line([
				[-9, 0, z],
				[9, 0, z],
			]),
			0,
			0.005,
			0,
		);
	}
	for (let x = -8; x <= 8; x += 2) {
		addAt(
			line([
				[x, 0, -5.8],
				[x, 0, 5.8],
			]),
			0,
			0.006,
			0,
		);
	}

	addAt(outlinedBox(19, 7.2, 0.18), 0, 3.55, -5.85);
	addAt(outlinedBox(0.22, 7.2, 12), -9.5, 3.55, 0);
	addAt(outlinedBox(0.22, 7.2, 12), 9.5, 3.55, 0);
	addAt(outlinedBox(19, 0.18, 0.3), 0, 7.05, -1.2);
	addAt(outlinedBox(19, 0.16, 0.2), 0, 6.55, -5.6);

	for (const x of [-8.35, -3.15, 0, 3.15, 8.35]) {
		addAt(outlinedBox(0.22, 6.35, 0.34), x, 3.18, -1.3);
	}
	addAt(outlinedBox(16.9, 0.28, 0.42), 0, 6.17, -1.3);
	addAt(outlinedBox(16.9, 0.18, 0.3), 0, 0.34, -1.3);

	const fixedLeft = createFixedScreenPanel(5.12);
	const fixedRight = createFixedScreenPanel(5.12);
	addAt(fixedLeft, -5.74, 3.35, -1.3);
	addAt(fixedRight, 5.74, 3.35, -1.3);

	screenDoorLeft = createDoorPanel();
	screenDoorRight = createDoorPanel();
	addAt(screenDoorLeft, -1.53, 3.35, -1.22);
	addAt(screenDoorRight, 1.53, 3.35, -1.22);
	buildInteractiveRouteBoard();

	const overheadSign = textPlane(statusText, 7.2, 0.84, 45);
	overheadStatusSurface = textSurfaces[textSurfaces.length - 1];
	addAt(overheadSign, 0.25, 4.65, -0.92);

	const routeStripe = new THREE.Mesh(
		new THREE.BoxGeometry(16.85, 0.16, 0.16),
		safetyMaterial,
	);
	addAt(routeStripe, 0, 6.02, -1.08);

	for (const [label, x] of [
		["05", -2.72],
		["06", 2.72],
	] as const) {
		const numberPlate = textPlane(label, 0.62, 0.42, 78);
		addAt(numberPlate, x, 5.72, -1.02);
	}

	for (const x of [-8.72, 8.72]) {
		addAt(outlinedBox(0.72, 6.45, 4.75), x, 3.22, -3.48);
	}

	for (const x of [-6.8, -3.4, 0, 3.4, 6.8]) {
		addAt(outlinedBox(2.35, 0.08, 0.62), x, 6.94, -2.75);
	}

	const floorWarning = textPlane(
		"CAUTION / 小心站台间隙 / MIND THE GAP",
		6.2,
		0.85,
		42,
	);
	addAt(floorWarning, 0.4, 0.03, 0.05);
	floorWarning.rotation.x = -Math.PI / 2;

	const safetyLine = new THREE.Mesh(
		new THREE.BoxGeometry(18.3, 0.035, 0.2),
		safetyMaterial,
	);
	addAt(safetyLine, 0, 0.04, 1.05);

	const clockFace: Array<[number, number, number]> = [];
	for (let index = 0; index < 40; index += 1) {
		const angle = (index / 40) * Math.PI * 2;
		clockFace.push([Math.cos(angle) * 0.48, Math.sin(angle) * 0.48, 0]);
	}
	const clockGroup = new THREE.Group();
	clockGroup.add(loop(clockFace));
	clockGroup.add(
		line([
			[0, 0, 0],
			[0, 0.31, 0],
		]),
	);
	platformClockHand = line([
		[0, -0.06, 0],
		[0, 0.4, 0],
	]);
	clockGroup.add(platformClockHand);
	addAt(clockGroup, 7, 5.45, -1.05);

	scanLight = line([
		[-0.65, 0, 0],
		[0.65, 0, 0],
	]);
	addAt(scanLight, -7, 6.47, -1.02);
}

function buildTrain(): void {
	trainGroup = new THREE.Group();
	addAt(trainGroup, 14, 0, 0);

	const body = outlinedBox(13.7, 5.15, 0.9);
	body.position.set(0, 3.15, -3.7);
	trainGroup.add(body);

	for (const x of [-5.15, -3.45, 3.45, 5.15]) {
		const windowFrame = wireBox(1.45, 2.05, 0.06);
		windowFrame.position.set(x, 3.75, -3.19);
		trainGroup.add(windowFrame);
	}

	trainDoorLeft = createDoorPanel(2.05);
	trainDoorRight = createDoorPanel(2.05);
	trainDoorLeft.scale.set(1, 0.84, 1);
	trainDoorRight.scale.set(1, 0.84, 1);
	trainDoorLeft.position.set(-1.03, 3.1, -3.15);
	trainDoorRight.position.set(1.03, 3.1, -3.15);
	trainGroup.add(trainDoorLeft, trainDoorRight);

	const belt = outlinedBox(13.9, 0.32, 0.13);
	belt.position.set(0, 1.4, -3.13);
	trainGroup.add(belt);

	for (const x of [-5.2, 5.2]) {
		const lightPoints: Array<[number, number, number]> = [];
		for (let index = 0; index < 20; index += 1) {
			const angle = (index / 20) * Math.PI * 2;
			lightPoints.push([
				x + Math.cos(angle) * 0.18,
				1.02 + Math.sin(angle) * 0.18,
				-3.05,
			]);
		}
		trainGroup.add(loop(lightPoints));
	}
}

function resetInteraction(): void {
	arrivalProgress = currentPhase === "open" && reducedMotion ? 1 : 0;
	doorProgress = currentPhase === "open" && reducedMotion ? 1 : 0;
	focusProgress = 0;
	if (!trainGroup || !screenDoorLeft || !screenDoorRight) return;
	trainGroup.position.x = arrivalProgress ? 0 : 14;
	screenDoorLeft.position.x = doorProgress ? -4.1 : -1.53;
	screenDoorRight.position.x = doorProgress ? 4.1 : 1.53;
	trainDoorLeft.position.x = doorProgress ? -2.1 : -1.03;
	trainDoorRight.position.x = doorProgress ? 2.1 : 1.03;
}

function resize(): void {
	if (!renderer || !camera || !container) return;
	const width = Math.max(1, container.clientWidth);
	const height = Math.max(1, container.clientHeight);
	camera.aspect = width / height;
	camera.fov = camera.aspect < 0.82 ? 48 : camera.aspect < 1.25 ? 42 : 38;
	camera.updateProjectionMatrix();
	renderer.setSize(width, height, false);
}

function handlePointerMove(event: PointerEvent): void {
	const rect = container.getBoundingClientRect();
	pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
	pointer.y = 1 - ((event.clientY - rect.top) / rect.height) * 2;
	const nextTarget = routeTargetAtPointer();
	if (nextTarget !== hoveredRouteTarget) {
		hoveredRouteTarget = nextTarget;
		container.style.cursor = nextTarget ? "pointer" : "crosshair";
		paintRouteBoard(
			routeCode,
			routeColor,
			stations,
			enabledUrls,
			selectedUrl,
			applyEnabled,
		);
	}
}

function handlePointerLeave(): void {
	pointer.set(0, 0);
	hoveredRouteTarget = "";
	container.style.cursor = "crosshair";
	paintRouteBoard(
		routeCode,
		routeColor,
		stations,
		enabledUrls,
		selectedUrl,
		applyEnabled,
	);
}

function routeTargetAtPointer(): string {
	if (!camera || !routeBoardDisplay) return "";
	scene.updateMatrixWorld(true);
	camera.updateMatrixWorld(true);
	raycaster.setFromCamera(pointer, camera);
	const hit = raycaster.intersectObject(routeBoardDisplay, false)[0];
	if (!hit?.uv) return "";
	const canvasX = hit.uv.x * 2048;
	const canvasY = (1 - hit.uv.y) * 384;

	if (canvasX >= 1648) {
		if (!applyEnabled) return "more";
		if (canvasY >= 40 && canvasY <= 185) return "more";
		if (canvasY >= 195 && canvasY <= 350) return "apply";
		return "";
	}
	if (canvasY < 92 || canvasY > 310) return "";
	for (const [index, station] of stations.entries()) {
		const stationX = routeStationX(index, stations.length);
		if (
			Math.abs(canvasX - stationX) <= 76 &&
			enabledUrls.includes(station.siteurl)
		) {
			return `station:${index}`;
		}
	}
	return "";
}

function handleClick(event: MouseEvent): void {
	const rect = container.getBoundingClientRect();
	pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
	pointer.y = 1 - ((event.clientY - rect.top) / rect.height) * 2;
	const target = routeTargetAtPointer();
	if (!target) return;
	if (target === "more") {
		onMore();
		return;
	}
	if (target === "apply" && applyEnabled) {
		onApply();
		return;
	}
	const stationIndex = Number(target.split(":")[1]);
	const station = stations[stationIndex];
	if (station && enabledUrls.includes(station.siteurl))
		onStationSelect(station);
}

function updateInteraction(delta: number, elapsed: number): void {
	if (reducedMotion) {
		arrivalProgress = currentPhase === "idle" ? 0 : 1;
		doorProgress =
			currentPhase === "opening" || currentPhase === "open" ? 1 : 0;
	} else if (currentPhase === "idle") {
		arrivalProgress = Math.max(0, arrivalProgress - delta * 2.5);
		doorProgress = Math.max(0, doorProgress - delta * 3);
	} else if (currentPhase === "arriving") {
		arrivalProgress = Math.min(1, arrivalProgress + delta / 0.9);
		doorProgress = Math.max(0, doorProgress - delta * 3);
	} else {
		arrivalProgress = 1;
		doorProgress = Math.min(1, doorProgress + delta / 0.5);
	}

	const arrivalEase = easeOutCubic(arrivalProgress);
	const doorEase = easeInOutCubic(doorProgress);
	trainGroup.position.x = 14 * (1 - arrivalEase);
	trainGroup.position.y =
		currentPhase === "open" && !reducedMotion
			? Math.sin(elapsed * 1.7) * 0.018
			: 0;
	screenDoorLeft.position.x = THREE.MathUtils.lerp(-1.53, -4.1, doorEase);
	screenDoorRight.position.x = THREE.MathUtils.lerp(1.53, 4.1, doorEase);
	trainDoorLeft.position.x = THREE.MathUtils.lerp(-1.03, -2.1, doorEase);
	trainDoorRight.position.x = THREE.MathUtils.lerp(1.03, 2.1, doorEase);

	const focusTarget = currentPhase === "idle" ? 0 : 1;
	focusProgress += (focusTarget - focusProgress) * Math.min(1, delta * 2.4);
}

function updateAmbientMotion(delta: number, elapsed: number): void {
	if (!reducedMotion) {
		platformClockHand.rotation.z = -elapsed * 0.22;
		scanLight.position.x = -7 + ((elapsed * 1.15) % 14);
	}

	const breath = reducedMotion ? 0 : Math.sin(elapsed * 0.38) * 0.055;
	const narrow = camera.aspect < 0.82;
	const compact = camera.aspect >= 0.82 && camera.aspect < 1.25;
	const baseX = narrow ? 3.6 : compact ? 5.1 : 6.8;
	const baseZ = narrow ? 20.5 : compact ? 17.2 : 15.2;
	const pointerX = reducedMotion ? 0 : pointer.x;
	const pointerY = reducedMotion ? 0 : pointer.y;
	const targetX = baseX + pointerX * 0.42 * (1 - focusProgress * 0.65);
	const targetY = 6.7 - pointerY * 0.22 + breath;
	const targetZ = THREE.MathUtils.lerp(baseZ, baseZ - 1.2, focusProgress);
	camera.position.x += (targetX - camera.position.x) * Math.min(1, delta * 2.2);
	camera.position.y += (targetY - camera.position.y) * Math.min(1, delta * 2.2);
	camera.position.z += (targetZ - camera.position.z) * Math.min(1, delta * 2.2);
	cameraTarget.set(
		pointerX * 0.16 * (1 - focusProgress),
		THREE.MathUtils.lerp(2.75, 2.95, focusProgress),
		THREE.MathUtils.lerp(-2.25, -2.7, focusProgress),
	);
	camera.lookAt(cameraTarget);
}

function animate(time: number): void {
	animationId = requestAnimationFrame(animate);
	if (!visible) {
		lastTime = time;
		return;
	}
	const delta = Math.min(lastTime ? (time - lastTime) / 1000 : 0.016, 0.05);
	lastTime = time;
	const elapsed = time / 1000;
	updateInteraction(delta, elapsed);
	updateAmbientMotion(delta, elapsed);
	renderer.render(scene, camera);
}

function init(): void {
	reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	scene = new THREE.Scene();
	camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120);
	camera.position.set(6.8, 6.7, 15.2);
	camera.lookAt(0, 2.75, -2.25);

	renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
	renderer.setClearColor(0x000000, 0);
	renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.75));
	renderer.outputColorSpace = THREE.SRGBColorSpace;
	container.appendChild(renderer.domElement);

	buildRoomShell();
	buildTrain();
	applyTheme();
	resize();
	resetInteraction();

	resizeObserver = new ResizeObserver(resize);
	resizeObserver.observe(container);
	themeObserver = new MutationObserver(applyTheme);
	themeObserver.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ["class"],
	});
	visibilityObserver = new IntersectionObserver(([entry]) => {
		visible = entry?.isIntersecting ?? true;
	});
	visibilityObserver.observe(container);
}

function cleanup(): void {
	if (animationId) cancelAnimationFrame(animationId);
	resizeObserver?.disconnect();
	themeObserver?.disconnect();
	visibilityObserver?.disconnect();
	const geometries = new Set<THREE.BufferGeometry>();
	const materials = new Set<THREE.Material>();
	scene?.traverse((object) => {
		if (
			object instanceof THREE.Mesh ||
			object instanceof THREE.Line ||
			object instanceof THREE.LineSegments
		) {
			geometries.add(object.geometry);
			const objectMaterials = Array.isArray(object.material)
				? object.material
				: [object.material];
			for (const material of objectMaterials) materials.add(material);
		}
	});
	for (const geometry of geometries) geometry.dispose();
	for (const material of materials) material.dispose();
	for (const surface of textSurfaces) surface.texture.dispose();
	routeBoardTexture?.dispose();
	renderer?.dispose();
	if (renderer && container && renderer.domElement.parentNode === container) {
		container.removeChild(renderer.domElement);
	}
}

onMount(() => {
	init();
	animationId = requestAnimationFrame(animate);
});

onDestroy(cleanup);
</script>

<div
	bind:this={container}
	class="friend-platform-scene"
	role="group"
	aria-label="交互式友链站台，可点击线路牌选择站点"
	onpointermove={handlePointerMove}
	onpointerleave={handlePointerLeave}
	onclick={handleClick}
></div>

<style>
	.friend-platform-scene {
		width: 100%;
		height: clamp(28rem, 48vw, 38rem);
		background:
			radial-gradient(circle at 52% 36%, color-mix(in oklab, var(--terminal-ink) 3%, transparent), transparent 38%),
			var(--terminal-paper);
		cursor: crosshair;
		touch-action: pan-y;
	}

	.friend-platform-scene :global(canvas) {
		display: block;
		width: 100%;
		height: 100%;
	}

	@media (max-width: 760px) {
		.friend-platform-scene { height: 32rem; }
	}

	@media (max-width: 430px) {
		.friend-platform-scene { height: 34rem; }
	}
</style>
