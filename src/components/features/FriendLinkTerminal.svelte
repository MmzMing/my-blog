<script lang="ts">
import {
	ChevronRight,
	ExternalLink,
	List as ListIcon,
	Map as MapIcon,
	Search,
	TrainFront,
	X,
} from "lucide-svelte";
import { onDestroy, tick } from "svelte";
import type { FriendLink } from "@/types/config";
import FriendPlatformScene from "./FriendPlatformScene.svelte";

type ViewMode = "map" | "directory";
type ArrivalPhase = "idle" | "departing" | "arriving" | "opening" | "open";
type DepartureDirection = "left" | "right";
type ArrivalRequest = {
	friend: FriendLink;
	onOpen?: () => void;
};

const ROUTE_COLORS = ["#a51f45", "#005b96", "#d86613", "#008c67"];
const DEPARTURE_DURATION_MS = 180;
const ARRIVAL_DURATION_MS = 280;
const OPENING_DURATION_MS = 140;

interface Props {
	items: FriendLink[];
	allLabel?: string;
	applyEnabled?: boolean;
}

let { items, allLabel = "全部", applyEnabled = false }: Props = $props();

let query = $state("");
let activeTag = $state("all");
let dialogTag = $state("all");
let viewMode = $state<ViewMode>("map");
let mobileRoute = $state(0);
let selected = $state<FriendLink | null>(null);
let arrivalPhase = $state<ArrivalPhase>("idle");
let arrivalRun = $state(0);
let avatarFailed = $state(false);
let platformEl = $state<HTMLElement | null>(null);
let routesDialog: HTMLDialogElement;
let applyTrigger: HTMLButtonElement;
let arrivalTimer: ReturnType<typeof setTimeout> | undefined;
let openingTimer: ReturnType<typeof setTimeout> | undefined;
let departureTimer: ReturnType<typeof setTimeout> | undefined;
let tourTimer: ReturnType<typeof setTimeout> | undefined;
let tourRun = 0;
let cycleRun = 0;
let tourActive = $state(false);
let departureDirection = $state<DepartureDirection>("right");
let tourNextStation = $state<FriendLink | null>(null);
let pendingArrival: ArrivalRequest | null = null;
let activeArrivalOnOpen: (() => void) | undefined;

let tags = $derived(
	Array.from(new Set(items.flatMap((item) => item.tags ?? []))).sort(),
);
let routes = $derived(splitIntoRoutes(items));
let normalizedQuery = $derived(query.trim().toLocaleLowerCase());
let filteredItems = $derived.by(() =>
	items.filter((friend) => matchesFriend(friend)),
);
let sceneRoute = $derived(displayRoute(routes[mobileRoute] ?? [], mobileRoute));
let sceneRouteColor = $derived(routeColorFor(mobileRoute));
let enabledSceneUrls = $derived(
	sceneRoute
		.filter((friend) => matchesFriend(friend))
		.map((friend) => friend.siteurl),
);
let arrivalLabel = $derived.by(() => {
	if (!selected) return "请选择上方站点，等待列车进站";
	if (arrivalPhase === "departing") return `${selected.title} · 列车驶离中`;
	if (arrivalPhase === "arriving")
		return `开往 ${selected.title} 的列车正在进站`;
	if (arrivalPhase === "opening") return "列车已到站，车门开启中";
	return `${selected.title} · 已到站`;
});

function splitIntoRoutes(source: FriendLink[]): FriendLink[][] {
	const result: FriendLink[][] = [];
	for (let index = 0; index < source.length; index += 8) {
		result.push(source.slice(index, index + 8));
	}
	return result;
}

function displayRoute(route: FriendLink[], routeIndex: number): FriendLink[] {
	return routeIndex % 2 === 1 ? route.slice().reverse() : route;
}

function routeColorFor(routeIndex: number): string {
	return ROUTE_COLORS[routeIndex % ROUTE_COLORS.length] ?? ROUTE_COLORS[0];
}

function matchesFriend(friend: FriendLink): boolean {
	const matchesTag =
		activeTag === "all" || (friend.tags ?? []).includes(activeTag);
	if (!matchesTag) return false;
	if (!normalizedQuery) return true;

	return [friend.title, friend.desc, ...(friend.tags ?? [])]
		.join(" ")
		.toLocaleLowerCase()
		.includes(normalizedQuery);
}

function matchesDialogFriend(friend: FriendLink): boolean {
	const matchesTag =
		dialogTag === "all" || (friend.tags ?? []).includes(dialogTag);
	if (!matchesTag) return false;
	if (!normalizedQuery) return true;
	return [friend.title, friend.desc, ...(friend.tags ?? [])]
		.join(" ")
		.toLocaleLowerCase()
		.includes(normalizedQuery);
}

function shortLabel(title: string): string {
	const glyphs = Array.from(title.trim());
	return glyphs.length > 10 ? `${glyphs.slice(0, 9).join("")}…` : title;
}

function initialOf(title: string): string {
	return Array.from(title.trim())[0] ?? "?";
}

function markerClass(friend: FriendLink): string {
	const tag = (friend.tags?.[0] ?? "Blog").toLocaleLowerCase();
	if (tag === "docs") return "marker-square";
	if (tag === "favoriteblog") return "marker-diamond";
	if (tag === "星图") return "marker-orbit";
	return "marker-circle";
}

function prefersReducedMotion(): boolean {
	return (
		typeof window !== "undefined" &&
		window.matchMedia("(prefers-reduced-motion: reduce)").matches
	);
}

function clearArrivalTimers(): void {
	if (arrivalTimer) clearTimeout(arrivalTimer);
	if (openingTimer) clearTimeout(openingTimer);
	if (departureTimer) clearTimeout(departureTimer);
	arrivalTimer = undefined;
	openingTimer = undefined;
	departureTimer = undefined;
}

function clearTourTimer(): void {
	if (tourTimer) clearTimeout(tourTimer);
	tourTimer = undefined;
}

function stopAutoTour(): void {
	tourRun += 1;
	tourActive = false;
	tourNextStation = null;
	clearTourTimer();
}

function clearSelection(): void {
	stopAutoTour();
	cycleRun += 1;
	clearArrivalTimers();
	pendingArrival = null;
	activeArrivalOnOpen = undefined;
	departureDirection = "left";
	selected = null;
	arrivalPhase = "idle";
	avatarFailed = false;
}

function setQuery(event: Event): void {
	query = (event.currentTarget as HTMLInputElement).value;
	clearSelection();
}

function setTag(tag: string): void {
	activeTag = tag;
	clearSelection();
}

function setView(mode: ViewMode): void {
	viewMode = mode;
	clearSelection();
}

function applyArrivalTarget(request: ArrivalRequest): void {
	const { friend, onOpen } = request;
	if (routesDialog?.open) routesDialog.close();
	const routeIndex = Math.floor(items.indexOf(friend) / 8);
	if (routeIndex >= 0) mobileRoute = routeIndex;
	if (viewMode !== "map") viewMode = "map";
	selected = friend;
	activeArrivalOnOpen = onOpen;
	avatarFailed = false;
}

function finishArrival(run: number): void {
	if (run !== cycleRun) return;
	const onOpen = activeArrivalOnOpen;
	activeArrivalOnOpen = undefined;
	onOpen?.();
}

