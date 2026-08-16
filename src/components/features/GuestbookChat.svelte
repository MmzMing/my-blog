<script lang="ts">
import {
	addComment,
	deleteComment,
	getComment,
	login as loginWithWaline,
	updateComment,
} from "@waline/api";
import {
	AlertCircle,
	Bell,
	ChevronDown,
	LoaderCircle,
	RefreshCw,
	RotateCcw,
	Users,
	WifiOff,
	X,
} from "lucide-svelte";
import { onMount, tick } from "svelte";
import { commentConfig } from "@/config/commentConfig";
import { guestbookConfig } from "@/config/guestbookConfig";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import type { GuestbookAnnouncementItem } from "@/types/config";
import type {
	GuestbookAuthUser,
	GuestbookImageAttachment,
	GuestbookChatMessage as GuestbookMessage,
	GuestbookProfile,
} from "@/types/guestbook-chat";
import {
	appendGuestbookImage,
	buildGuestbookEditedMessageBody,
	buildGuestbookMessageBody,
	flattenGuestbookComments,
	getGuestbookErrorMessage,
	getGuestbookInitials,
	getGuestbookTextLength,
	hasGuestbookImage,
	hasGuestbookReplyMarker,
	isGuestbookAuthError,
	mergeGuestbookMessages,
	normalizeGuestbookComment,
} from "@/utils/guestbook-chat";
import GuestbookChatComposer from "./GuestbookChatComposer.svelte";
import GuestbookChatMessage from "./GuestbookChatMessage.svelte";

const CHANNEL_PATH = "/guestbook/";
const PAGE_SIZE = 30;
const POLL_INTERVAL = 30_000;
const MIN_MESSAGE_LENGTH = 2;
const MAX_MESSAGE_LENGTH = 300;
const PROFILE_STORAGE_KEY = "guestbook-chat-profile";
const AUTH_STORAGE_KEY = "guestbook-chat-auth";
const DRAFT_STORAGE_KEY = "guestbook-chat-draft";
const serverURL = commentConfig.waline?.serverURL ?? "";
const lang = commentConfig.waline?.lang ?? "zh-CN";
const loginMode = commentConfig.waline?.login ?? "enable";
const announcements = guestbookConfig.announcements;

let messages = $state<GuestbookMessage[]>([]);
let profile = $state<GuestbookProfile>({ nick: "", mail: "", link: "" });
let authUser = $state<GuestbookAuthUser | null>(null);
let draft = $state("");
let replyTarget = $state<GuestbookMessage | null>(null);
let initialLoading = $state(true);
let initialError = $state("");
let syncError = $state("");
let composerError = $state("");
let loadingOlder = $state(false);
let syncing = $state(false);
let loggingIn = $state(false);
let isOffline = $state(false);
let currentPage = $state(1);
let totalPages = $state(0);
let totalCount = $state(0);
let newMessageCount = $state(0);
let lastSyncedAt = $state<number | null>(null);
let messageList = $state<HTMLDivElement | null>(null);
let announcementDialog = $state<HTMLDialogElement | null>(null);
let deleteDialog = $state<HTMLDialogElement | null>(null);
let selectedAnnouncement = $state<GuestbookAnnouncementItem | null>(null);
let announcementBarVisible = $state(true);
let sidebarOpen = $state(false);
let showScrollToBottom = $state(false);
let editingMessageId = $state<string | null>(null);
let editDraft = $state("");
let mutatingMessageId = $state<string | null>(null);
let messageActionError = $state<{ id: string; message: string } | null>(null);
let deleteTarget = $state<GuestbookMessage | null>(null);
let pollTimer: number | undefined;
let dataController: AbortController | null = null;
let syncQueued = false;
let initialMediaCleanup: (() => void) | null = null;

const hasMore = $derived(currentPage < totalPages);
const isSending = $derived(
	messages.some((message) => message.localState === "sending"),
);
const chatMembers = $derived.by(() => {
	const members = new Map<
		string,
		Pick<GuestbookMessage, "nick" | "avatar" | "link" | "label" | "isAdmin">
	>();
	for (const message of messages) {
		const key = `${message.nick.trim().toLocaleLowerCase()}|${message.avatar}`;
		const current = members.get(key);
		members.set(key, {
			nick: message.nick || current?.nick || i18n(I18nKey.gbAnonymousVisitor),
			avatar: message.avatar || current?.avatar || "",
			link: message.link || current?.link,
			label: message.label || current?.label,
			isAdmin: message.isAdmin || current?.isAdmin || false,
		});
	}
	return [...members.values()].sort(
		(left, right) => Number(right.isAdmin) - Number(left.isAdmin),
	);
});
const stationMembers = $derived(chatMembers.filter((member) => member.isAdmin));
const guestMembers = $derived(chatMembers.filter((member) => !member.isAdmin));

function handleChatKeydown(event: KeyboardEvent) {
	if (event.key !== "Escape") return;
	sidebarOpen = false;
}

function canManageMessage(message: GuestbookMessage): boolean {
	if (!authUser?.token || !message.objectId || message.localState) return false;
	return (
		authUser.type === "administrator" ||
		(typeof message.userId === "number" && message.userId === authUser.objectId)
	);
}

async function openAnnouncement(announcement: GuestbookAnnouncementItem) {
	selectedAnnouncement = announcement;
	await tick();
	if (!announcementDialog?.open) announcementDialog?.showModal();
	document.body.style.overflow = "hidden";
}

function closeAnnouncement() {
	if (announcementDialog?.open) announcementDialog.close();
	document.body.style.overflow = "";
}

function closeDeleteDialog() {
	if (deleteTarget && mutatingMessageId === deleteTarget.id) return;
	if (deleteDialog?.open) deleteDialog.close();
	deleteTarget = null;
	document.body.style.overflow = "";
}

