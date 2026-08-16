import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import type { AiSearchArticleReference } from "@/types/ai-search";

export interface AiSearchMessage {
	role: "user" | "assistant";
	content: string;
	refs?: AiSearchArticleReference[];
	streaming?: boolean;
}

export interface AiSearchSessionMeta {
	id: string;
	title: string;
	updatedAt: number;
}

interface StoredValue<T> {
	version: number;
	expiresAt: number;
	data: T;
}

const STORAGE_SESSIONS_KEY = "ai-chat:sessions";
const STORAGE_SESSION_PREFIX = "ai-chat:session:";
const STORAGE_VERSION = 1;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SESSIONS = 20;

function readStoredValue<T>(key: string): T | null {
	try {
		const raw = localStorage.getItem(key);
		if (!raw) return null;
		const parsed = JSON.parse(raw) as StoredValue<T>;
		if (
			parsed.version !== STORAGE_VERSION ||
			typeof parsed.expiresAt !== "number" ||
			parsed.expiresAt <= Date.now()
		) {
			localStorage.removeItem(key);
			return null;
		}
		return parsed.data;
	} catch {
		localStorage.removeItem(key);
		return null;
	}
}

function writeStoredValue<T>(key: string, data: T): void {
	try {
		const value: StoredValue<T> = {
			version: STORAGE_VERSION,
			expiresAt: Date.now() + SESSION_TTL_MS,
			data,
		};
		localStorage.setItem(key, JSON.stringify(value));
	} catch {
		// Storage can be unavailable in private browsing or when quota is exhausted.
	}
}

function getSessionTitle(messages: AiSearchMessage[]): string {
	const firstUser = messages.find((message) => message.role === "user");
	if (!firstUser) return i18n(I18nKey.aiNewChat);
	return firstUser.content.length > 20
		? `${firstUser.content.slice(0, 20)}...`
		: firstUser.content;
}

export function generateSessionId(): string {
	return `sess_${crypto.randomUUID()}`;
}

export function loadSessionList(): AiSearchSessionMeta[] {
	const list = readStoredValue<AiSearchSessionMeta[]>(STORAGE_SESSIONS_KEY);
	return Array.isArray(list)
		? list.filter(
				(item) =>
					item &&
					typeof item.id === "string" &&
					typeof item.title === "string" &&
					typeof item.updatedAt === "number",
			)
		: [];
}

export function loadSessionMessages(id: string): AiSearchMessage[] {
	const stored = readStoredValue<AiSearchMessage[]>(
		STORAGE_SESSION_PREFIX + id,
	);
	return Array.isArray(stored)
		? stored.filter(
				(message) =>
					message &&
					(message.role === "user" || message.role === "assistant") &&
					typeof message.content === "string",
			)
		: [];
}

export function saveSession(
	id: string,
	messages: AiSearchMessage[],
	currentList: AiSearchSessionMeta[],
): AiSearchSessionMeta[] {
	if (
		!id ||
		messages.length === 0 ||
		messages.some((message) => message.streaming)
	) {
		return currentList;
	}

	writeStoredValue(STORAGE_SESSION_PREFIX + id, messages);
	const now = Date.now();
	const next = currentList.filter((session) => session.id !== id);
	next.unshift({ id, title: getSessionTitle(messages), updatedAt: now });
	for (const removed of next.splice(MAX_SESSIONS)) {
		try {
			localStorage.removeItem(STORAGE_SESSION_PREFIX + removed.id);
		} catch {
			// Ignore storage cleanup failures.
		}
	}
	writeStoredValue(STORAGE_SESSIONS_KEY, next);
	return next;
}

export function deleteStoredSession(id: string): void {
	try {
		localStorage.removeItem(STORAGE_SESSION_PREFIX + id);
	} catch {
		// Ignore storage cleanup failures.
	}
}

export function saveSessionList(list: AiSearchSessionMeta[]): void {
	writeStoredValue(STORAGE_SESSIONS_KEY, list);
}

export function clearStoredSessions(): void {
	try {
		for (let index = localStorage.length - 1; index >= 0; index -= 1) {
			const key = localStorage.key(index);
			if (
				key === STORAGE_SESSIONS_KEY ||
				key?.startsWith(STORAGE_SESSION_PREFIX)
			) {
				localStorage.removeItem(key);
			}
		}
	} catch {
		// Ignore storage cleanup failures.
	}
}