async function startIncoming(
	request: ArrivalRequest,
	run: number,
): Promise<void> {
	if (run !== cycleRun) return;
	clearArrivalTimers();
	pendingArrival = null;
	departureDirection = "right";
	applyArrivalTarget(request);
	arrivalRun += 1;
	arrivalPhase = prefersReducedMotion() ? "open" : "arriving";
	await tick();
	if (run !== cycleRun) return;

	platformEl?.scrollIntoView({
		behavior: prefersReducedMotion() ? "auto" : "smooth",
		block: "nearest",
	});

	if (arrivalPhase === "open") {
		finishArrival(run);
		return;
	}

	arrivalTimer = setTimeout(() => {
		arrivalTimer = undefined;
		if (run !== cycleRun) return;
		arrivalPhase = "opening";
	}, ARRIVAL_DURATION_MS);
	openingTimer = setTimeout(() => {
		openingTimer = undefined;
		if (run !== cycleRun) return;
		arrivalPhase = "open";
		finishArrival(run);
	}, ARRIVAL_DURATION_MS + OPENING_DURATION_MS);
}

function completeDeparture(run: number): void {
	if (run !== cycleRun) return;
	departureTimer = undefined;
	const nextArrival = pendingArrival;
	pendingArrival = null;
	activeArrivalOnOpen = undefined;
	selected = null;
	arrivalPhase = "idle";
	avatarFailed = false;
	if (nextArrival) void startIncoming(nextArrival, run);
}

function startDeparture(run: number): void {
	clearArrivalTimers();
	departureDirection = "left";
	activeArrivalOnOpen = undefined;
	arrivalPhase = "departing";
	if (prefersReducedMotion()) {
		void tick().then(() => completeDeparture(run));
		return;
	}
	departureTimer = setTimeout(
		() => completeDeparture(run),
		DEPARTURE_DURATION_MS,
	);
}

function requestArrival(friend: FriendLink, onOpen?: () => void): void {
	const request = { friend, onOpen } satisfies ArrivalRequest;
	if (arrivalPhase === "open" && selected?.siteurl === friend.siteurl) {
		onOpen?.();
		return;
	}
	if (arrivalPhase === "departing") {
		pendingArrival = request;
		return;
	}
	if (arrivalPhase === "arriving" || arrivalPhase === "opening") {
		applyArrivalTarget(request);
		return;
	}

	const run = ++cycleRun;
	clearArrivalTimers();
	if (arrivalPhase === "open" && selected) {
		pendingArrival = request;
		startDeparture(run);
		return;
	}
	pendingArrival = null;
	void startIncoming(request, run);
}

function openFriend(friend: FriendLink): void {
	stopAutoTour();
	requestArrival(friend);
}

function closeArrival(): void {
	pendingArrival = null;
	if (arrivalPhase === "departing") return;
	if (!selected) {
		cycleRun += 1;
		clearArrivalTimers();
		arrivalPhase = "idle";
		return;
	}
	const run = ++cycleRun;
	clearArrivalTimers();
	startDeparture(run);
}

function dismissArrival(): void {
	stopAutoTour();
	closeArrival();
}

function startAutoTour(): void {
	const stops = sceneRoute.filter((friend) => matchesFriend(friend));
	if (!stops.length || tourActive) return;

	stopAutoTour();
	tourActive = true;
	const run = ++tourRun;
	const visit = (index: number): void => {
		if (run !== tourRun) return;
		const station = stops[index];
		if (!station) return;
		requestArrival(station, () => {
			if (run !== tourRun) return;
			tourNextStation = null;
			tourTimer = setTimeout(() => {
				if (run !== tourRun) return;
				if (index + 1 >= stops.length) {
					closeArrival();
					tourActive = false;
					return;
				}
				tourNextStation = stops[index + 1] ?? null;
				visit(index + 1);
			}, 2500);
		});
	};
	visit(0);
}

function handleStationKeydown(event: KeyboardEvent): void {
	if (!event.key.startsWith("Arrow")) return;

	const target = event.currentTarget as HTMLButtonElement;
	const scope = target.closest<HTMLElement>("[data-station-scope]");
	if (!scope) return;

	const stations = Array.from(
		scope.querySelectorAll<HTMLButtonElement>("[data-station]:not(:disabled)"),
	);
	const index = stations.indexOf(target);
	if (index < 0) return;

	const columns = scope.classList.contains("mobile-station-list") ? 2 : 8;
	const offset =
		event.key === "ArrowLeft"
			? -1
			: event.key === "ArrowRight"
				? 1
				: event.key === "ArrowUp"
					? -columns
					: columns;
	const nextIndex = Math.max(0, Math.min(stations.length - 1, index + offset));
	if (nextIndex === index) return;

	event.preventDefault();
	stations[nextIndex]?.focus();
}

function openRoutesDialog(): void {
	dialogTag = activeTag;
	if (!routesDialog.open) routesDialog.showModal();
}

function closeRoutesDialog(): void {
	routesDialog.close();
}

function selectRoute(routeIndex: number): void {
	mobileRoute = routeIndex;
	clearSelection();
	closeRoutesDialog();
}

function handleRoutesBackdrop(event: MouseEvent): void {
	if (event.target === routesDialog) closeRoutesDialog();
}

function openApplyDialog(): void {
	applyTrigger?.click();
}

onDestroy(() => {
	cycleRun += 1;
	tourRun += 1;
	pendingArrival = null;
	activeArrivalOnOpen = undefined;
	clearArrivalTimers();
	clearTourTimer();
});
</script>

