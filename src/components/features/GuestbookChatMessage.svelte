<script lang="ts">
import {
	ArrowUpToLine,
	Check,
	Copy,
	Laptop,
	LoaderCircle,
	MapPin,
	Monitor,
	Pencil,
	Reply,
	RotateCcw,
	Trash2,
	X,
} from "lucide-svelte";
import type { GuestbookChatMessage } from "@/types/guestbook-chat";
import { getGuestbookInitials } from "@/utils/guestbook-chat";
import {
	renderGuestbookMessage,
	renderGuestbookQuotePreview,
} from "@/utils/guestbook-chat-markup";

interface Props {
	message: GuestbookChatMessage;
	referencedMessage?: GuestbookChatMessage;
	timeLabel: string;
	canManage: boolean;
	isEditing: boolean;
	isMutating: boolean;
	editDraft: string;
	actionError?: string;
	onReply: (message: GuestbookChatMessage) => void;
	onEdit: (message: GuestbookChatMessage) => void;
	onEditDraftChange: (draft: string) => void;
	onEditCancel: () => void;
	onEditSave: (message: GuestbookChatMessage) => void;
	onDelete: (message: GuestbookChatMessage) => void;
	onJump: (message: GuestbookChatMessage) => void;
	onRetry: (message: GuestbookChatMessage) => void;
	onDiscard: (message: GuestbookChatMessage) => void;
	onCopyError: (message: string) => void;
}

let {
	message,
	referencedMessage,
	timeLabel,
	canManage,
	isEditing,
	isMutating,
	editDraft,
	actionError,
	onReply,
	onEdit,
	onEditDraftChange,
	onEditCancel,
	onEditSave,
	onDelete,
	onJump,
	onRetry,
	onDiscard,
	onCopyError,
}: Props = $props();

let copied = $state(false);

const quotePreview = $derived(
	referencedMessage
		? renderGuestbookQuotePreview(referencedMessage.body)
		: "原消息暂未加载",
);
const renderedBody = $derived(renderGuestbookMessage(message.body));

async function copyMessage() {
	try {
		await navigator.clipboard.writeText(message.body);
		copied = true;
		window.setTimeout(() => (copied = false), 1600);
	} catch {
		onCopyError("复制失败，请检查浏览器剪贴板权限");
	}
}
</script>

<article
	id={`guestbook-message-${message.id}`}
	class:is-admin={message.isAdmin}
	class:is-failed={message.localState === "failed"}
	class:is-sending={message.localState === "sending"}
	class="guestbook-message"