async function requestDeleteMessage(message: GuestbookMessage) {
	if (!canManageMessage(message)) return;
	messageActionError = null;
	deleteTarget = message;
	await tick();
	if (!deleteDialog?.open) deleteDialog?.showModal();
	document.body.style.overflow = "hidden";
}

function readStoredValue<T>(storage: Storage, key: string): T | null {
	try {
		const raw = storage.getItem(key);
		return raw ? (JSON.parse(raw) as T) : null;
	} catch {
		return null;
	}
}

function readStoredString(storage: Storage, key: string): string {
	try {
		return storage.getItem(key) ?? "";
	} catch {
		return "";
	}
}

function writeStoredValue(storage: Storage, key: string, value: unknown) {
	try {
		storage.setItem(key, JSON.stringify(value));
	} catch {
		// Storage can be unavailable in private browsing or restrictive environments.
	}
}

function writeStoredString(storage: Storage, key: string, value: string) {
	try {
		storage.setItem(key, value);
	} catch {
		// Keep the in-memory state when persistence is unavailable.
	}
}

function removeStoredValue(storage: Storage, key: string) {
	try {
		storage.removeItem(key);
	} catch {
		// The in-memory state remains authoritative for the current page.
	}
}

function isAuthUser(value: unknown): value is GuestbookAuthUser {
	if (!value || typeof value !== "object") return false;
	const user = value as Partial<GuestbookAuthUser>;
	return (
		typeof user.display_name === "string" &&
		typeof user.email === "string" &&
		typeof user.token === "string" &&
		user.token.length > 0 &&
		typeof user.objectId === "number" &&
		(user.type === "administrator" || user.type === "guest")
	);
}

function isProfile(value: unknown): value is GuestbookProfile {
	if (!value || typeof value !== "object") return false;
	const storedProfile = value as Partial<GuestbookProfile>;
	return (
		typeof storedProfile.nick === "string" &&
		typeof storedProfile.mail === "string" &&
		typeof storedProfile.link === "string"
	);
}

function readAuthentication(): GuestbookAuthUser | null {
	const sessionUser = readStoredValue<unknown>(
		sessionStorage,
		AUTH_STORAGE_KEY,
	);
	if (isAuthUser(sessionUser)) return sessionUser;
	const persistentUser = readStoredValue<unknown>(
		localStorage,
		AUTH_STORAGE_KEY,
	);
	if (!isAuthUser(persistentUser)) return null;
	if (persistentUser.type === "administrator") {
		removeStoredValue(localStorage, AUTH_STORAGE_KEY);
		writeStoredValue(sessionStorage, AUTH_STORAGE_KEY, persistentUser);
	}
	return persistentUser;
}

function persistAuthentication(user: GuestbookAuthUser) {
	removeStoredValue(localStorage, AUTH_STORAGE_KEY);
	removeStoredValue(sessionStorage, AUTH_STORAGE_KEY);
	const storage =
		user.type === "administrator"
			? sessionStorage
			: user.remember
				? localStorage
				: sessionStorage;
	writeStoredValue(storage, AUTH_STORAGE_KEY, user);
}

function clearAuthentication() {
	authUser = null;
	editingMessageId = null;
	editDraft = "";
	deleteTarget = null;
	messageActionError = null;
	if (deleteDialog?.open) deleteDialog.close();
	removeStoredValue(localStorage, AUTH_STORAGE_KEY);
	removeStoredValue(sessionStorage, AUTH_STORAGE_KEY);
}

interface WalineTokenResponse {
	errno: number;
	errmsg?: string;
	data?: unknown;
}

function removeLoginTokenFromURL() {
	const url = new URL(window.location.href);
	if (!url.searchParams.has("token")) return;
	url.searchParams.delete("token");
	window.history.replaceState(
		window.history.state,
		"",
		`${url.pathname}${url.search}${url.hash}`,
	);
}

async function restoreWalineRedirectLogin(token: string) {
	if (!serverURL) throw new Error(i18n(I18nKey.gbServerNotConfiguredLogin));
	const response = await fetch(
		`${serverURL.replace(/\/+$/u, "")}/api/token?lang=${encodeURIComponent(lang)}`,
		{ headers: { Authorization: `Bearer ${token}` } },
	);
	if (!response.ok) throw new Error(i18n(I18nKey.gbLoginVerifyFailed));

	const result = (await response.json()) as WalineTokenResponse;
	const user =
		result.errno === 0 && result.data && typeof result.data === "object"
			? { ...(result.data as Record<string, unknown>), token, remember: false }
			: null;
	if (!isAuthUser(user)) {
		throw new Error(result.errmsg || i18n(I18nKey.gbLoginExpired));
	}

	authUser = user;
	persistAuthentication(user);
	composerError = "";
}

function finishDataRequest(controller: AbortController) {
	if (dataController !== controller) return;
	dataController = null;
	if (!syncQueued) return;
	syncQueued = false;
	queueMicrotask(() => void syncLatest());
}

function queueLatestSync() {
	if (dataController) {
		syncQueued = true;
		return;
	}
	void syncLatest();
}

function handleAuthenticationError(error: unknown): boolean {
	if (!authUser || !isGuestbookAuthError(error)) return false;
	clearAuthentication();
	composerError = i18n(I18nKey.gbAuthExpired);
	return true;
}

async function fetchPage(page: number, signal?: AbortSignal) {
	if (!serverURL) throw new Error(i18n(I18nKey.gbServerNotConfigured));
	return getComment({
		serverURL,
		lang,
		path: CHANNEL_PATH,
		page,
		pageSize: PAGE_SIZE,
		sortBy: "insertedAt_desc",
		token: authUser?.token,
		signal,
	});
}

