<script lang="ts">
import { onMount, tick } from "svelte";
import Icon from "@/components/common/Icon.svelte";
import { siteConfig } from "@/config";
import { aiSearchPublicConfig } from "@/config/aiSearchConfig";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import "@/styles/components/ai-search.css";
import { AiSearchClientError, streamAiSearch } from "./api-client";
import { isSafeUrl, renderSimpleMarkdown } from "./markdown";
import {
	type AiSearchMessage,
	type AiSearchSessionMeta,
	clearStoredSessions,
	deleteStoredSession,
	generateSessionId,
	loadSessionList,
	loadSessionMessages,
	saveSession,
	saveSessionList,
} from "./session-store";

const SUGGESTIONS = [
	i18n(I18nKey.aiSuggestionBlog),
	i18n(I18nKey.aiSuggestionIntro),
];
const FOLLOW_UP_SUGGESTIONS = [
	i18n(I18nKey.aiFollowUpPosts),
	i18n(I18nKey.aiFollowUpProjects),
];

let isOpen = $state(false);
let inputVal = $state("");
let messages = $state<AiSearchMessage[]>([]);
let isLoading = $state(false);
let messagesEl: HTMLDivElement;
let inputEl: HTMLTextAreaElement;
let abortCtrl: AbortController | null = null;
let sessionId = $state("");
let sessionList = $state<AiSearchSessionMeta[]>([]);
let showSessionList = $state(false);
let scrollFrame: number | null = null;

const TEXTAREA_MIN_HEIGHT = 128;
const TEXTAREA_MAX_HEIGHT = 256;

function startResize(e: MouseEvent | TouchEvent) {
	e.preventDefault();
	const startY = "touches" in e ? e.touches[0].clientY : e.clientY;
	const startHeight = inputEl.offsetHeight;

	function onMove(ev: MouseEvent | TouchEvent) {
		const currentY = "touches" in ev ? ev.touches[0].clientY : ev.clientY;
		// 往上拖 = 增高，往下拖 = 缩短
		const newHeight = Math.max(
			TEXTAREA_MIN_HEIGHT,
			Math.min(TEXTAREA_MAX_HEIGHT, startHeight - (currentY - startY)),
		);
		inputEl.style.height = `${newHeight}px`;
	}

	function onEnd() {
		document.removeEventListener("mousemove", onMove);
		document.removeEventListener("mouseup", onEnd);
		document.removeEventListener("touchmove", onMove);
		document.removeEventListener("touchend", onEnd);
	}

	document.addEventListener("mousemove", onMove);
	document.addEventListener("mouseup", onEnd);
	document.addEventListener("touchmove", onMove);
	document.addEventListener("touchend", onEnd);
}

function saveCurrentSession() {
	sessionList = saveSession(sessionId, messages, sessionList);
}

function deleteSession(id: string) {
	deleteStoredSession(id);
	sessionList = sessionList.filter((s) => s.id !== id);
	saveSessionList(sessionList);
	if (id === sessionId) {
		sessionId = generateSessionId();
		messages = [];
		showSessionList = false;
		scrollToBottom();
	}
}

function startNewSession() {
	saveCurrentSession();
	sessionId = generateSessionId();
	messages = [];
	showSessionList = false;
}

function clearAllSessions() {
	stop();
	clearStoredSessions();
	sessionList = [];
	sessionId = generateSessionId();
	messages = [];
	showSessionList = false;
}

function switchSession(id: string) {
	if (id === sessionId) {
		showSessionList = false;
		return;
	}
	saveCurrentSession();
	sessionId = id;
	messages = loadSessionMessages(id);
	showSessionList = false;
	scrollToBottom();
}

function formatTime(ts: number): string {
	const diff = Date.now() - ts;
	if (diff < 60000) return i18n(I18nKey.aiJustNow);
	if (diff < 3600000)
		return i18n(I18nKey.aiMinutesAgo).replace(
			"{n}",
			`${Math.floor(diff / 60000)}`,
		);
	if (diff < 86400000)
		return i18n(I18nKey.aiHoursAgo).replace(
			"{n}",
			`${Math.floor(diff / 3600000)}`,
		);
	return i18n(I18nKey.aiDaysAgo).replace(
		"{n}",
		`${Math.floor(diff / 86400000)}`,
	);
}