<section class="friend-terminal" aria-label="友链中央站">
	<header class="terminal-toolbar">
		<label class="terminal-search">
			<span class="sr-only">搜索友链</span>
			<Search size={17} strokeWidth={1.8} aria-hidden="true" />
			<input
				type="search"
				value={query}
				oninput={setQuery}
				placeholder="搜索站点、简介或标签"
				autocomplete="off"
			/>
		</label>

		<nav class="terminal-filters" aria-label="友链标签筛选">
			<button
				type="button"
				class:active={activeTag === "all"}
				aria-pressed={activeTag === "all"}
				onclick={() => setTag("all")}
			>
				{allLabel}
			</button>
			{#each tags as tag (tag)}
				<button
					type="button"
					class:active={activeTag === tag}
					aria-pressed={activeTag === tag}
					onclick={() => setTag(tag)}
				>
					{tag}
				</button>
			{/each}
		</nav>

		<div class="terminal-view-switch" aria-label="友链视图">
			<button
				type="button"
				class:active={viewMode === "map"}
				aria-label="线路图视图"
				aria-pressed={viewMode === "map"}
				onclick={() => setView("map")}
			>
				<MapIcon size={17} strokeWidth={1.8} aria-hidden="true" />
			</button>
			<button
				type="button"
				class:active={viewMode === "directory"}
				aria-label="目录视图"
				aria-pressed={viewMode === "directory"}
				onclick={() => setView("directory")}
			>
				<ListIcon size={17} strokeWidth={1.8} aria-hidden="true" />
			</button>
		</div>
	</header>

	<div class="terminal-status" aria-live="polite">
		<span><strong>{filteredItems.length}</strong> / {items.length} 个站点</span>
		<span class="status-hint">选择线路站点，等待列车进站</span>
	</div>

	{#if viewMode === "map"}
		<div
			class="terminal-stage"
			style={`--route-count: ${Math.max(routes.length, 1)}`}
		>
			<section
				class="platform-shell"
				bind:this={platformEl}
				data-phase={arrivalPhase}
				aria-label="友链列车停靠区"
				aria-busy={arrivalPhase !== "idle" && arrivalPhase !== "open"}
			>
				<span class="sr-only" aria-live="polite">{arrivalLabel}</span>
				{#if applyEnabled}
					<button bind:this={applyTrigger} class="sr-only" type="button" tabindex="-1" data-open-friend-rules>
						加入线路
					</button>
				{/if}

				<div class="platform-scene-wrap">
					<div class="scene-canvas-layer">
						<FriendPlatformScene
							phase={arrivalPhase}
							runId={arrivalRun}
							statusText={arrivalLabel}
							routeCode={`L${mobileRoute + 1}`}
							routeColor={sceneRouteColor}
							stations={sceneRoute}
							enabledUrls={enabledSceneUrls}
							selectedUrl={selected?.siteurl ?? ""}
							routeCount={routes.length}
							stationCount={items.length}
							visibleStationCount={filteredItems.length}
							filterLabel={activeTag === "all" ? allLabel : activeTag}
							tourActive={tourActive}
							nextStation={tourNextStation}
							{departureDirection}
							{applyEnabled}
							onStationSelect={openFriend}
							onStartTour={startAutoTour}
							onMore={openRoutesDialog}
							onApply={openApplyDialog}
						/>
					</div>
					{#if filteredItems.length === 0}
						<div class="terminal-empty">
							<TrainFront size={28} strokeWidth={1.5} aria-hidden="true" />
							<strong>没有驶往该条件的列车</strong>
							<span>请更换关键词或标签</span>
						</div>
					{/if}
					{#if selected}
						<div
							class="cabin-info"
							class:revealed={arrivalPhase === "opening" || arrivalPhase === "open"}
							class:interactive={arrivalPhase === "open"}
							aria-hidden={arrivalPhase !== "open"}
						>
							<button
								class="arrival-close"
								type="button"
								aria-label="关闭站票并让列车离站"
								tabindex={arrivalPhase === "open" ? 0 : -1}
								onclick={dismissArrival}
							>
								<X size={18} strokeWidth={2.2} aria-hidden="true" />
							</button>
							<div class="arrival-avatar">
								{#if !avatarFailed}
									<img src={selected.imgurl} alt="" loading="lazy" onerror={() => (avatarFailed = true)} />
								{:else}
									<span aria-hidden="true">{initialOf(selected.title)}</span>
								{/if}
							</div>

							<div class="arrival-copy">
								<p>NEXT STOP · FRIEND LINK</p>
								<h2>{selected.title}</h2>
								<div class="arrival-tags">
									{#each selected.tags ?? ["Blog"] as tag (tag)}<span>{tag}</span>{/each}
								</div>
								<div class="arrival-description">{selected.desc}</div>
							</div>

							<a
								class="arrival-visit"
								href={selected.siteurl}
								target="_blank"
								rel="noopener noreferrer"
								tabindex={arrivalPhase === "open" ? 0 : -1}
							>
								访问站点 <ExternalLink size={17} strokeWidth={1.8} aria-hidden="true" />
							</a>
						</div>
					{/if}
				</div>
			</section>
		</div>
	{:else}
		<div class="terminal-directory" role="list" aria-label="友链目录">
			{#each filteredItems as friend, index (friend.siteurl)}
				<button type="button" class="directory-ticket" role="listitem" onclick={() => openFriend(friend)}>
					<span class="ticket-index">{String(index + 1).padStart(2, "0")}</span>
					<span class={`station-marker ${markerClass(friend)}`} aria-hidden="true"></span>
					<span class="ticket-copy"><strong>{friend.title}</strong><small>{friend.desc}</small></span>
					<ChevronRight size={18} strokeWidth={1.6} aria-hidden="true" />
				</button>
			{/each}

			{#if filteredItems.length === 0}<div class="directory-empty">没有找到匹配的友链</div>{/if}
		</div>
	{/if}

	<dialog bind:this={routesDialog} class="routes-dialog" aria-labelledby="routes-dialog-title" onclick={handleRoutesBackdrop}>
		<div class="routes-dialog-panel">
			<header class="routes-dialog-header">
				<div>
					<small>FRIEND LINK CENTRAL</small>
					<h2 id="routes-dialog-title">全部线路</h2>
				</div>
				<button type="button" aria-label="关闭全部线路" onclick={closeRoutesDialog}>
					<X size={20} strokeWidth={1.8} aria-hidden="true" />
				</button>
			</header>
			<nav class="routes-dialog-tabs" aria-label="线路类型筛选">
				<button
					type="button"
					class:active={dialogTag === "all"}
					aria-pressed={dialogTag === "all"}
					onclick={() => (dialogTag = "all")}
				>
					{allLabel}
				</button>
				{#each tags as tag (tag)}
					<button
						type="button"
						class:active={dialogTag === tag}
						aria-pressed={dialogTag === tag}
						onclick={() => (dialogTag = tag)}
					>
						{tag}
					</button>
				{/each}
			</nav>
			<div class="routes-dialog-map" data-station-scope>
				{#each routes as route, routeIndex (`dialog-route-${routeIndex}`)}
					<div
						class="route-row"
						class:reverse={routeIndex % 2 === 1}
						class:active-route={mobileRoute === routeIndex}
						style={`--dialog-route-color: ${routeColorFor(routeIndex)}`}
					>
						<button
							type="button"
							class="route-code"
							aria-label={`切换到 L${routeIndex + 1} 线路`}
							aria-pressed={mobileRoute === routeIndex}
							onclick={() => selectRoute(routeIndex)}
						>
							L{routeIndex + 1}
						</button>
						<div class="route-stations">
							{#each displayRoute(route, routeIndex) as friend (friend.siteurl)}
								<button
									type="button"
									class="station-button"
									class:dimmed={!matchesDialogFriend(friend)}
									class:selected={selected?.siteurl === friend.siteurl}
									disabled={!matchesDialogFriend(friend)}
									data-station
									aria-label={`${friend.title}，${friend.desc}`}
									onclick={() => openFriend(friend)}
									onkeydown={handleStationKeydown}
								>
									<span class="station-name" title={friend.title}>{shortLabel(friend.title)}</span>
									<span class={`station-marker ${markerClass(friend)}`} aria-hidden="true"></span>
								</button>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		</div>
	</dialog>
</section>

<style>
	.friend-terminal {
		--terminal-ink: var(--deep-text, #111111);
		--terminal-paper: var(--card-bg, var(--page-bg, #ffffff));
		--terminal-page: var(--page-bg, #ffffff);
		--terminal-muted: var(--content-meta, #5f6368);
		--terminal-line: var(--line-color, #c8c8c8);
		--terminal-accent: var(--primary, #2563eb);
		--terminal-safety: #e0b400;
		--terminal-safety-ink: #111111;
		--terminal-inverse: #ffffff;
		--terminal-solid-paper: #ffffff;
		position: relative;
		color: var(--terminal-ink);
	}

	:global(.dark) .friend-terminal {
		--terminal-inverse: #050505;
		--terminal-solid-paper: #050505;
		--terminal-safety: #f2c94c;
	}

	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.terminal-toolbar {
		display: grid;
		grid-template-columns: minmax(13rem, 1fr) auto auto;
		align-items: center;
		gap: 0.75rem;
		margin-bottom: 0.85rem;
	}

	.terminal-search {
		display: flex;
		align-items: center;
		gap: 0.55rem;
		min-height: 2.75rem;
		padding: 0 0.85rem;
		color: var(--terminal-muted);
		background: color-mix(in oklab, var(--terminal-paper) 92%, transparent);
		border: 1.5px solid var(--terminal-line);
		border-radius: 999px;
		transition: border-color 180ms ease, color 180ms ease;
	}

	.terminal-search:focus-within {
		color: var(--terminal-ink);
		border-color: var(--terminal-ink);
		box-shadow: 0 0 0 3px color-mix(in oklab, var(--terminal-accent) 20%, transparent);
	}

	.terminal-search input {
		width: 100%;
		min-width: 0;
		color: var(--terminal-ink);
		background: transparent;
		border: 0;
		outline: 0;
		font-size: 0.875rem;
	}

	.terminal-search input::placeholder { color: var(--terminal-muted); }

	.terminal-filters,
	.terminal-view-switch {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		padding: 0.25rem;
		border: 1.5px solid var(--terminal-line);
		border-radius: 999px;
	}

	.terminal-filters button,
	.terminal-view-switch button,
	.mobile-route-nav button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-height: 2.25rem;
		padding: 0 0.72rem;
		color: var(--terminal-muted);
		background: transparent;
		border: 0;
		border-radius: 999px;
		font-size: 0.78rem;
		font-weight: 650;
		cursor: pointer;
		transition: color 180ms ease, background-color 180ms ease;
	}

	.terminal-view-switch button { width: 2.25rem; padding: 0; }

	.terminal-filters button:hover,
	.terminal-view-switch button:hover,
	.terminal-filters button.active,
	.terminal-view-switch button.active {
		color: var(--terminal-page);
		background: var(--terminal-ink);
	}

	.terminal-filters button:focus-visible,
	.terminal-view-switch button:focus-visible,
	.mobile-route-nav button:focus-visible,
	.station-button:focus-visible,
	.mobile-station-list button:focus-visible,
	.directory-ticket:focus-visible,
	.station-service:focus-visible,
	.routes-dialog button:focus-visible,
	.arrival-visit:focus-visible {
		outline: 2px solid var(--terminal-accent);
		outline-offset: 3px;
	}

	.terminal-status {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		min-height: 1.75rem;
		margin-bottom: 0.6rem;
		color: var(--terminal-muted);
		font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
		font-size: 0.72rem;
		letter-spacing: 0.04em;
	}

	.terminal-status strong { color: var(--terminal-ink); font-size: 0.88rem; }

	.terminal-stage {
		display: grid;
		overflow: hidden;
		background: var(--terminal-paper);
		border: 2px solid var(--terminal-ink);
		border-radius: 0.55rem;
		box-shadow:
			0.45rem 0.5rem 0 color-mix(in oklab, var(--terminal-ink) 13%, transparent),
			0.85rem 0.95rem 0 color-mix(in oklab, var(--terminal-ink) 5%, transparent);
	}

	.route-signboard {
		position: relative;
		z-index: 4;
		width: 100%;
		box-sizing: border-box;
		margin: 0;
		background:
			linear-gradient(180deg, color-mix(in oklab, #ffffff 7%, transparent), transparent 20%),
			var(--terminal-paper);
		border: 0;
		border-bottom: 2px solid var(--terminal-ink);
		box-shadow: inset 0 -0.3rem 0 color-mix(in oklab, var(--terminal-ink) 7%, transparent);
	}

	.platform-direction-band {
		position: relative;
		z-index: 3;
		display: grid;
		min-height: 3.3rem;
		grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
		align-items: center;
		gap: 1rem;
		padding: 0.45rem 1.25rem;
		color: var(--terminal-safety-ink);
		background: var(--terminal-safety);
		border-top: 2px solid var(--terminal-ink);
		border-bottom: 3px solid var(--terminal-ink);
		box-shadow: inset 0 -0.25rem 0 color-mix(in oklab, #000000 10%, transparent);
	}

	.platform-direction-band::before,
	.platform-direction-band::after {
		content: "";
		position: absolute;
		top: 100%;
		width: 1rem;
		height: 5.75rem;
		box-sizing: border-box;
		background: var(--terminal-paper);
		border: 2px solid var(--terminal-ink);
		border-top: 0;
		pointer-events: none;
	}

	.platform-direction-band::before { left: 1.1rem; }
	.platform-direction-band::after { right: 1.1rem; }

	.direction-end,
	.direction-current,
	.direction-current > span {
		display: flex;
		min-width: 0;
		flex-direction: column;
	}

	.direction-end small,
	.direction-current small {
		font: 750 0.54rem/1.2 ui-monospace, SFMono-Regular, Menlo, monospace;
	}

	.direction-end strong,
	.direction-current strong {
		overflow: hidden;
		font-size: 0.74rem;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.direction-next { align-items: flex-end; text-align: right; }
	.direction-current {
		align-items: center;
		flex-direction: row;
		gap: 0.65rem;
		padding: 0 1.15rem;
		border-inline: 2px solid var(--terminal-safety-ink);
	}

	.direction-current i {
		display: grid;
		width: 2rem;
		height: 2rem;
		flex: 0 0 auto;
		place-items: center;
		color: var(--terminal-safety);
		background: var(--terminal-safety-ink);
		border-radius: 50%;
		font: normal 850 0.8rem/1 ui-monospace, SFMono-Regular, Menlo, monospace;
	}

	.signboard-header {
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto auto;
		align-items: center;
		gap: 1rem;
		min-height: 4.35rem;
		padding: 0.65rem 1.25rem;
		background: var(--terminal-paper);
		border-bottom: 2px solid var(--terminal-ink);
	}

	.signboard-roundel {
		position: relative;
		display: grid;
		width: 2.75rem;
		height: 2.75rem;
		place-items: center;
		border: 4px solid var(--terminal-ink);
		border-radius: 50%;
	}

	.signboard-roundel::before {
		content: "";
		position: absolute;
		left: -0.75rem;
		right: -0.75rem;
		height: 0.65rem;
		background: var(--terminal-ink);
	}

	.signboard-roundel span {
		position: relative;
		z-index: 1;
		width: 0.55rem;
		height: 0.55rem;
		background: var(--terminal-paper);
		border-radius: 50%;
	}

	.station-title { display: flex; min-width: 0; flex-direction: column; }
	.station-title strong { font-size: 1.05rem; letter-spacing: 0.08em; }
	.station-title small,
	.current-station small {
		color: var(--terminal-muted);
		font: 650 0.58rem/1.3 ui-monospace, SFMono-Regular, Menlo, monospace;
		letter-spacing: 0.13em;
	}

	.current-station {
		display: flex;
		flex-direction: column;
		align-items: flex-end;
	}

	.current-station strong {
		font: 760 0.72rem/1.5 ui-monospace, SFMono-Regular, Menlo, monospace;
	}

	.desktop-route-map {
		display: grid;
		grid-template-rows: repeat(var(--route-count), minmax(5.8rem, auto));
		padding: 0.4rem 1rem 0.7rem;
		background: var(--terminal-paper);
	}

	.route-row {
		position: relative;
		display: grid;
		grid-template-columns: 3.3rem minmax(0, 1fr);
		align-items: center;
		min-height: 0;
	}

	.route-row:not(:last-child)::after {
		content: "";
		position: absolute;
			right: 0.55rem;
			bottom: -0.15rem;
			width: 1.6rem;
			height: 1.65rem;
		border-right: 3px solid var(--terminal-ink);
		border-bottom: 3px solid var(--terminal-ink);
		border-radius: 0 0 1.25rem 0;
	}

	.route-row.reverse:not(:last-child)::after {
		left: 3.5rem;
		right: auto;
		border-right: 0;
		border-left: 3px solid var(--terminal-ink);
		border-radius: 0 0 0 1.25rem;
	}

	.route-code {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		width: 2.15rem;
		height: 2.15rem;
		color: var(--terminal-inverse);
		background: var(--terminal-ink);
		border-radius: 50%;
		font: 800 0.75rem/1 ui-monospace, SFMono-Regular, Menlo, monospace;
		box-shadow: inset 0 0 0 3px color-mix(in oklab, #ffffff 28%, transparent);
	}

	.route-stations {
		position: relative;
		display: grid;
		grid-template-columns: repeat(8, minmax(0, 1fr));
		align-items: stretch;
		min-width: 0;
	}

	.route-stations::before {
		content: "";
		position: absolute;
		left: 4%;
		right: 4%;
		bottom: 1.12rem;
		border-top: 3px solid var(--terminal-ink);
	}

	.station-button {
		position: relative;
		z-index: 1;
		display: block;
		min-width: 0;
		min-height: 5.3rem;
		padding: 0;
		color: var(--terminal-ink);
		background: transparent;
		border: 0;
		cursor: pointer;
	}

	.station-button:not(:last-child)::after {
		content: "›";
		position: absolute;
		right: -0.42rem;
		bottom: 0.64rem;
		display: grid;
		width: 0.86rem;
		height: 0.86rem;
		place-items: center;
		box-sizing: border-box;
		color: var(--terminal-ink);
		background: var(--terminal-paper);
		border: 1.5px solid var(--terminal-ink);
		border-radius: 50%;
		font: 900 0.67rem/1 ui-monospace, SFMono-Regular, Menlo, monospace;
	}

	.route-row.reverse .station-button:first-child::after { content: none; }

	.route-row.reverse .station-button:not(:first-child)::after {
		content: "‹";
		left: -0.42rem;
		right: auto;
	}

	.station-button.dimmed { opacity: 0.13; cursor: default; }

	.station-marker {
		position: relative;
		display: inline-flex;
		width: 1.25rem;
		height: 1.25rem;
		box-sizing: border-box;
		background: var(--terminal-paper);
		border: 2px solid var(--terminal-ink);
		transition: transform 180ms ease, border-width 180ms ease, background-color 180ms ease;
	}

	.marker-circle { border-radius: 50%; }
	.marker-square { border-radius: 0.15rem; }
	.marker-diamond { transform: rotate(45deg) scale(0.78); }
	.marker-orbit {
		border-radius: 50%;
		box-shadow: 0 0 0 3px var(--terminal-paper), 0 0 0 5px var(--terminal-ink);
	}

	.station-button .station-marker {
		position: absolute;
		left: 50%;
		bottom: 0.5rem;
		transform: translateX(-50%);
	}

	.station-button .marker-diamond {
		transform: translateX(-50%) rotate(45deg) scale(0.78);
	}

	.station-button:hover:not(:disabled) .station-marker,
	.station-button:focus-visible .station-marker,
	.station-button.selected .station-marker {
		border-width: 4px;
		background: var(--terminal-ink);
		transform: translateX(-50%) scale(1.22);
	}

	.mobile-station-list button:hover .station-marker,
	.mobile-station-list button.selected .station-marker {
		border-width: 4px;
		background: var(--terminal-ink);
		transform: scale(1.22);
	}

	.station-button:hover:not(:disabled) .marker-diamond,
	.station-button.selected .marker-diamond { transform: translateX(-50%) rotate(45deg) scale(1); }

	.mobile-station-list button:hover .marker-diamond,
	.mobile-station-list button.selected .marker-diamond { transform: rotate(45deg) scale(1); }

	.station-name {
		position: absolute;
		left: 50%;
		bottom: 1.9rem;
		display: block;
		width: 5.25rem;
		overflow: hidden;
		transform: rotate(-38deg);
		transform-origin: left bottom;
		font-size: clamp(0.58rem, 0.8vw, 0.7rem);
		font-weight: 680;
		line-height: 1.15;
		text-align: left;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.mobile-route-map { display: none; }

	.terminal-empty {
		position: absolute;
		z-index: 4;
		top: 50%;
		left: 50%;
		display: flex;
		min-width: 15rem;
		align-items: center;
		flex-direction: column;
		gap: 0.25rem;
		padding: 1.25rem;
		transform: translate(-50%, -50%);
		background: var(--terminal-paper);
		border: 1.5px solid var(--terminal-ink);
		box-shadow: 0.4rem 0.4rem 0 color-mix(in oklab, var(--terminal-ink) 12%, transparent);
	}

	.terminal-empty span { color: var(--terminal-muted); font-size: 0.75rem; }

	.platform-shell {
		position: relative;
		overflow: hidden;
		background: var(--terminal-paper);
		scroll-margin-block: 1rem;
	}

	.station-service {
		-webkit-appearance: none !important;
		appearance: none !important;
		display: inline-flex;
		min-height: 2.65rem;
		align-items: center;
		gap: 0.4rem;
		padding: 0 0.75rem;
		color: var(--terminal-ink) !important;
		-webkit-text-fill-color: currentColor;
		background: var(--terminal-solid-paper) !important;
		border: 1px solid var(--terminal-ink) !important;
		border-radius: 0.25rem;
		font-size: 0.72rem;
		font-weight: 700;
		cursor: pointer;
		transition: color 180ms ease, background-color 180ms ease, border-color 180ms ease;
	}

	.station-service :global(svg) { color: inherit; stroke: currentColor; }
	.station-service span { color: inherit; }

	.station-service:hover {
		color: var(--terminal-solid-paper) !important;
		-webkit-text-fill-color: currentColor;
		background: var(--terminal-ink) !important;
	}

	.platform-scene-wrap {
		position: relative;
		overflow: hidden;
		background: var(--terminal-paper);
		isolation: isolate;
	}

	.routes-dialog-header button {
		display: inline-flex;
		min-height: 2.75rem;
		align-items: center;
		justify-content: center;
		gap: 0.45rem;
		padding: 0 0.7rem;
		color: var(--terminal-ink);
		background: transparent;
		border: 0;
		font-size: 0.72rem;
		font-weight: 750;
		cursor: pointer;
		transition: color 180ms ease, background-color 180ms ease;
	}

	.scene-canvas-layer {
		position: relative;
		z-index: 1;
		margin-top: -0.15rem;
	}

	.cabin-info {
		position: absolute;
		z-index: 5;
		bottom: 11%;
		left: 50%;
		display: grid;
		width: min(58%, 43rem);
		box-sizing: border-box;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 1.2rem;
		padding: 1.15rem 1.3rem;
		color: var(--terminal-ink);
		background: color-mix(in oklab, var(--terminal-solid-paper) 96%, transparent);
		border: 2px solid var(--terminal-ink);
		box-shadow:
			0.35rem 0.45rem 0 var(--terminal-ink),
			inset 0 0 0 1px color-mix(in oklab, var(--terminal-ink) 16%, transparent);
		opacity: 0;
		pointer-events: none;
		transform: translateX(-50%) perspective(55rem) rotateY(-5deg) scale(0.9);
		transform-origin: center;
		transition: opacity 140ms ease, transform 140ms cubic-bezier(0.2, 0.8, 0.2, 1);
	}

	.cabin-info::before,
	.cabin-info::after {
		content: "";
		position: absolute;
		top: 0.4rem;
		bottom: 0.4rem;
		width: 0.35rem;
		background: repeating-linear-gradient(180deg, var(--terminal-ink) 0 0.35rem, transparent 0.35rem 0.7rem);
	}

	.cabin-info::before { left: 0.35rem; }
	.cabin-info::after { right: 0.35rem; }

	.cabin-info.revealed {
		opacity: 1;
		transform: translateX(-50%) perspective(55rem) rotateY(-5deg) scale(1);
	}

	.cabin-info.interactive { pointer-events: auto; }

	.arrival-close {
		position: absolute;
		top: 0.65rem;
		right: 0.75rem;
		display: inline-flex;
		width: 2.35rem;
		height: 2.35rem;
		align-items: center;
		justify-content: center;
		padding: 0;
		color: var(--terminal-ink);
		background: var(--terminal-solid-paper);
		border: 1.5px solid var(--terminal-ink);
		border-radius: 0.2rem;
		cursor: pointer;
		transition: color 180ms ease, background-color 180ms ease;
	}

	.arrival-close:hover {
		color: var(--terminal-solid-paper);
		background: var(--terminal-ink);
	}

	.arrival-close:focus-visible {
		outline: 3px solid var(--terminal-ink);
		outline-offset: 3px;
	}

	.platform-doorway {
		position: relative;
		min-height: 22rem;
		overflow: hidden;
		background:
			linear-gradient(90deg, transparent 49.85%, color-mix(in oklab, var(--terminal-ink) 28%, transparent) 49.85% 50.15%, transparent 50.15%),
			color-mix(in oklab, var(--terminal-paper) 92%, var(--terminal-muted));
		border-top: 1px solid var(--terminal-ink);
		border-bottom: 1px solid var(--terminal-ink);
		box-shadow:
			inset 1.1rem 0 1.5rem -1.25rem var(--terminal-ink),
			inset -1.1rem 0 1.5rem -1.25rem var(--terminal-ink),
			inset 0 0.65rem 0.85rem -0.75rem var(--terminal-ink);
	}

	.door-top-rail {
		position: absolute;
		z-index: 8;
		top: 0;
		left: 0;
		right: 0;
		display: flex;
		min-height: 2.1rem;
		align-items: center;
		justify-content: space-between;
		padding: 0 1rem;
		color: var(--terminal-ink);
		background: var(--terminal-paper);
		border-bottom: 2px solid var(--terminal-ink);
		font: 700 0.55rem/1 ui-monospace, SFMono-Regular, Menlo, monospace;
		letter-spacing: 0.1em;
	}

	.arrival-train {
		position: absolute;
		z-index: 1;
		inset: 2.1rem 0 0;
		background: color-mix(in oklab, var(--terminal-paper) 80%, var(--terminal-muted));
		border-top: 0.8rem solid var(--terminal-ink);
		border-bottom: 0.8rem solid var(--terminal-ink);
		transform: translateX(112%);
	}

	.platform-shell[data-phase="arriving"] .arrival-train { animation: train-arrive 950ms cubic-bezier(0.18, 0.72, 0.22, 1) both; }
	.platform-shell[data-phase="opening"] .arrival-train,
	.platform-shell[data-phase="open"] .arrival-train { transform: translateX(0); opacity: 0; transition: opacity 220ms ease; }

	.train-window-row {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 2.25rem;
		padding: 2.6rem 2rem 0;
	}

	.train-window-row span { height: 8.5rem; border: 2px solid var(--terminal-ink); border-radius: 0.75rem 0.75rem 0.2rem 0.2rem; }
	.train-stripe { position: absolute; left: 0; right: 0; bottom: 3.5rem; height: 0.65rem; background: var(--terminal-ink); }
	.train-door-seam { position: absolute; top: 0; bottom: 0; left: 50%; border-left: 2px solid var(--terminal-ink); }

	.train-interior {
		position: absolute;
		z-index: 2;
		inset: 2.1rem 0 0;
		display: grid;
		grid-template-columns: auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 1.4rem;
		padding: 3.6rem 3rem 2.1rem;
		background:
			linear-gradient(180deg, transparent 0 74%, color-mix(in oklab, var(--terminal-ink) 7%, transparent) 74%),
			var(--terminal-paper);
		opacity: 0;
		transform: scale(0.98);
		transition: opacity 260ms ease 160ms, transform 260ms ease 160ms;
	}

	.train-interior.revealed { opacity: 1; transform: scale(1); }

	.carriage-fixtures {
		position: absolute;
		top: 0;
		left: 10%;
		right: 10%;
		display: flex;
		justify-content: space-around;
		border-top: 2px solid var(--terminal-ink);
	}

	.carriage-fixtures span { width: 1rem; height: 1.45rem; margin-top: 0.7rem; border: 1.5px solid var(--terminal-ink); border-radius: 50%; }
	.carriage-fixtures span::before { content: ""; display: block; width: 0; height: 0.75rem; margin: -0.75rem auto 0; border-left: 1.5px solid var(--terminal-ink); }

	.arrival-avatar {
		display: grid;
		width: 6.5rem;
		height: 6.5rem;
		place-items: center;
		overflow: hidden;
		background: var(--terminal-page);
		border: 2px solid var(--terminal-ink);
		border-radius: 50%;
		box-shadow: 0.35rem 0.35rem 0 color-mix(in oklab, var(--terminal-ink) 14%, transparent);
	}

	.arrival-avatar img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		filter: grayscale(1) contrast(1.08);
		transition: filter 260ms ease;
	}

	.cabin-info:hover .arrival-avatar img,
	.cabin-info:focus-within .arrival-avatar img {
		filter: grayscale(0) contrast(1);
	}
	.arrival-avatar > span { font-size: 2rem; font-weight: 850; }
	.arrival-copy { min-width: 0; }
	.arrival-copy p { margin: 0 0 0.55rem; color: var(--terminal-muted); font: 700 0.58rem/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.12em; }
	.arrival-copy h2 { margin: 0; font-size: clamp(1.35rem, 3vw, 2rem); line-height: 1.15; letter-spacing: -0.03em; }
	.arrival-description { max-width: 48rem; margin-top: 0.8rem; color: var(--terminal-muted); font-size: 0.88rem; line-height: 1.65; }
	.arrival-tags { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-top: 0.65rem; }
	.arrival-tags span { padding: 0.22rem 0.5rem; border: 1px solid var(--terminal-ink); border-radius: 999px; font: 650 0.64rem/1.2 ui-monospace, SFMono-Regular, Menlo, monospace; }

	.arrival-visit {
		display: inline-flex;
		min-width: 8.5rem;
		min-height: 3rem;
		align-items: center;
		justify-content: center;
		gap: 0.5rem;
		padding: 0 1rem;
		color: var(--terminal-inverse);
		background: var(--terminal-ink);
		border: 1.5px solid var(--terminal-ink);
		border-radius: 999px;
		font-size: 0.82rem;
		font-weight: 750;
		text-decoration: none;
		transition: color 180ms ease, background-color 180ms ease, transform 180ms ease;
	}

	.arrival-visit:hover { color: var(--terminal-ink); background: var(--terminal-inverse); transform: translateY(-2px); }

	.empty-platform {
		position: absolute;
		z-index: 2;
		inset: 2.1rem 0 0;
		display: flex;
		align-items: center;
		justify-content: center;
		flex-direction: column;
		gap: 0.45rem;
		color: var(--terminal-muted);
	}

	.empty-platform strong { color: var(--terminal-ink); font: 800 0.72rem/1 ui-monospace, SFMono-Regular, Menlo, monospace; letter-spacing: 0.14em; }
	.empty-platform span { font-size: 0.75rem; }

	.screen-door {
		position: absolute;
		z-index: 6;
		top: 2.1rem;
		bottom: 0;
		width: 50%;
		box-sizing: border-box;
		background:
			linear-gradient(90deg, color-mix(in oklab, var(--terminal-ink) 5%, transparent), transparent 18% 82%, color-mix(in oklab, var(--terminal-ink) 5%, transparent)),
			color-mix(in oklab, var(--terminal-paper) 78%, transparent);
		border: 3px solid var(--terminal-ink);
		box-shadow: inset 0 0 0 1px color-mix(in oklab, #ffffff 45%, transparent);
		transition: transform 520ms cubic-bezier(0.65, 0, 0.35, 1);
	}

	.screen-door::before {
		content: "";
		position: absolute;
		inset: 2rem 1.1rem 2.4rem;
		background: color-mix(in oklab, var(--terminal-accent) 4%, transparent);
		border: 2px solid var(--terminal-ink);
	}

	.screen-door::after {
		content: "←  ←  ←";
		position: absolute;
		left: 1.1rem;
		right: 1.1rem;
		top: 50%;
		padding: 0.35rem;
		color: #ffffff;
		background: var(--terminal-ink);
		font: 800 0.72rem/1 ui-monospace, SFMono-Regular, Menlo, monospace;
		letter-spacing: 0.55em;
		text-align: center;
	}

	.screen-door > span { position: absolute; z-index: 1; top: 0.5rem; color: var(--terminal-muted); font: 800 0.58rem/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
	.screen-door-left { left: 0; border-left-width: 0; }
	.screen-door-left > span { right: 0.65rem; }
	.screen-door-right { right: 0; border-right-width: 0; }
	.screen-door-right > span { left: 0.65rem; }
	.screen-door-right::after { content: "→  →  →"; }

	.platform-shell[data-phase="opening"] .screen-door-left,
	.platform-shell[data-phase="open"] .screen-door-left { transform: translateX(-86%); }
	.platform-shell[data-phase="opening"] .screen-door-right,
	.platform-shell[data-phase="open"] .screen-door-right { transform: translateX(86%); }

	.platform-edge {
		position: relative;
		display: grid;
		min-height: 5.6rem;
		align-content: start;
		gap: 0.45rem;
		padding-top: 0.55rem;
		background:
			linear-gradient(105deg, transparent 0 15%, color-mix(in oklab, var(--terminal-ink) 8%, transparent) 15.2% 15.45%, transparent 15.7% 84.3%, color-mix(in oklab, var(--terminal-ink) 8%, transparent) 84.55% 84.8%, transparent 85%),
			linear-gradient(180deg, color-mix(in oklab, var(--terminal-ink) 9%, var(--terminal-paper)), var(--terminal-paper));
		border-top: 3px solid var(--terminal-ink);
		box-shadow: inset 0 0.6rem 0.8rem -0.8rem var(--terminal-ink);
		perspective: 28rem;
	}

	.safety-line { height: 0.36rem; background: var(--terminal-ink); }
	.tactile-paving { height: 0.6rem; background: radial-gradient(circle, var(--terminal-ink) 1.5px, transparent 1.8px) 0 0 / 0.85rem 0.6rem; opacity: 0.55; }

	.floor-warning {
		position: absolute;
		left: 50%;
		bottom: 0.45rem;
		min-width: 13rem;
		padding: 0.36rem 0.8rem;
		transform: translateX(-50%) rotateX(56deg);
		transform-origin: center bottom;
		color: var(--terminal-ink);
		background: var(--terminal-paper);
		border: 2px solid var(--terminal-ink);
		box-shadow: 0 0.3rem 0 var(--terminal-ink);
		font: 800 0.58rem/1 ui-monospace, SFMono-Regular, Menlo, monospace;
		letter-spacing: 0.09em;
		text-align: center;
		white-space: nowrap;
	}

	@keyframes train-arrive {
		0% { transform: translateX(112%); filter: blur(1.5px); }
		72% { transform: translateX(-2%); filter: blur(0); }
		100% { transform: translateX(0); filter: blur(0); }
	}

	.terminal-directory {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 0.75rem;
		padding: 0.35rem 0 0.75rem;
	}

	.directory-ticket {
		display: grid;
		grid-template-columns: auto auto minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.75rem;
		min-height: 5rem;
		padding: 0.75rem 0.9rem;
		color: var(--terminal-ink);
		background: var(--terminal-paper);
		border: 1.5px solid var(--terminal-line);
		border-radius: 0.45rem;
		cursor: pointer;
		text-align: left;
		transition: border-color 180ms ease, transform 180ms ease, box-shadow 180ms ease;
	}

	.directory-ticket:hover { border-color: var(--terminal-ink); box-shadow: 0.32rem 0.32rem 0 color-mix(in oklab, var(--terminal-ink) 12%, transparent); transform: translateY(-2px); }
	.ticket-index { color: var(--terminal-muted); font: 700 0.68rem/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
	.ticket-copy { display: flex; min-width: 0; flex-direction: column; gap: 0.15rem; }
	.ticket-copy strong,
	.ticket-copy small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
	.ticket-copy strong { font-size: 0.9rem; }
	.ticket-copy small { color: var(--terminal-muted); font-size: 0.72rem; }
	.directory-empty { grid-column: 1 / -1; padding: 3rem 1rem; color: var(--terminal-muted); border: 1.5px dashed var(--terminal-line); text-align: center; }

	.routes-dialog {
		position: fixed;
		top: 50%;
		left: 50%;
		width: min(70rem, calc(100vw - 2rem));
		max-width: none;
		max-height: min(48rem, calc(100vh - 2rem));
		margin: 0;
		padding: 0;
		color: var(--terminal-ink);
		background: transparent;
		border: 0;
		overflow: visible;
		transform: translate(-50%, -50%);
	}

	.routes-dialog::backdrop { background: color-mix(in oklab, #000000 58%, transparent); backdrop-filter: blur(3px); }

	.routes-dialog-panel {
		display: grid;
		max-height: min(48rem, calc(100vh - 2rem));
		grid-template-rows: auto auto minmax(0, 1fr);
		overflow: hidden;
		background: var(--terminal-solid-paper);
		border: 2px solid var(--terminal-ink);
		border-radius: 0.45rem;
		box-shadow: 0.65rem 0.75rem 0 color-mix(in oklab, var(--terminal-ink) 28%, transparent);
	}

	.routes-dialog-header {
		display: flex;
		min-height: 4.4rem;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.65rem 1rem 0.65rem 1.25rem;
		border-bottom: 1px solid var(--terminal-line);
	}

	.routes-dialog-header h2 { margin: 0.12rem 0 0; font-size: 1.05rem; letter-spacing: 0; }
	.routes-dialog-header small { color: var(--terminal-muted); font: 700 0.57rem/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
	.routes-dialog-header button { width: 2.75rem; padding: 0; border: 1px solid var(--terminal-line); }
	.routes-dialog-header button:hover { color: var(--terminal-inverse); background: var(--terminal-ink); border-color: var(--terminal-ink); }

	.routes-dialog-tabs {
		display: flex;
		align-items: center;
		gap: 0.35rem;
		overflow-x: auto;
		padding: 0.55rem 0.75rem;
		background: color-mix(in oklab, var(--terminal-paper) 94%, var(--terminal-line));
		border-bottom: 1px solid var(--terminal-line);
	}

	.routes-dialog-tabs button {
		min-height: 2.45rem;
		flex: 0 0 auto;
		padding: 0 0.85rem;
		color: var(--terminal-muted);
		background: transparent;
		border: 1px solid transparent;
		border-radius: 999px;
		font-size: 0.75rem;
		font-weight: 750;
		cursor: pointer;
	}

	.routes-dialog-tabs button:hover,
	.routes-dialog-tabs button.active {
		color: #ffffff;
		background: #a51f45;
		border-color: #a51f45;
	}

	.routes-dialog-map {
		display: grid;
		overflow: auto;
		padding: 0.7rem 1rem 1rem;
		background: var(--terminal-paper);
	}

	.routes-dialog-map .route-row {
		--dialog-route-color: #a51f45;
		--route-axis: 1.54rem;
		grid-template-columns: 3.8rem minmax(0, 1fr);
		min-height: 7rem;
	}

	.routes-dialog-map .route-row:not(:last-child)::after { display: none; }

	.routes-dialog-map .route-code {
		width: 2.65rem;
		height: 2.65rem;
		color: #ffffff;
		background: var(--dialog-route-color);
		border: 0;
		box-shadow: none;
		cursor: pointer;
		transition: box-shadow 180ms ease, transform 180ms ease;
	}

	.routes-dialog-map .route-code:hover,
	.routes-dialog-map .route-code:focus-visible,
	.routes-dialog-map .route-code[aria-pressed="true"] {
		box-shadow: 0 0 0 0.24rem var(--terminal-solid-paper), 0 0 0 0.42rem var(--dialog-route-color);
		transform: scale(1.05);
	}

	.routes-dialog-map .route-stations::before {
		left: 3%;
		right: 3%;
		bottom: calc(var(--route-axis) - 0.36rem);
		height: 0.72rem;
		background: var(--dialog-route-color);
		border: 0;
	}

	.routes-dialog-map .station-button:not(:last-child)::after {
		bottom: var(--route-axis);
		width: 0.9rem;
		height: 0.9rem;
		box-sizing: border-box;
		color: #ffffff;
		background: var(--dialog-route-color);
		border: 0.16rem solid var(--terminal-solid-paper);
		font-size: 0.58rem;
		transform: translateY(50%);
	}

	.routes-dialog-map .station-marker,
	.routes-dialog-map .marker-square,
	.routes-dialog-map .marker-diamond,
	.routes-dialog-map .marker-orbit {
		width: 1.55rem;
		height: 1.55rem;
		background: var(--terminal-solid-paper);
		border: 0.32rem solid var(--dialog-route-color);
		border-radius: 50%;
		box-shadow: none;
		transform: translate(-50%, 50%);
	}

	.routes-dialog-map .station-button .station-marker { bottom: var(--route-axis); }

	.routes-dialog-map .station-button:hover:not(:disabled) .station-marker,
	.routes-dialog-map .station-button:focus-visible .station-marker,
	.routes-dialog-map .station-button.selected .station-marker {
		background: var(--dialog-route-color);
		border-color: var(--dialog-route-color);
		box-shadow: inset 0 0 0 0.28rem var(--terminal-solid-paper), 0 0 0 0.18rem var(--dialog-route-color);
		transform: translate(-50%, 50%) scale(1.12);
	}

	.routes-dialog-map .station-button.dimmed { opacity: 0.16; }

	@media (max-width: 980px) {
		.terminal-toolbar { grid-template-columns: 1fr auto; }
		.terminal-filters { grid-column: 1 / -1; grid-row: 2; justify-self: start; flex-wrap: wrap; }
		.terminal-view-switch { grid-column: 2; grid-row: 1; }
		.cabin-info { width: min(66%, 38rem); grid-template-columns: auto minmax(0, 1fr); }
		.arrival-visit { grid-column: 1 / -1; justify-self: stretch; }
	}

	@media (max-width: 760px) {
		.terminal-toolbar { grid-template-columns: 1fr auto; gap: 0.55rem; }
		.terminal-search { min-height: 3rem; }
		.terminal-filters { width: 100%; box-sizing: border-box; }
		.terminal-filters button,
		.terminal-view-switch button { min-height: 2.75rem; }
		.terminal-filters button { flex: 1 1 auto; }
		.status-hint { display: none; }

		.routes-dialog { width: calc(100vw - 1rem); }
		.routes-dialog-map { padding-inline: 0.6rem; }
		.routes-dialog-map .route-row { min-width: 43rem; }

		.mobile-route-nav {
			display: grid;
			grid-template-columns: auto 1fr auto auto;
			align-items: center;
			gap: 0.45rem;
			margin-bottom: 1rem;
			padding-bottom: 0.8rem;
			border-bottom: 3px solid var(--terminal-ink);
		}

		.mobile-route-nav button { width: 2.75rem; height: 2.75rem; padding: 0; border: 1px solid var(--terminal-line); }
		.mobile-route-nav button:last-child { grid-column: 4; }
		.mobile-route-nav button:disabled { opacity: 0.35; cursor: not-allowed; }
		.mobile-route-nav strong { font: 800 0.82rem/1 ui-monospace, SFMono-Regular, Menlo, monospace; }
		.mobile-route-nav span { color: var(--terminal-muted); font: 600 0.68rem/1 ui-monospace, SFMono-Regular, Menlo, monospace; }

		.mobile-station-list { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0.7rem; }
		.mobile-station-list button {
			display: grid;
			grid-template-columns: auto minmax(0, 1fr);
			align-items: center;
			gap: 0.55rem;
			min-height: 4rem;
			padding: 0.55rem 0.65rem;
			color: var(--terminal-ink);
			background: var(--terminal-paper);
			border: 1.5px solid var(--terminal-line);
			border-radius: 0.35rem;
			font-size: 0.78rem;
			font-weight: 680;
			line-height: 1.25;
			text-align: left;
			cursor: pointer;
		}
		.mobile-station-list button:hover,
		.mobile-station-list button.selected { border-color: var(--terminal-ink); }

		.platform-doorway { min-height: 29rem; }
		.door-top-rail span:last-child { display: none; }
		.scene-canvas-layer { margin-top: 0; }
		.cabin-info { bottom: 8%; width: min(76%, 29rem); grid-template-columns: 1fr; align-content: center; justify-items: center; gap: 0.65rem; padding: 1rem; text-align: center; transform: translateX(-50%) perspective(40rem) rotateY(-3deg) scale(0.9); }
		.cabin-info.revealed { transform: translateX(-50%) perspective(40rem) rotateY(-3deg) scale(1); }
		.carriage-fixtures { left: 5%; right: 5%; }
		.arrival-avatar { width: 5.4rem; height: 5.4rem; }
		.arrival-copy h2 { font-size: 1.35rem; }
		.arrival-tags { justify-content: center; }
		.arrival-description { display: -webkit-box; overflow: hidden; -webkit-box-orient: vertical; -webkit-line-clamp: 3; line-clamp: 3; }
		.arrival-visit { width: 100%; box-sizing: border-box; }
		.screen-door::before { inset-inline: 0.55rem; }
		.screen-door::after { left: 0.55rem; right: 0.55rem; letter-spacing: 0.15em; }
		.platform-shell[data-phase="opening"] .screen-door-left,
		.platform-shell[data-phase="open"] .screen-door-left { transform: translateX(-92%); }
		.platform-shell[data-phase="opening"] .screen-door-right,
		.platform-shell[data-phase="open"] .screen-door-right { transform: translateX(92%); }
		.terminal-directory { grid-template-columns: 1fr; }
		.directory-ticket { min-height: 5.5rem; }
	}

	@media (max-width: 430px) {
		.terminal-search input { font-size: 1rem; }
		.platform-doorway { min-height: 31rem; }
	}

	@media (prefers-reduced-motion: reduce) {
		.friend-terminal *,
		.friend-terminal *::before,
		.friend-terminal *::after {
			scroll-behavior: auto !important;
			animation-duration: 0.01ms !important;
			animation-iteration-count: 1 !important;
			transition-duration: 0.01ms !important;
		}
	}
</style>