async function loadInitial() {
	if (isOffline) {
		initialLoading = false;
		initialError = i18n(I18nKey.gbOfflineInitial);
		return;
	}
	dataController?.abort();
	const controller = new AbortController();
	dataController = controller;
	syncing = false;
	loadingOlder = false;
	initialLoading = true;
	initialError = "";
	syncError = "";

	try {
		const response = await fetchPage(1, controller.signal);
		if (dataController !== controller) return;
		messages = mergeGuestbookMessages(
			messages,
			flattenGuestbookComments(response.data),
		);
		currentPage = 1;
		totalPages = response.totalPages;
		totalCount = response.count;
		lastSyncedAt = Date.now();
		initialLoading = false;
		await tick();
		scrollToBottom(false);
		preserveInitialBottomWhileMediaLoads();
	} catch (error) {
		if (controller.signal.aborted || dataController !== controller) return;
		const authenticationExpired = handleAuthenticationError(error);
		if (authenticationExpired) syncQueued = true;
		const message = getGuestbookErrorMessage(error);
		if (message && !authenticationExpired) {
			if (messages.length > 0) syncError = message;
			else initialError = message;
		}
	} finally {
		if (dataController === controller) {
			initialLoading = false;
			finishDataRequest(controller);
		}
	}
}

async function syncLatest() {
	if (initialError && messages.length === 0) {
		await loadInitial();
		return;
	}
	if (initialLoading || isOffline) return;
	if (dataController) {
		syncQueued = true;
		return;
	}
	const controller = new AbortController();
	dataController = controller;
	syncing = true;
	syncError = "";
	const wasNearBottom = isNearBottom();
	const knownIds = new Set(
		messages
			.filter((message) => !message.localState)
			.map((message) => message.id),
	);

	try {
		const response = await fetchPage(1, controller.signal);
		if (dataController !== controller) return;
		const incoming = flattenGuestbookComments(response.data);
		const freshCount = incoming.filter(
			(message) => !knownIds.has(message.id),
		).length;
		messages = mergeGuestbookMessages(messages, incoming);
		totalPages = response.totalPages;
		totalCount = response.count;
		lastSyncedAt = Date.now();
		await tick();

		if (freshCount > 0 && wasNearBottom) scrollToBottom(true);
		else if (freshCount > 0) newMessageCount += freshCount;
	} catch (error) {
		if (controller.signal.aborted || dataController !== controller) return;
		const authenticationExpired = handleAuthenticationError(error);
		if (authenticationExpired) syncQueued = true;
		const message = getGuestbookErrorMessage(error);
		if (message && !authenticationExpired) syncError = message;
	} finally {
		if (dataController === controller) {
			syncing = false;
			finishDataRequest(controller);
		}
	}
}

async function loadOlder() {
	if (!hasMore || loadingOlder || !messageList || dataController) return;
	const controller = new AbortController();
	dataController = controller;
	loadingOlder = true;
	const previousHeight = messageList.scrollHeight;
	const nextPage = currentPage + 1;

	try {
		const response = await fetchPage(nextPage, controller.signal);
		if (dataController !== controller) return;
		messages = mergeGuestbookMessages(
			messages,
			flattenGuestbookComments(response.data),
		);
		currentPage = nextPage;
		totalPages = response.totalPages;
		totalCount = response.count;
		await tick();
		messageList.scrollTop += messageList.scrollHeight - previousHeight;
	} catch (error) {
		if (controller.signal.aborted || dataController !== controller) return;
		const authenticationExpired = handleAuthenticationError(error);
		if (authenticationExpired) syncQueued = true;
		const message = getGuestbookErrorMessage(error);
		if (message && !authenticationExpired) syncError = message;
	} finally {
		if (dataController === controller) {
			loadingOlder = false;
			finishDataRequest(controller);
		}
	}
}

function startPolling() {
	if (pollTimer) window.clearInterval(pollTimer);
	pollTimer = undefined;
	if (document.visibilityState !== "visible" || !navigator.onLine) return;
	pollTimer = window.setInterval(() => {
		if (document.visibilityState === "visible" && navigator.onLine) {
			void syncLatest();
		}
	}, POLL_INTERVAL);
}

function handleVisibilityChange() {
	if (document.visibilityState === "visible") {
		queueLatestSync();
		startPolling();
		return;
	}
	if (pollTimer) window.clearInterval(pollTimer);
	pollTimer = undefined;
}

function handleOnline() {
	isOffline = false;
	queueLatestSync();
	startPolling();
}

function handleOffline() {
	isOffline = true;
	syncError = i18n(I18nKey.gbNetworkDisconnected);
	if (pollTimer) window.clearInterval(pollTimer);
	pollTimer = undefined;
	dataController?.abort();
}

function isNearBottom(): boolean {
	if (!messageList) return true;
	return (
		messageList.scrollHeight -
			messageList.scrollTop -
			messageList.clientHeight <
		120
	);
}

function scrollToBottom(smooth = true) {
	if (!messageList) return;
	const reduceMotion = window.matchMedia(
		"(prefers-reduced-motion: reduce)",
	).matches;
	messageList.scrollTo({
		top: messageList.scrollHeight,
		behavior: smooth && !reduceMotion ? "smooth" : "auto",
	});
	newMessageCount = 0;
	showScrollToBottom = false;
}