export function toggle() {
	isOpen = !isOpen;
	window.__aiSearchOpen = isOpen;
	if (isOpen) {
		tick().then(() => {
			inputEl?.focus();
		});
	}
}

function close() {
	isOpen = false;
	window.__aiSearchOpen = false;
}

function scrollToBottom() {
	tick().then(() => {
		if (!messagesEl || scrollFrame !== null) return;
		scrollFrame = requestAnimationFrame(() => {
			scrollFrame = null;
			messagesEl.scrollTo({
				top: messagesEl.scrollHeight,
				left: 0,
				behavior: "auto",
			});
		});
	});
}

async function send(text?: string) {
	const q = (text || inputVal).trim();
	if (!q || isLoading) return;

	const MAX_INPUT_LEN = 1000;
	if (q.length > MAX_INPUT_LEN) {
		messages = [
			...messages,
			{
				role: "assistant",
				content: i18n(I18nKey.aiInputTooLong).replace(
					"{max}",
					`${MAX_INPUT_LEN}`,
				),
			},
		];
		scrollToBottom();
		return;
	}

	inputVal = "";
	messages = [...messages, { role: "user", content: q }];
	scrollToBottom();

	isLoading = true;
	const controller = new AbortController();
	abortCtrl = controller;

	const aiIdx = messages.length;
	messages = [
		...messages,
		{ role: "assistant", content: "", streaming: true, refs: [] },
	];
	scrollToBottom();
	let pendingText = "";
	let pendingRefs: AiSearchMessage["refs"] | null = null;
	let flushTimer: ReturnType<typeof setTimeout> | null = null;
	const flushStreamUpdate = () => {
		if (flushTimer) {
			clearTimeout(flushTimer);
			flushTimer = null;
		}
		if (!pendingText && !pendingRefs) return;
		if (pendingText) {
			messages[aiIdx].content += pendingText;
			pendingText = "";
		}
		if (pendingRefs) {
			messages[aiIdx].refs = pendingRefs;
			pendingRefs = null;
		}
		messages = [...messages];
		scrollToBottom();
	};
	const scheduleStreamUpdate = () => {
		if (!flushTimer) flushTimer = setTimeout(flushStreamUpdate, 80);
	};

	try {
		const history = messages
			.slice(0, -2)
			.slice(-6)
			.map((m) => ({ role: m.role, content: m.content }));
		await streamAiSearch({
			question: q,
			history,
			sessionId,
			signal: controller.signal,
			onEvent(event) {
				if (event.type === "chunk") {
					pendingText += event.text;
					scheduleStreamUpdate();
				} else if (event.type === "refs") {
					pendingRefs = event.articles;
					scheduleStreamUpdate();
				} else if (event.type === "error") {
					pendingText += `\n\n> ${i18n(I18nKey.aiStreamErrorPrefix).replace("{error}", event.error)}`;
					flushStreamUpdate();
				} else {
					flushStreamUpdate();
				}
			},
		});
		flushStreamUpdate();
	} catch (err: unknown) {
		const e = err instanceof Error ? err : new Error(String(err));
		if (e.name === "AbortError") {
			flushStreamUpdate();
			messages[aiIdx].content += `\n\n> *${i18n(I18nKey.aiCancelled)}*`;
		} else {
			if (flushTimer) clearTimeout(flushTimer);
			flushTimer = null;
			pendingText = "";
			pendingRefs = null;
			console.error("AI chat error:", e);
			if (e instanceof AiSearchClientError && e.code === "RATE_LIMITED") {
				messages[aiIdx].content = i18n(I18nKey.aiRateLimited);
			} else {
				messages[aiIdx].content = i18n(I18nKey.aiRequestError);
			}
		}
		messages = [...messages];
	} finally {
		flushStreamUpdate();
		messages[aiIdx].streaming = false;
		messages = [...messages];
		isLoading = false;
		abortCtrl = null;
		scrollToBottom();
		saveCurrentSession();
	}
}

function stop() {
	abortCtrl?.abort();
}

function handleKeydown(e: KeyboardEvent) {
	if (e.key === "Enter" && !e.shiftKey) {
		e.preventDefault();
		send();
	}
	if (e.key === "Escape") {
		if (showSessionList) {
			showSessionList = false;
		} else {
			close();
		}
	}
}