>
	{#if message.replyToId}
		<button
			class="guestbook-message__quote"
			type="button"
			onclick={() => onJump(message)}
			aria-label={`跳转到 ${message.replyToNick || "访客"} 的原消息`}
			title="跳转到原消息"
		>
			<span class="guestbook-message__quote-avatar" aria-hidden="true">
				<span>{getGuestbookInitials(referencedMessage?.nick || message.replyToNick || "访客")}</span>
				{#if referencedMessage?.avatar}
					<img
						src={referencedMessage.avatar}
						alt=""
						loading="lazy"
						referrerpolicy="no-referrer"
						onerror={(event) =>
							((event.currentTarget as HTMLImageElement).style.display = "none")}
					/>
				{/if}
			</span>
			<span class="guestbook-message__quote-copy">
				<strong>@{message.replyToNick || "访客"}</strong>
				<small>{@html quotePreview}</small>
			</span>
			<ArrowUpToLine
				class="guestbook-message__quote-jump"
				size={15}
				aria-hidden="true"
			/>
		</button>
	{/if}

	<div class="guestbook-message__main">
	<div class="guestbook-message__avatar" aria-hidden="true">
		<span>{getGuestbookInitials(message.nick)}</span>
		{#if message.avatar}
			<img
				src={message.avatar}
				alt=""
				loading="lazy"
				referrerpolicy="no-referrer"
				onerror={(event) =>
					((event.currentTarget as HTMLImageElement).style.display = "none")}
			/>
		{/if}
	</div>

	<div class="guestbook-message__column">
		<div class="guestbook-message__heading">
			<span class="guestbook-message__author">
				{#if message.link}
					<a
						class="guestbook-message__author-link"
						href={message.link}
						target="_blank"
						rel="nofollow noopener noreferrer"
						title={`访问 ${message.nick} 的网站`}
					>
						{message.nick}
					</a>
				{:else}
					<strong>{message.nick}</strong>
				{/if}
			</span>
			{#if message.isAdmin}
				<span class="guestbook-message__badge guestbook-message__badge--admin">站长</span>
			{/if}
			{#if message.label}
				<span class="guestbook-message__badge">{message.label}</span>
			{/if}
			<time
				class="guestbook-message__time"
				datetime={new Date(message.createdAt).toISOString()}>{timeLabel}</time
			>
			{#if message.status === "waiting"}
				<span class="guestbook-message__badge guestbook-message__badge--waiting">审核中</span>
			{/if}
		</div>

		<div class="guestbook-message__bubble-row">
			<div class="guestbook-message__bubble">
				{#if isEditing}
					<textarea
						class="guestbook-message__edit-input"
						value={editDraft}
						oninput={(event) => onEditDraftChange(event.currentTarget.value)}
						maxlength="300"
						rows="4"
						disabled={isMutating}
						aria-label={`编辑 ${message.nick} 的消息`}
					></textarea>
					<div class="guestbook-message__edit-actions">
						<span>{editDraft.length}/300</span>
						<button type="button" onclick={onEditCancel} disabled={isMutating}>
							<X size={14} aria-hidden="true" />取消
						</button>
						<button
							type="button"
							onclick={() => onEditSave(message)}
							disabled={isMutating}
						>
							{#if isMutating}
								<LoaderCircle class="is-spinning" size={14} aria-hidden="true" />
							{:else}
								<Check size={14} aria-hidden="true" />
							{/if}
							{isMutating ? "保存中" : "保存"}
						</button>
					</div>
				{:else}
					<div class="guestbook-message__body">{@html renderedBody}</div>
				{/if}
			</div>

			{#if !message.localState && !isEditing}
				<div class="guestbook-message__tools" role="group" aria-label="消息操作">
					<button
						type="button"
						onclick={() => onReply(message)}
						aria-label={`回复 ${message.nick}`}
						title="引用回复"
					>
						<Reply size={15} aria-hidden="true" />
					</button>
					<button
						type="button"
						onclick={copyMessage}
						aria-label={copied ? "已复制" : "复制消息"}
						title={copied ? "已复制" : "复制消息"}
					>
						{#if copied}
							<Check size={15} aria-hidden="true" />
						{:else}
							<Copy size={15} aria-hidden="true" />
						{/if}
					</button>
					{#if canManage}
						<button
							type="button"
							onclick={() => onEdit(message)}
							aria-label="编辑消息"
							title="编辑消息"
							disabled={isMutating}
						>
							<Pencil size={15} aria-hidden="true" />
						</button>
						<button
							type="button"
							onclick={() => onDelete(message)}
							aria-label="删除消息"
							title="删除消息"
							disabled={isMutating}
						>
							<Trash2 size={15} aria-hidden="true" />
						</button>
					{/if}
				</div>
			{/if}
		</div>

		<div class="guestbook-message__meta">
			{#if message.browser}
				<span><Monitor size={14} aria-hidden="true" />{message.browser}</span>
			{/if}
			{#if message.os}
				<span><Laptop size={14} aria-hidden="true" />{message.os}</span>
			{/if}
			{#if message.addr}
				<span><MapPin size={14} aria-hidden="true" />{message.addr}</span>
			{/if}
			{#if message.localState === "sending"}
				<span><LoaderCircle class="is-spinning" size={14} aria-hidden="true" />发送中</span>
			{/if}
		</div>

		{#if message.localState === "failed"}
			<div class="guestbook-message__failure" role="alert">
				<span>{message.failureReason}</span>
				<button type="button" onclick={() => onRetry(message)}>
					<RotateCcw size={14} aria-hidden="true" />重试
				</button>
				<button type="button" onclick={() => onDiscard(message)}>
					<Trash2 size={14} aria-hidden="true" />删除
				</button>
			</div>
		{/if}

		{#if actionError}
			<div class="guestbook-message__failure" role="alert">{actionError}</div>
		{/if}
	</div>
	</div>
</article>