function preserveInitialBottomWhileMediaLoads() {
	initialMediaCleanup?.();
	const list = messageList;
	if (!list) return;

	const listRect = list.getBoundingClientRect();
	const pendingImages = Array.from(
		list.querySelectorAll<HTMLImageElement>(".guestbook-message__body img"),
	).filter((image) => {
		if (image.complete) return false;
		const imageRect = image.getBoundingClientRect();
		return (
			imageRect.bottom >= listRect.top - list.clientHeight &&
			imageRect.top <= listRect.bottom + list.clientHeight
		);
	});
	if (pendingImages.length === 0) return;

	const handlers = new Map<HTMLImageElement, () => void>();
	const cancel = () => cleanup();
	const cleanup = () => {
		for (const [image, handler] of handlers) {
			image.removeEventListener("load", handler);
			image.removeEventListener("error", handler);
		}
		handlers.clear();
		list.removeEventListener("wheel", cancel);
		list.removeEventListener("touchstart", cancel);
		list.removeEventListener("pointerdown", cancel);
		if (initialMediaCleanup === cleanup) initialMediaCleanup = null;
	};

	for (const image of pendingImages) {
		const handler = () => {
			image.removeEventListener("load", handler);
			image.removeEventListener("error", handler);
			handlers.delete(image);
			scrollToBottom(false);
			if (handlers.size === 0) cleanup();
		};
		handlers.set(image, handler);
		image.addEventListener("load", handler, { once: true });
		image.addEventListener("error", handler, { once: true });
	}

	list.addEventListener("wheel", cancel, { passive: true });
	list.addEventListener("touchstart", cancel, { passive: true });
	list.addEventListener("pointerdown", cancel);
	initialMediaCleanup = cleanup;
}

function handleMessageScroll() {
	if (!messageList) return;
	if (messageList.scrollTop < 72 && hasMore) void loadOlder();
	const nearBottom = isNearBottom();
	showScrollToBottom = !nearBottom;
	if (nearBottom) newMessageCount = 0;
}

function formatMessageTime(value: number): string {
	return new Intl.DateTimeFormat("zh-CN", {
		month: "2-digit",
		day: "2-digit",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	}).format(value);
}

function formatSyncStatus(): string {
	if (isOffline) return i18n(I18nKey.gbSyncOffline);
	if (syncing) return i18n(I18nKey.gbSyncSyncing);
	if (syncError) return i18n(I18nKey.gbSyncFailed);
	if (!lastSyncedAt) return i18n(I18nKey.gbSyncWaiting);
	return i18n(I18nKey.gbSyncedAt).replace(
		"{time}",
		new Intl.DateTimeFormat("zh-CN", {
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
			hour12: false,
		}).format(lastSyncedAt),
	);
}

