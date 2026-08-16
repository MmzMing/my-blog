import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import type {
	AiSearchChatMessage,
	AiSearchErrorBody,
	AiSearchEvent,
	AiSearchRequest,
} from "@/types/ai-search";
import { parseAiSearchEventStream } from "./sse-parser";

export class AiSearchClientError extends Error {
	readonly status: number;
	readonly code: AiSearchErrorBody["code"] | null;

	constructor(
		message: string,
		status: number,
		code: AiSearchErrorBody["code"] | null,
	) {
		super(message);
		this.name = "AiSearchClientError";
		this.status = status;
		this.code = code;
	}
}

function parseErrorBody(value: unknown): AiSearchErrorBody | null {
	if (!value || typeof value !== "object") return null;
	const error = Reflect.get(value, "error");
	const code = Reflect.get(value, "code");
	return typeof error === "string" && typeof code === "string"
		? (value as AiSearchErrorBody)
		: null;
}

interface StreamAiSearchOptions {
	question: string;
	history: AiSearchChatMessage[];
	sessionId: string;
	signal: AbortSignal;
	onEvent(event: AiSearchEvent): void;
}

export async function streamAiSearch({
	question,
	history,
	sessionId,
	signal,
	onEvent,
}: StreamAiSearchOptions): Promise<void> {
	const payload: AiSearchRequest = { question, history, sessionId };
	const response = await fetch("/api/ai-chat", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
		signal,
	});

	if (!response.ok) {
		let body: AiSearchErrorBody | null = null;
		try {
			body = parseErrorBody(await response.json());
		} catch {
			body = null;
		}
		throw new AiSearchClientError(
			body?.error ??
				i18n(I18nKey.aiRequestFailedStatus).replace(
					"{status}",
					`${response.status}`,
				),
			response.status,
			body?.code ?? null,
		);
	}
	if (!response.body) {
		throw new AiSearchClientError(
			i18n(I18nKey.aiStreamUnreadable),
			response.status,
			null,
		);
	}

	for await (const event of parseAiSearchEventStream(response.body)) {
		onEvent(event);
	}
}