onMount(() => {
	sessionList = loadSessionList();
	if (sessionList.length > 0) {
		const latest = sessionList[0];
		sessionId = latest.id;
		messages = loadSessionMessages(latest.id);
	} else {
		sessionId = generateSessionId();
	}

	const toggleHandler = () => toggle();
	window.addEventListener("toggle-ai-search", toggleHandler);

	return () => {
		saveCurrentSession();
		window.removeEventListener("toggle-ai-search", toggleHandler);
		if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
	};
});
</script>

{#if isOpen}
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="ai-overlay">
		<div class="ai-panel">
			<!-- 标题栏 -->
			<div class="ai-header">
					<div class="ai-header__left">
						<img
							src={siteConfig.defaultOgImage}
						alt={i18n(I18nKey.aiAssistantName)}
						class="ai-header__avatar"
					/>
					<span class="ai-header__name">{i18n(I18nKey.aiAssistantName)}</span>
					<span class="ai-header__model">{aiSearchPublicConfig.modelName}</span>
				</div>
				<div class="ai-header__actions">
					{#if sessionList.length > 0}
						<button
							class="ai-icon-btn"
							class:ai-icon-btn--active={showSessionList}
							onclick={() => (showSessionList = !showSessionList)}
							title={i18n(I18nKey.aiHistory)}
						>
							<Icon icon="material-symbols:history" />
						</button>
					{/if}
					{#if sessionList.length > 0 || messages.length > 0}
						<button class="ai-icon-btn" onclick={clearAllSessions} title={i18n(I18nKey.aiClearAllSessions)}>
							<Icon icon="material-symbols:delete-sweep-outline" />
						</button>
					{/if}
					<button class="ai-icon-btn" onclick={startNewSession} title={i18n(I18nKey.aiNewSession)}>
						<Icon icon="material-symbols:add-circle-outline" />
					</button>
					<button class="ai-icon-btn" onclick={close} title={i18n(I18nKey.close)}>
						<Icon icon="material-symbols:close" />
					</button>
				</div>
			</div>

			<!-- 历史会话列表 -->
			{#if showSessionList}
				<div class="ai-session-list">
					{#each sessionList as sess}
						<button
							class="ai-session-item"
							class:ai-session-item--active={sess.id === sessionId}
							onclick={() => switchSession(sess.id)}
						>
							<div class="ai-session-info">
								<span class="ai-session-title">{sess.title}</span>
								<span class="ai-session-time">{formatTime(sess.updatedAt)}</span>
							</div>
							<span
								class="ai-session-delete"
								onclick={(e) => { e.stopPropagation(); deleteSession(sess.id); }}
								title={i18n(I18nKey.aiDeleteSession)}
							>
								<Icon icon="material-symbols:close" size="sm" />
							</span>
						</button>
					{/each}
					{#if sessionList.length === 0}
						<div class="ai-session-empty">{i18n(I18nKey.aiNoHistory)}</div>
					{/if}
				</div>
			{/if}

			<!-- 消息列表 -->
			<div class="ai-messages" bind:this={messagesEl}>
				{#if messages.length === 0}
					<div class="ai-empty">
						<div class="ai-empty__icon-wrapper">
							<img
								src={siteConfig.defaultOgImage}
								alt={i18n(I18nKey.aiAssistantName)}
								class="ai-empty__avatar"
							/>
						</div>
						<h2 class="ai-empty__title">{i18n(I18nKey.aiEmptyTitle)}</h2>
						<div class="ai-empty__suggestions-box">
							{#each SUGGESTIONS as suggestion}
								<button class="ai-empty__suggestion" onclick={() => send(suggestion)}>
									{suggestion}
								</button>
							{/each}
						</div>
					</div>
				{/if}

				{#each messages as msg, i}
					<div
						class="ai-msg ai-msg--{msg.role}"
						class:ai-msg--turn-start={msg.role === "user" && i > 0}
					>
						{#if msg.role === "assistant"}
							<div class="ai-msg__avatar">
								<img src={siteConfig.defaultOgImage} alt={i18n(I18nKey.aiAssistantName)} class="ai-msg__avatar-img" />
							</div>
						{/if}
						<div class="ai-msg__body">
							<div class="ai-msg__content">
								{#if msg.role === "user"}
									<span class="ai-msg__text">{msg.content}</span>
									<span class="ai-msg__bubble"></span>
									<span class="ai-msg__bubble ai-msg__bubble--small"></span>
								{:else if msg.streaming && !msg.content.trim()}
									<svg class="ai-loader" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
										<path class="ai-loader__line" d="m4.9 4.9 2.9 2.9" />
										<path class="ai-loader__line" d="M2 12h4" />
										<path class="ai-loader__line" d="m4.9 19.1 2.9-2.9" />
										<path class="ai-loader__line" d="M12 18v4" />
										<path class="ai-loader__line" d="m16.2 16.2 2.9 2.9" />
										<path class="ai-loader__line" d="M18 12h4" />
										<path class="ai-loader__line" d="m16.2 7.8 2.9-2.9" />
										<path class="ai-loader__line" d="M12 2v4" />
									</svg>
								{:else if msg.streaming}
									<span class="ai-msg__text ai-msg__text--streaming">{msg.content}</span>
									<span class="ai-cursor"></span>
								{:else}
									<span class="ai-msg__text">{@html renderSimpleMarkdown(msg.content)}</span>
								{/if}
								{#if msg.role === "assistant" && msg.refs && msg.refs.length > 0}
									<div class="ai-refs">
										<div class="ai-refs__title">{i18n(I18nKey.aiRefsTitle)}</div>
										{#each msg.refs as ref}
											<a href={isSafeUrl(ref.path) ? ref.path : '#'} class="ai-refs__link" onclick={() => (isOpen = false)}>
												<Icon icon="material-symbols:article-outline" size="sm" />
												<span>{ref.title}</span>
												{#if ref.published}
													<span class="ai-refs__date">{ref.published}</span>
												{/if}
											</a>
										{/each}
									</div>
								{/if}
							</div>
						</div>
					</div>
				{/each}
			</div>

			<!-- 输入区域 -->
			<div class="ai-input-area">
				<div class="ai-input-area__box">
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="ai-input-area__resize-handle"
						onmousedown={startResize}
						ontouchstart={startResize}
						title={i18n(I18nKey.aiResizeTitle)}
					>
						<span class="ai-input-area__resize-grip"></span>
					</div>
					{#if messages.length > 0 && !isLoading}
						<div class="ai-input-area__tags">
							{#each FOLLOW_UP_SUGGESTIONS as suggestion}
								<button
									class="ai-input-area__tag"
									type="button"
									disabled={isLoading}
									onclick={() => send(suggestion)}
								>
									{suggestion}
								</button>
							{/each}
						</div>
					{/if}
					<label class="ai-input-area__label" for="ai-chat-input">{i18n(I18nKey.aiAskLabel)}</label>
					<div class="ai-input-area__textarea-wrapper">
						<textarea
							id="ai-chat-input"
							bind:this={inputEl}
							bind:value={inputVal}
							onkeydown={handleKeydown}
							placeholder={i18n(I18nKey.aiInputPlaceholder)}
							disabled={isLoading}
							class="ai-input-area__textarea"
							rows="5"
							aria-label={i18n(I18nKey.aiInputAria)}
						></textarea>
						{#if isLoading}
							<button
								type="button"
								class="ai-input-area__submit ai-input-area__submit--stop"
								onclick={stop}
								title={i18n(I18nKey.aiStopGeneration)}
								aria-label={i18n(I18nKey.aiStopGeneration)}
							>
								<Icon icon="material-symbols:stop-circle-outline" size="lg" />
							</button>
						{:else}
							<button
								type="button"
								class="ai-input-area__submit"
								onclick={() => send()}
								disabled={!inputVal.trim()}
								title={i18n(I18nKey.send)}
								aria-label={i18n(I18nKey.send)}
							>
								<Icon icon="material-symbols:arrow-outward-rounded" size="lg" />
							</button>
						{/if}
					</div>
					<p class="ai-input-area__privacy">
						{i18n(I18nKey.aiPrivacyNotice)}
					</p>
				</div>
			</div>
		</div>
	</div>
{/if}