function dateKey(value: number): string {
	return new Intl.DateTimeFormat("zh-CN", {
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(value);
}

function dateLabel(value: number): string {
	const today = new Date();
	const yesterday = new Date(today);
	yesterday.setDate(today.getDate() - 1);
	if (dateKey(value) === dateKey(today.getTime())) return i18n(I18nKey.gbToday);
	if (dateKey(value) === dateKey(yesterday.getTime()))
		return i18n(I18nKey.gbYesterday);
	return dateKey(value);
}

function shouldShowDate(index: number): boolean {
	return (
		index === 0 ||
		dateKey(messages[index - 1].createdAt) !==
			dateKey(messages[index].createdAt)
	);
}

function selectReply(message: GuestbookMessage) {
	if (!message.localState) replyTarget = message;
}

async function jumpToQuotedMessage(message: GuestbookMessage) {
	if (!message.replyToId) return;
	let target = messages.find((candidate) => candidate.id === message.replyToId);

	while (!target && hasMore && !loadingOlder) {
		await loadOlder();
		target = messages.find((candidate) => candidate.id === message.replyToId);
	}

	const element = document.getElementById(
		`guestbook-message-${message.replyToId}`,
	);
	if (!element) return;
	const reduceMotion = window.matchMedia(
		"(prefers-reduced-motion: reduce)",
	).matches;
	element.scrollIntoView({
		behavior: reduceMotion ? "auto" : "smooth",
		block: "center",
	});
	element.classList.remove("is-highlighted");
	requestAnimationFrame(() => element.classList.add("is-highlighted"));
	window.setTimeout(() => element.classList.remove("is-highlighted"), 1600);
}

function validateMessageBody(content: string): string {
	const textLength = getGuestbookTextLength(content);
	if (textLength < MIN_MESSAGE_LENGTH && !hasGuestbookImage(content)) {
		return i18n(I18nKey.gbMsgMinLength).replace(
			"{min}",
			String(MIN_MESSAGE_LENGTH),
		);
	}
	if (textLength > MAX_MESSAGE_LENGTH) {
		return i18n(I18nKey.gbMsgMaxLength).replace(
			"{max}",
			String(MAX_MESSAGE_LENGTH),
		);
	}
	if (hasGuestbookReplyMarker(content)) {
		return i18n(I18nKey.gbMsgReplyMarker);
	}
	return "";
}

function validateComposer(content: string): string {
	if (loginMode === "force" && !authUser) return i18n(I18nKey.gbLoginRequired);
	if (!authUser && profile.nick.trim().length < 2) {
		return profile.nick.trim()
			? i18n(I18nKey.gbNicknameMinLength).replace("{min}", "2")
			: loginMode === "disable"
				? i18n(I18nKey.gbGuestProfileRequiredDisabled)
				: i18n(I18nKey.gbGuestProfileRequired);
	}
	if (profile.mail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(profile.mail)) {
		return i18n(I18nKey.gbEmailInvalid);
	}
	if (profile.link) {
		try {
			const website = new URL(profile.link);
			if (website.protocol !== "http:" && website.protocol !== "https:") {
				return i18n(I18nKey.gbLinkProtocolInvalid);
			}
		} catch {
			return i18n(I18nKey.gbLinkInvalid);
		}
	}
	return validateMessageBody(content);
}

async function sendMessage(
	replaceMessageId?: string,
	attachment?: GuestbookImageAttachment,
	contentOverride?: string,
): Promise<boolean> {
	if (isSending || isOffline) return false;
	const content = appendGuestbookImage(
		contentOverride ?? draft.trim(),
		attachment,
	);
	composerError = validateComposer(content);
	if (composerError) return false;

	const selectedTarget = replyTarget;
	const target = selectedTarget?.objectId ? selectedTarget : null;
	const tempId = `local-${Date.now()}`;
	const optimistic: GuestbookMessage = {
		id: tempId,
		nick: authUser?.display_name || profile.nick || i18n(I18nKey.gbVisitor),
		avatar: authUser?.avatar || "",
		link: authUser?.url || profile.link.trim() || undefined,
		body: target ? `@${target.nick} ${content}` : content,
		createdAt: Date.now(),
		isAdmin: false,
		replyToId: target?.id,
		replyToNick: target?.nick,
		localState: "sending",
	};

	const retainedMessages = replaceMessageId
		? messages.filter((message) => message.id !== replaceMessageId)
		: messages;
	messages = [...retainedMessages, optimistic];
	draft = "";
	replyTarget = null;
	removeStoredValue(localStorage, DRAFT_STORAGE_KEY);
	await tick();
	scrollToBottom(true);

	try {
		const response = await addComment({
			serverURL,
			lang,
			token: authUser?.token,
			comment: {
				nick: authUser?.display_name || profile.nick.trim(),
				mail: authUser?.email || profile.mail.trim() || undefined,
				link: authUser?.url || profile.link.trim() || undefined,
				comment: buildGuestbookMessageBody(content, target),
				ua: navigator.userAgent,
				url: CHANNEL_PATH,
			},
		});

		if (response.errno || !response.data) {
			throw new Error(response.errmsg || i18n(I18nKey.gbSendFailed));
		}

		messages = messages.filter((message) => message.id !== tempId);
		messages = mergeGuestbookMessages(messages, [
			normalizeGuestbookComment(response.data),
		]);
		totalCount += 1;
		initialError = "";
		syncError = "";
		lastSyncedAt = Date.now();
		await tick();
		scrollToBottom(true);
		queueLatestSync();
	} catch (error) {
		handleAuthenticationError(error);
		const failureReason =
			getGuestbookErrorMessage(error) || i18n(I18nKey.gbSendFailed);
		messages = messages.map((message) =>
			message.id === tempId
				? { ...message, localState: "failed", failureReason }
				: message,
		);
	}
	return true;
}

async function retryMessage(message: GuestbookMessage) {
	const target = message.replyToId
		? (messages.find((candidate) => candidate.id === message.replyToId) ?? null)
		: null;
	replyTarget = target;
	const prefix = target ? `@${target.nick} ` : "";
	const content =
		prefix && message.body.startsWith(prefix)
			? message.body.slice(prefix.length)
			: message.body;
	await sendMessage(message.id, undefined, content);
}

function discardMessage(message: GuestbookMessage) {
	messages = messages.filter((candidate) => candidate.id !== message.id);
}

function startEditingMessage(message: GuestbookMessage) {
	if (!canManageMessage(message) || mutatingMessageId) return;
	messageActionError = null;
	editingMessageId = message.id;
	editDraft = message.body;
}

function cancelEditingMessage() {
	if (mutatingMessageId === editingMessageId) return;
	editingMessageId = null;
	editDraft = "";
	messageActionError = null;
}

async function saveEditedMessage(message: GuestbookMessage) {
	if (
		!authUser?.token ||
		!message.objectId ||
		!canManageMessage(message) ||
		mutatingMessageId
	) {
		return;
	}
	const content = editDraft.trim();
	const validationError = validateMessageBody(content);
	if (validationError) {
		messageActionError = { id: message.id, message: validationError };
		return;
	}
	if (content === message.body) {
		cancelEditingMessage();
		return;
	}

	mutatingMessageId = message.id;
	messageActionError = null;
	try {
		const response = await updateComment({
			serverURL,
			lang,
			token: authUser.token,
			objectId: message.objectId,
			comment: {
				comment: buildGuestbookEditedMessageBody(content, message),
			},
		});
		const normalized = normalizeGuestbookComment(response.data);
		messages = messages.map((candidate) =>
			candidate.id === message.id
				? { ...normalized, userId: normalized.userId ?? message.userId }
				: candidate,
		);
		editingMessageId = null;
		editDraft = "";
		queueLatestSync();
	} catch (error) {
		handleAuthenticationError(error);
		messageActionError = {
			id: message.id,
			message: getGuestbookErrorMessage(error) || i18n(I18nKey.gbEditFailed),
		};
	} finally {
		mutatingMessageId = null;
	}
}

async function confirmDeleteMessage() {
	const target = deleteTarget;
	if (
		!target ||
		!authUser?.token ||
		!target.objectId ||
		!canManageMessage(target) ||
		mutatingMessageId
	) {
		return;
	}

	mutatingMessageId = target.id;
	messageActionError = null;
	try {
		await deleteComment({
			serverURL,
			lang,
			token: authUser.token,
			objectId: target.objectId,
		});
		messages = messages.filter((message) => message.id !== target.id);
		totalCount = Math.max(0, totalCount - 1);
		if (replyTarget?.id === target.id) replyTarget = null;
		if (editingMessageId === target.id) {
			editingMessageId = null;
			editDraft = "";
		}
		mutatingMessageId = null;
		deleteTarget = null;
		if (deleteDialog?.open) deleteDialog.close();
		document.body.style.overflow = "";
		queueLatestSync();
	} catch (error) {
		handleAuthenticationError(error);
		messageActionError = {
			id: target.id,
			message: getGuestbookErrorMessage(error) || i18n(I18nKey.gbDeleteFailed),
		};
	} finally {
		mutatingMessageId = null;
	}
}

async function handleLogin() {
	if (loggingIn) return;
	if (!serverURL) {
		composerError = i18n(I18nKey.gbServerNotConfiguredLogin);
		return;
	}
	loggingIn = true;
	composerError = "";

	try {
		const user = await loginWithWaline({ serverURL, lang });
		if (!isAuthUser(user))
			throw new Error(i18n(I18nKey.gbLoginInvalidResponse));
		authUser = user;
		persistAuthentication(user);
		await loadInitial();
	} catch (error) {
		composerError =
			error instanceof Error && error.message
				? error.message
				: i18n(I18nKey.gbLoginFailed);
	} finally {
		loggingIn = false;
	}
}

async function initializeGuestbook(returnedToken: string | null) {
	if (returnedToken && loginMode !== "disable") {
		loggingIn = true;
		try {
			await restoreWalineRedirectLogin(returnedToken);
		} catch (error) {
			composerError =
				error instanceof Error && error.message
					? error.message
					: i18n(I18nKey.gbLoginVerifyFailed);
		} finally {
			removeLoginTokenFromURL();
			loggingIn = false;
		}
	} else if (returnedToken) {
		removeLoginTokenFromURL();
	}

	if (isOffline) {
		initialLoading = false;
		initialError = i18n(I18nKey.gbOfflineInitial);
	} else if (document.visibilityState === "visible") {
		await loadInitial();
	} else {
		initialLoading = false;
		initialError = i18n(I18nKey.gbHiddenUntilVisible);
	}
}

function handleLogout() {
	clearAuthentication();
	void loadInitial();
}

function handleProfileChange(nextProfile: GuestbookProfile) {
	profile = nextProfile;
	writeStoredValue(localStorage, PROFILE_STORAGE_KEY, nextProfile);
	composerError = "";
}

function handleDraftChange(nextDraft: string) {
	draft = nextDraft;
	writeStoredString(localStorage, DRAFT_STORAGE_KEY, nextDraft);
	composerError = "";
}

onMount(() => {
	const storedProfile = readStoredValue<unknown>(
		localStorage,
		PROFILE_STORAGE_KEY,
	);
	if (isProfile(storedProfile)) profile = storedProfile;
	if (loginMode === "disable") clearAuthentication();
	else authUser = readAuthentication();
	draft = readStoredString(localStorage, DRAFT_STORAGE_KEY);
	isOffline = !navigator.onLine;
	const returnedToken = new URL(window.location.href).searchParams.get("token");
	void initializeGuestbook(returnedToken);
	if (announcements[0]) void openAnnouncement(announcements[0]);
	startPolling();
	document.addEventListener("visibilitychange", handleVisibilityChange);
	window.addEventListener("online", handleOnline);
	window.addEventListener("offline", handleOffline);

	return () => {
		if (pollTimer) window.clearInterval(pollTimer);
		dataController?.abort();
		initialMediaCleanup?.();
		if (announcementDialog?.open) announcementDialog.close();
		if (deleteDialog?.open) deleteDialog.close();
		document.body.style.overflow = "";
		document.removeEventListener("visibilitychange", handleVisibilityChange);
		window.removeEventListener("online", handleOnline);
		window.removeEventListener("offline", handleOffline);
	};
});
</script>

<svelte:window onkeydown={handleChatKeydown} />

<section class="guestbook-chat" aria-label={i18n(I18nKey.gbTitle)}>
	<header class="guestbook-chat__header">
		<div class="guestbook-chat__channel">
			<button
				class:is-syncing={syncing}
				class="guestbook-chat__mobile-channel-refresh"
				type="button"
				onclick={() => void syncLatest()}
				disabled={syncing || initialLoading || isOffline}
				aria-label={syncing
					? i18n(I18nKey.gbRefreshingAria)
					: i18n(I18nKey.gbRefreshAria)}
				aria-busy={syncing}
			>
				<span>{i18n(I18nKey.gbTitle)}</span>
				<span class:is-visible={syncing} class="guestbook-chat__mobile-refresh-icon">
					<RefreshCw size={15} aria-hidden="true" />
				</span>
			</button>
			<div class="guestbook-chat__desktop-channel-details">
				<div class="guestbook-chat__title-row">
					<h2>{i18n(I18nKey.gbTitle)}</h2>
					<span>
						· {i18n(I18nKey.gbMessageCount).replace(
							"{count}",
							initialLoading ? "--" : String(totalCount),
						)}
					</span>
					<div class="guestbook-chat__sync">
						<div
							class:is-failed={Boolean(syncError)}
							class="guestbook-chat__status"
							aria-live="polite"
						>
							<span class:is-offline={isOffline}></span>
							{formatSyncStatus()} {i18n(I18nKey.gbSyncIntervalSuffix)}
						</div>
						<button
							class:is-syncing={syncing} class="guestbook-chat__refresh"
							type="button"
							onclick={() => void syncLatest()}
							disabled={syncing || initialLoading || isOffline}
							aria-label={i18n(I18nKey.gbRefreshNowAria)}
							title={i18n(I18nKey.gbRefreshNowTitle)}
						>
							<RefreshCw size={17} aria-hidden="true" />
						</button>
					</div>
				</div>
			</div>
		</div>

		<div class="guestbook-chat__actions">
			<button
				class="guestbook-chat__sidebar-toggle"
				type="button"
				onclick={() => (sidebarOpen = !sidebarOpen)}
				aria-expanded={sidebarOpen}
				aria-controls="guestbook-chat-sidebar"
				title={i18n(I18nKey.gbMembers)}
			>
				<Users size={18} aria-hidden="true" />
				<span>{chatMembers.length}</span>
			</button>
		</div>
	</header>

	<div
		class:has-announcement-bar={announcementBarVisible && announcements.length > 0}
		class="guestbook-chat__workspace"
	>
		<div class="guestbook-chat__conversation">
			{#if announcementBarVisible && announcements.length > 0}
				<aside class="guestbook-chat__announcement-bar" aria-label={i18n(I18nKey.announcement)}>
					<div class="guestbook-chat__announcement-bar-label">
						<Bell size={16} aria-hidden="true" />
						<strong>{i18n(I18nKey.announcement)}</strong>
					</div>
					<div class="guestbook-chat__announcement-bar-items">
						{#each announcements as announcement}
							<button type="button" onclick={() => void openAnnouncement(announcement)}>
								{announcement.title}
							</button>
						{/each}
					</div>
					<button
						class="guestbook-chat__announcement-bar-close"
						type="button"
						onclick={() => (announcementBarVisible = false)}
						aria-label={i18n(I18nKey.gbCloseAnnouncement)}
						title={i18n(I18nKey.gbCloseAnnouncement)}
					>
						<X size={17} aria-hidden="true" />
					</button>
				</aside>
			{/if}

			{#if initialLoading}
				<div
					class="guestbook-chat__loading"
					aria-label={i18n(I18nKey.gbLoadingAria)}
					aria-busy="true"
				>
					{#each Array(6) as _, index}
						<div class:is-admin={index % 3 === 2} class="guestbook-chat__skeleton">
							<div class="guestbook-chat__skeleton-avatar"></div>
							<div class="guestbook-chat__skeleton-copy">
								<div class="guestbook-chat__skeleton-name"></div>
								<div class="guestbook-chat__skeleton-bubble"></div>
								<div class="guestbook-chat__skeleton-meta"></div>
							</div>
						</div>
					{/each}
				</div>
			{:else if initialError && messages.length === 0}
				<div class="guestbook-chat__state" role="alert">
					<AlertCircle size={34} aria-hidden="true" />
					<h3>{i18n(I18nKey.gbLoadFailedTitle)}</h3>
					<p>{initialError}</p>
					<button type="button" onclick={() => void loadInitial()}>
						<RotateCcw size={17} aria-hidden="true" />{i18n(I18nKey.gbReload)}
					</button>
				</div>
			{:else}
				<div
					class="guestbook-chat__messages custom-scrollbar"
					bind:this={messageList}
					onscroll={handleMessageScroll}
					aria-live="polite"
					aria-relevant="additions"
				>
					<div class="guestbook-chat__history">
						{#if hasMore}
							<button
								type="button"
								onclick={() => void loadOlder()}
								disabled={loadingOlder}
							>
								{#if loadingOlder}
									<LoaderCircle class="is-spinning" size={15} aria-hidden="true" />
								{/if}
								{loadingOlder
									? i18n(I18nKey.gbLoadingOlder)
									: i18n(I18nKey.gbLoadOlder)}
							</button>
						{:else if messages.length > 0}
							<span>{i18n(I18nKey.gbNoMoreMessages)}</span>
						{/if}
					</div>

					{#if messages.length === 0}
						<div class="guestbook-chat__empty">
							<div class="guestbook-chat__empty-mark">GB</div>
							<h3>{i18n(I18nKey.gbEmptyTitle)}</h3>
							<p>{i18n(I18nKey.gbEmptyBody)}</p>
						</div>
					{/if}

					{#each messages as message, index (message.id)}
						{#if shouldShowDate(index)}
							<div class="guestbook-chat__date">
								<span>{dateLabel(message.createdAt)}</span>
							</div>
						{/if}

						<GuestbookChatMessage
							{message}
							referencedMessage={message.replyToId
								? messages.find((candidate) => candidate.id === message.replyToId)
								: undefined}
							timeLabel={formatMessageTime(message.createdAt)}
							canManage={canManageMessage(message)}
							isEditing={editingMessageId === message.id}
							isMutating={mutatingMessageId === message.id}
							{editDraft}
							actionError={messageActionError?.id === message.id
								? messageActionError.message
								: undefined}
							onReply={selectReply}
							onEdit={startEditingMessage}
							onEditDraftChange={(value) => (editDraft = value)}
							onEditCancel={cancelEditingMessage}
							onEditSave={(target) => void saveEditedMessage(target)}
							onDelete={(target) => void requestDeleteMessage(target)}
							onJump={(target) => void jumpToQuotedMessage(target)}
							onRetry={(target) => void retryMessage(target)}
							onDiscard={discardMessage}
							onCopyError={(errorText) => {
								messageActionError = { id: message.id, message: errorText };
							}}
						/>
					{/each}
				</div>
			{/if}

			<div class="guestbook-chat__composer-area">
				{#if !initialLoading && !initialError && (showScrollToBottom || newMessageCount > 0)}
					<button
						class="guestbook-chat__new-messages"
						type="button"
						onclick={() => scrollToBottom(true)}
						aria-label={newMessageCount > 0
							? i18n(I18nKey.gbNewMessagesAria).replace(
									"{count}",
									String(newMessageCount),
								)
							: i18n(I18nKey.gbBackToBottom)}
					>
						<ChevronDown size={20} aria-hidden="true" />
					</button>
				{/if}

				{#if syncError || isOffline}
					<div class="guestbook-chat__sync-error" role="status">
						<WifiOff size={15} aria-hidden="true" />
						<span>{syncError || i18n(I18nKey.gbOffline)}</span>
						{#if !isOffline}
							<button type="button" onclick={() => void syncLatest()}>{i18n(I18nKey.gbRetrySync)}</button>
						{/if}
					</div>
				{/if}

				<GuestbookChatComposer
					{profile}
					{authUser}
					{draft}
					{replyTarget}
					{composerError}
					{isOffline}
					{isSending}
					{loggingIn}
					{loginMode}
					onProfileChange={handleProfileChange}
					onDraftChange={handleDraftChange}
					onReplyCancel={() => (replyTarget = null)}
					onLogin={() => void handleLogin()}
					onLogout={handleLogout}
				onSend={(content, attachment) =>
					sendMessage(undefined, attachment, content)}
					onToolError={(message) => (composerError = message)}
				/>
			</div>
		</div>

		{#if sidebarOpen}
			<button
				class="guestbook-chat__sidebar-overlay"
				type="button"
				onclick={() => (sidebarOpen = false)}
				aria-label={i18n(I18nKey.gbCloseMembers)}
			></button>
		{/if}

		<aside
			id="guestbook-chat-sidebar"
			class:is-open={sidebarOpen}
			class="guestbook-chat__sidebar"
			aria-label={i18n(I18nKey.gbMembers)}
		>
			<div class="guestbook-chat__sidebar-heading">
				<strong>{i18n(I18nKey.gbMembers)}</strong>
				<button
					type="button"
					onclick={() => (sidebarOpen = false)}
					aria-label={i18n(I18nKey.gbCloseMembers)}
				>
					<X size={18} aria-hidden="true" />
				</button>
			</div>

			<section class="guestbook-chat__members" aria-label={i18n(I18nKey.gbMembersListAria)}>
				<div class="guestbook-chat__member-list custom-scrollbar">
					{#each [
						{ title: i18n(I18nKey.gbAdmin), members: stationMembers },
						{ title: i18n(I18nKey.gbMembers), members: guestMembers },
					] as group (group.title)}
						<div class="guestbook-chat__member-group">
							<div class="guestbook-chat__member-group-title">
								<strong>{group.title}</strong>
								<span aria-label={i18n(I18nKey.gbMemberCountAria).replace("{count}", String(group.members.length))}>— {group.members.length}</span>
							</div>

							<div class="guestbook-chat__member-group-list">
								{#each group.members as member (`${member.nick}-${member.avatar}`)}
									{#if member.link}
										<a
											class="guestbook-chat__member"
											href={member.link}
											target="_blank"
											rel="nofollow noopener noreferrer"
										>
											<span class="guestbook-chat__member-avatar">
												<span>{getGuestbookInitials(member.nick)}</span>
												{#if member.avatar}<img src={member.avatar} alt="" loading="lazy" />{/if}
											</span>
											<span class="guestbook-chat__member-identity">
												{#if member.label}<small>{member.label}</small>{/if}
												<span class="guestbook-chat__member-name">{member.nick}</span>
											</span>
										</a>
									{:else}
										<div class="guestbook-chat__member">
											<span class="guestbook-chat__member-avatar">
												<span>{getGuestbookInitials(member.nick)}</span>
												{#if member.avatar}<img src={member.avatar} alt="" loading="lazy" />{/if}
											</span>
											<span class="guestbook-chat__member-identity">
												{#if member.label}<small>{member.label}</small>{/if}
												<span class="guestbook-chat__member-name">{member.nick}</span>
											</span>
										</div>
									{/if}
								{/each}
							</div>
						</div>
					{/each}
				</div>
			</section>
		</aside>
	</div>

	<dialog
		bind:this={announcementDialog}
		class="privacy-modal guestbook-announcement-modal"
		aria-labelledby="guestbook-announcement-title"
		onclose={() => (document.body.style.overflow = "")}
		oncancel={(event) => {
			event.preventDefault();
			closeAnnouncement();
		}}
	>
		<div class="privacy-overlay" onclick={closeAnnouncement}></div>
		{#if selectedAnnouncement}
			<div class="privacy-panel">
				<div class="privacy-header">
					<h2 id="guestbook-announcement-title" class="privacy-title">
						{selectedAnnouncement.title}
					</h2>
					<button
						class="privacy-close"
						type="button"
						onclick={closeAnnouncement}
					aria-label={i18n(I18nKey.gbCloseAnnouncement)}
					>
						<X size={20} aria-hidden="true" />
					</button>
				</div>
				<div class="privacy-body guestbook-announcement-modal__body custom-scrollbar">
					<p>{selectedAnnouncement.summary}</p>
					{#if selectedAnnouncement.lead}<p>{selectedAnnouncement.lead}</p>{/if}
					<ul>
						{#each selectedAnnouncement.rules as rule}
							<li>{rule}</li>
						{/each}
					</ul>
				</div>
				<div class="privacy-footer">
					<button class="privacy-confirm-btn" type="button" onclick={closeAnnouncement}>
						{i18n(I18nKey.gotIt)}
					</button>
				</div>
			</div>
		{/if}
	</dialog>

	<dialog
		bind:this={deleteDialog}
		class="privacy-modal guestbook-delete-modal"
		aria-labelledby="guestbook-delete-title"
		onclose={() => {
			document.body.style.overflow = "";
			if (!mutatingMessageId) deleteTarget = null;
		}}
		oncancel={(event) => {
			event.preventDefault();
			closeDeleteDialog();
		}}
	>
		<div class="privacy-overlay" onclick={closeDeleteDialog}></div>
		{#if deleteTarget}
			<div class="privacy-panel guestbook-delete-modal__panel">
				<div class="privacy-header">
					<h2 id="guestbook-delete-title" class="privacy-title">{i18n(I18nKey.gbDeleteMessage)}</h2>
					<button
						class="privacy-close"
						type="button"
						onclick={closeDeleteDialog}
						disabled={mutatingMessageId === deleteTarget.id}
						aria-label={i18n(I18nKey.gbCloseDeleteConfirm)}
					>
						<X size={20} aria-hidden="true" />
					</button>
				</div>
				<div class="privacy-body guestbook-delete-modal__body">
					<p>{i18n(I18nKey.gbDeleteWarning)}</p>
					<blockquote>{deleteTarget.body.slice(0, 160)}</blockquote>
					{#if messageActionError?.id === deleteTarget.id}
						<p class="guestbook-delete-modal__error" role="alert">
							{messageActionError.message}
						</p>
					{/if}
				</div>
				<div class="privacy-footer guestbook-delete-modal__actions">
					<button
						class="guestbook-delete-modal__cancel"
						type="button"
						onclick={closeDeleteDialog}
						disabled={mutatingMessageId === deleteTarget.id}
						>
							{i18n(I18nKey.cancel)}
						</button>
					<button
						class="guestbook-delete-modal__confirm"
						type="button"
						onclick={() => void confirmDeleteMessage()}
						disabled={mutatingMessageId === deleteTarget.id}
					>
						{mutatingMessageId === deleteTarget.id
							? i18n(I18nKey.deleting)
							: i18n(I18nKey.deleteLabel)}
					</button>
				</div>
			</div>
		{/if}
	</dialog>
</section>
