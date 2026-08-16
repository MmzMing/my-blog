<script lang="ts">
import {
	ImagePlus,
	LoaderCircle,
	Reply,
	Smile,
	TriangleAlert,
	X,
} from "lucide-svelte";
import { tick } from "svelte";
import { commentConfig } from "@/config/commentConfig";
import I18nKey from "@/i18n/i18nKey";
import { i18n } from "@/i18n/translation";
import type {
	GuestbookAuthUser,
	GuestbookChatMessage,
	GuestbookEmojiItem,
	GuestbookEmojiPack,
	GuestbookImageAttachment,
	GuestbookProfile,
} from "@/types/guestbook-chat";
import {
	loadGuestbookEmojiPacks,
	uploadGuestbookImage,
	WALINE_INLINE_IMAGE_SIZE_LIMIT,
} from "@/utils/guestbook-chat";

interface Props {
	profile: GuestbookProfile;
	authUser: GuestbookAuthUser | null;
	draft: string;
	replyTarget: GuestbookChatMessage | null;
	composerError: string;
	isOffline: boolean;
	isSending: boolean;
	loggingIn: boolean;
	loginMode: "enable" | "force" | "disable";
	onProfileChange: (profile: GuestbookProfile) => void;
	onDraftChange: (draft: string) => void;
	onReplyCancel: () => void;
	onLogin: () => void;
	onLogout: () => void;
	onSend: (
		content: string,
		attachment?: GuestbookImageAttachment,
	) => Promise<boolean>;
	onToolError: (message: string) => void;
}

let {
	profile,
	authUser,
	draft,
	replyTarget,
	composerError,
	isOffline,
	isSending,
	loggingIn,
	loginMode,
	onProfileChange,
	onDraftChange,
	onReplyCancel,
	onLogin,
	onLogout,
	onSend,
	onToolError,
}: Props = $props();

const MAX_DRAFT_LENGTH = 300;
const MAX_REMOTE_IMAGE_SIZE = 5 * 1024 * 1024;
const MIN_MESSAGE_PANE_HEIGHT = 128;
const RESIZE_KEYBOARD_STEP = 16;
const emojiSources = commentConfig.waline?.emoji ?? [];
const imageUploadURL = commentConfig.waline?.imageUploadURL ?? "";
const maxImageSize = imageUploadURL
	? MAX_REMOTE_IMAGE_SIZE
	: WALINE_INLINE_IMAGE_SIZE_LIMIT;
const supportedImageTypes = new Set([
	"image/png",
	"image/jpeg",
	"image/gif",
	"image/webp",
]);

let textarea = $state<HTMLTextAreaElement | null>(null);
let emojiTrigger = $state<HTMLButtonElement | null>(null);
let emojiPanel = $state<HTMLDivElement | null>(null);
let imageInput = $state<HTMLInputElement | null>(null);
let profileDialog = $state<HTMLDialogElement | null>(null);
let profileNickInput = $state<HTMLInputElement | null>(null);
let showEmojiPicker = $state(false);
let isComposing = $state(false);
let isLoadingEmojis = $state(false);
let isUploadingImage = $state(false);
let pendingImage = $state<GuestbookImageAttachment | null>(null);
let emojiError = $state("");
let emojiPacks = $state<GuestbookEmojiPack[]>([]);
let activeEmojiPackIndex = $state(0);
let manualTextareaHeight = $state<number | null>(null);
let resizePointerId = $state<number | null>(null);
let profileDraft = $state<GuestbookProfile>({ nick: "", mail: "", link: "" });
let profileDialogError = $state("");
let resizeStartY = 0;
let resizeStartHeight = 0;

const inputDisabled = $derived(
	isOffline || (loginMode === "force" && !authUser),
);
const authName = $derived(authUser?.display_name || i18n(I18nKey.gbVisitor));
const activeEmojiPack = $derived(emojiPacks[activeEmojiPackIndex] ?? null);
const hasGuestProfile = $derived(profile.nick.trim().length >= 2);

function formatMobileIdentityName(value: string): string {
	const characters = Array.from(value.trim());
	return characters.length > 4
		? `${characters.slice(0, 4).join("")}...`
		: characters.join("");
}

async function openGuestProfile() {
	profileDraft = { ...profile };
	profileDialogError = "";
	if (!profileDialog?.open) profileDialog?.showModal();
	document.body.style.overflow = "hidden";
	await tick();
	profileNickInput?.focus();
}

function closeGuestProfile() {
	if (profileDialog?.open) profileDialog.close();
	profileDialogError = "";
	document.body.style.overflow = "";
}

function validateGuestProfile(nextProfile: GuestbookProfile): string {
	if (nextProfile.nick.length < 2)
		return i18n(I18nKey.gbNicknameMinLength).replace("{min}", "2");
	if (
		nextProfile.mail &&
		!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(nextProfile.mail)
	) {
		return i18n(I18nKey.gbEmailInvalid);
	}
	if (nextProfile.link) {
		try {
			const website = new URL(nextProfile.link);
			if (website.protocol !== "http:" && website.protocol !== "https:") {
				return i18n(I18nKey.gbLinkProtocolInvalid);
			}
		} catch {
			return i18n(I18nKey.gbLinkInvalid);
		}
	}
	return "";
}

function saveGuestProfile() {
	const nextProfile = {
		nick: profileDraft.nick.trim(),
		mail: profileDraft.mail.trim(),
		link: profileDraft.link.trim(),
	};
	profileDialogError = validateGuestProfile(nextProfile);
	if (profileDialogError) return;
	onProfileChange(nextProfile);
	onToolError("");
	closeGuestProfile();
}

function resizeTextarea() {
	if (!textarea) return;
	if (manualTextareaHeight !== null) return;
	textarea.style.height = "auto";
	textarea.style.height = `${Math.min(textarea.scrollHeight, 144)}px`;
}

function getTextareaHeightBounds() {
	if (!textarea) return null;
	const styles = getComputedStyle(textarea);
	const minHeight = Number.parseFloat(styles.minHeight);
	const cssMaxHeight = Number.parseFloat(styles.maxHeight);
	const conversation = textarea.closest<HTMLElement>(
		".guestbook-chat__conversation",
	);
	const composer = textarea.closest<HTMLElement>(
		".guestbook-chat__composer-area",
	);
	const currentHeight = textarea.getBoundingClientRect().height;
	const fixedComposerHeight = composer
		? composer.getBoundingClientRect().height - currentHeight
		: 0;
	const availableHeight = conversation
		? conversation.getBoundingClientRect().height -
			fixedComposerHeight -
			MIN_MESSAGE_PANE_HEIGHT
		: window.innerHeight * 0.45;
	const configuredMax = Number.isFinite(cssMaxHeight)
		? cssMaxHeight
		: window.innerHeight * 0.45;
	const minimum = Number.isFinite(minHeight) ? minHeight : 56;

	return {
		min: minimum,
		max: Math.max(minimum, Math.min(configuredMax, availableHeight)),
	};
}

function setTextareaHeight(height: number) {
	if (!textarea) return;
	const bounds = getTextareaHeightBounds();
	if (!bounds) return;
	const nextHeight = Math.round(
		Math.min(bounds.max, Math.max(bounds.min, height)),
	);
	manualTextareaHeight = nextHeight;
	textarea.style.height = `${nextHeight}px`;
}

function startTextareaResize(event: PointerEvent) {
	if (!textarea || event.button !== 0) return;
	event.preventDefault();
	resizePointerId = event.pointerId;
	resizeStartY = event.clientY;
	resizeStartHeight = textarea.getBoundingClientRect().height;
	(event.currentTarget as HTMLButtonElement).setPointerCapture(event.pointerId);
}

function moveTextareaResize(event: PointerEvent) {
	if (resizePointerId !== event.pointerId) return;
	setTextareaHeight(resizeStartHeight + resizeStartY - event.clientY);
}

function finishTextareaResize(event: PointerEvent) {
	if (resizePointerId !== event.pointerId) return;
	const handle = event.currentTarget as HTMLButtonElement;
	if (handle.hasPointerCapture(event.pointerId)) {
		handle.releasePointerCapture(event.pointerId);
	}
	resizePointerId = null;
}

function handleResizeKeydown(event: KeyboardEvent) {
	if (
		!textarea ||
		!["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)
	) {
		return;
	}
	event.preventDefault();
	const bounds = getTextareaHeightBounds();
	if (!bounds) return;
	const currentHeight = textarea.getBoundingClientRect().height;
	if (event.key === "Home") setTextareaHeight(bounds.min);
	else if (event.key === "End") setTextareaHeight(bounds.max);
	else {
		setTextareaHeight(
			currentHeight +
				(event.key === "ArrowUp"
					? RESIZE_KEYBOARD_STEP
					: -RESIZE_KEYBOARD_STEP),
		);
	}
}

function handleWindowResize() {
	if (manualTextareaHeight !== null) {
		setTextareaHeight(manualTextareaHeight);
	}
}

function handleInput(event: Event) {
	onDraftChange((event.currentTarget as HTMLTextAreaElement).value);
	resizeTextarea();
}

function handleKeydown(event: KeyboardEvent) {
	if (
		event.key !== "Enter" ||
		event.shiftKey ||
		event.isComposing ||
		isComposing ||
		isUploadingImage
	) {
		return;
	}
	event.preventDefault();
	void submitMessage();
}

function handleWindowKeydown(event: KeyboardEvent) {
	if (event.key === "Escape") showEmojiPicker = false;
}

function handleWindowPointerdown(event: PointerEvent) {
	const target = event.target;
	if (!(target instanceof Node)) return;
	if (emojiTrigger?.contains(target) || emojiPanel?.contains(target)) return;
	showEmojiPicker = false;
}

function insertContent(content: string): boolean {
	if (!textarea) {
		const nextDraft = `${draft}${content}`;
		if (nextDraft.length > MAX_DRAFT_LENGTH) {
			onToolError(
				i18n(I18nKey.gbMsgMaxLength).replace("{max}", String(MAX_DRAFT_LENGTH)),
			);
			return false;
		}
		onDraftChange(nextDraft);
		return true;
	}

	const start = textarea.selectionStart;
	const end = textarea.selectionEnd;
	const nextDraft = `${draft.slice(0, start)}${content}${draft.slice(end)}`;
	if (nextDraft.length > MAX_DRAFT_LENGTH) {
		onToolError(
			i18n(I18nKey.gbMsgMaxLength).replace("{max}", String(MAX_DRAFT_LENGTH)),
		);
		return false;
	}
	onDraftChange(nextDraft);
	void tick().then(() => {
		if (!textarea) return;
		textarea.focus();
		textarea.setSelectionRange(start + content.length, start + content.length);
		resizeTextarea();
	});
	return true;
}

async function loadEmojis() {
	if (isLoadingEmojis) return;
	isLoadingEmojis = true;
	emojiError = "";
	try {
		emojiPacks = await loadGuestbookEmojiPacks(emojiSources);
		activeEmojiPackIndex = 0;
	} catch (error) {
		emojiError =
			error instanceof Error ? error.message : i18n(I18nKey.gbEmojiLoadFailed);
	} finally {
		isLoadingEmojis = false;
	}
}

function toggleEmojiPicker() {
	showEmojiPicker = !showEmojiPicker;
	if (showEmojiPicker && emojiPacks.length === 0) void loadEmojis();
}

function insertEmoji(emoji: GuestbookEmojiItem) {
	if (insertContent(`:${emoji.key}:`)) showEmojiPicker = false;
}

function serializeEmojiShortcodes(content: string): string {
	const emojiByKey = new Map(
		emojiPacks.flatMap((pack) =>
			pack.items.map((emoji) => [emoji.key, emoji.url] as const),
		),
	);
	return content.replace(/:([A-Za-z0-9_-]+):/gu, (shortcode, key: string) => {
		const url = emojiByKey.get(key);
		return url
			? `![${key}](${url} "${i18n(I18nKey.gbEmojiImageTitle)}")`
			: shortcode;
	});
}

function openImagePicker() {
	showEmojiPicker = false;
	imageInput?.click();
}

async function submitMessage() {
	if (!authUser && loginMode !== "force" && !hasGuestProfile) {
		onToolError(
			loginMode === "disable"
				? i18n(I18nKey.gbGuestProfileRequiredDisabled)
				: i18n(I18nKey.gbGuestProfileRequired),
		);
		return;
	}
	const accepted = await onSend(
		serializeEmojiShortcodes(draft.trim()),
		pendingImage ?? undefined,
	);
	if (accepted) pendingImage = null;
}

async function handleImageSelection(event: Event) {
	const input = event.currentTarget as HTMLInputElement;
	const file = input.files?.[0];
	input.value = "";
	if (!file) return;
	if (!supportedImageTypes.has(file.type)) {
		onToolError(i18n(I18nKey.gbImageTypeUnsupported));
		return;
	}
	if (file.size > maxImageSize) {
		onToolError(
			imageUploadURL
				? i18n(I18nKey.gbImageTooLarge)
				: i18n(I18nKey.gbImageTooLargeInline),
		);
		return;
	}

	isUploadingImage = true;
	onToolError("");
	try {
		const url = await uploadGuestbookImage(file, imageUploadURL);
		const name = file.name
			.replace(/\.[^.]+$/u, "")
			.replace(/[[\]]/gu, "")
			.trim();
		pendingImage = { name: name || i18n(I18nKey.image), url };
	} catch (error) {
		onToolError(
			error instanceof Error
				? error.message
				: i18n(I18nKey.gbImageUploadFailed),
		);
	} finally {
		isUploadingImage = false;
	}
}
</script>

<svelte:window
	onkeydown={handleWindowKeydown}
	onpointerdown={handleWindowPointerdown}
	onresize={handleWindowResize}
/>

<footer class="guestbook-composer">
	{#if replyTarget}
		<div class="guestbook-composer__reply">
			<Reply size={16} aria-hidden="true" />
			<div>
				<span>{i18n(I18nKey.gbComposerReplyTo).replace("{nick}", replyTarget.nick)}</span>
				<small>{replyTarget.body.slice(0, 80)}</small>
			</div>
			<button
				type="button"
				onclick={onReplyCancel}
				aria-label={i18n(I18nKey.gbCancelQuote)}
				title={i18n(I18nKey.gbCancelQuote)}
			>
				<X size={18} aria-hidden="true" />
			</button>
		</div>
	{/if}

	<div
		class:is-resizing={resizePointerId !== null}
		class="guestbook-composer__editor"
	>
		<button
			class="guestbook-composer__resize-handle"
			type="button"
			onpointerdown={startTextareaResize}
			onpointermove={moveTextareaResize}
			onpointerup={finishTextareaResize}
			onpointercancel={finishTextareaResize}
			onkeydown={handleResizeKeydown}
			aria-label={i18n(I18nKey.gbResizeAria)}
			title={i18n(I18nKey.gbResizeTitle)}
		></button>
		<textarea
			bind:this={textarea}
			value={draft}
			oninput={handleInput}
			onkeydown={handleKeydown}
			oncompositionstart={() => (isComposing = true)}
			oncompositionend={() => (isComposing = false)}
			rows="3"
			maxlength="300"
			placeholder={loginMode === "force" && !authUser
				? i18n(I18nKey.gbPlaceholderRequireLogin)
				: i18n(I18nKey.gbPlaceholder)}
			aria-label={i18n(I18nKey.gbComposerAria)}
			disabled={inputDisabled}
		></textarea>

		{#if pendingImage}
			<div class="guestbook-composer__image-preview">
				<img src={pendingImage.url} alt={pendingImage.name} />
				<span>{pendingImage.name}</span>
				<button
					type="button"
					onclick={() => (pendingImage = null)}
					aria-label={i18n(I18nKey.gbRemoveImageAria)}
					title={i18n(I18nKey.gbRemoveImageTitle)}
				>
					<X size={16} aria-hidden="true" />
				</button>
			</div>
		{/if}

		<div class="guestbook-composer__footer">
			<div class="guestbook-composer__tools">
				<button
					bind:this={emojiTrigger}
					type="button"
					class:is-active={showEmojiPicker}
					onclick={toggleEmojiPicker}
					aria-label={i18n(I18nKey.gbEmojiAria)}
					aria-expanded={showEmojiPicker}
					aria-controls="guestbook-emoji-picker"
					title={i18n(I18nKey.emoji)}
					disabled={inputDisabled}
				>
					<Smile size={20} aria-hidden="true" />
				</button>
				<button
					type="button"
					onclick={openImagePicker}
					aria-label={i18n(I18nKey.gbUploadImageAria)}
					title={i18n(I18nKey.image)}
					disabled={inputDisabled || isUploadingImage}
				>
					{#if isUploadingImage}
						<LoaderCircle class="is-spinning" size={20} aria-hidden="true" />
					{:else}
						<ImagePlus size={20} aria-hidden="true" />
					{/if}
				</button>
				<input
					bind:this={imageInput}
					class="guestbook-composer__file-input"
					type="file"
					accept="image/png,image/jpeg,image/gif,image/webp"
					onchange={handleImageSelection}
					tabindex="-1"
					aria-hidden="true"
				/>
			</div>

			<div class="guestbook-composer__actions">
				<span class="guestbook-composer__count">
					{i18n(I18nKey.gbCharCount)
						.replace("{count}", String(draft.length))
						.replace("{max}", String(MAX_DRAFT_LENGTH))}
				</span>
				{#if authUser}
					<span
						class:is-admin={authUser.type === "administrator"}
						class="guestbook-composer__identity-summary"
						tabindex="0"
						aria-label={i18n(I18nKey.gbCurrentUserAria).replace(
							"{name}",
							authName,
						)}
					>
						<span
							class="guestbook-composer__identity-label guestbook-composer__identity-label--desktop"
						>
							{authUser.type === "administrator"
								? i18n(I18nKey.gbAdminRole)
								: i18n(I18nKey.gbLoggedIn)} · {authName}
						</span>
						<span
							class="guestbook-composer__identity-label guestbook-composer__identity-label--mobile"
						>
							{authUser.type === "administrator"
								? i18n(I18nKey.gbAdminRole)
								: formatMobileIdentityName(authName)}
						</span>
						<span class="guestbook-composer__identity-tooltip" role="tooltip">
							<span>{i18n(I18nKey.gbCurrentUser).replace("{name}", authName)}</span>
						</span>
					</span>
				{:else if loginMode !== "force"}
					<span
						class="guestbook-composer__identity-summary"
						tabindex="0"
						aria-label={hasGuestProfile
							? i18n(I18nKey.gbGuestProfileAriaFilled)
									.replace("{nick}", profile.nick)
									.replace(
										"{mail}",
										profile.mail || i18n(I18nKey.gbNotFilled),
									)
									.replace(
										"{link}",
										profile.link || i18n(I18nKey.gbNotFilled),
									)
							: i18n(I18nKey.gbGuestProfileAriaEmpty)}
					>
						<span
							class="guestbook-composer__identity-label guestbook-composer__identity-label--desktop"
						>
							{hasGuestProfile ? profile.nick : i18n(I18nKey.none)}
						</span>
						<span
							class="guestbook-composer__identity-label guestbook-composer__identity-label--mobile"
						>
							{hasGuestProfile
								? formatMobileIdentityName(profile.nick)
								: i18n(I18nKey.none)}
						</span>
						<span class="guestbook-composer__identity-tooltip" role="tooltip">
							{#if hasGuestProfile}
								<span>{i18n(I18nKey.gbNicknameTooltip).replace("{value}", profile.nick)}</span>
								<span>{i18n(I18nKey.gbEmailTooltip).replace("{value}", profile.mail || i18n(I18nKey.gbNotFilled))}</span>
								<span>{i18n(I18nKey.gbLinkTooltip).replace("{value}", profile.link || i18n(I18nKey.gbNotFilled))}</span>
							{:else}
								<span>{i18n(I18nKey.gbGuestProfileNotFilled)}</span>
							{/if}
						</span>
					</span>
					<button
						class="guestbook-composer__guest-profile"
						type="button"
						onclick={() => void openGuestProfile()}
						title={hasGuestProfile
							? i18n(I18nKey.gbEditGuestProfile)
							: i18n(I18nKey.gbFillGuestProfile)}
					>
						{i18n(I18nKey.gbGuestAccess)}
					</button>
				{/if}
				{#if loginMode !== "disable"}
					{#if authUser}
						<button
							class="guestbook-composer__login guestbook-composer__login--logout"
							type="button"
							onclick={onLogout}
							title={i18n(I18nKey.gbLogoutWalineTitle)}
						>
							{i18n(I18nKey.logout)}
						</button>
					{:else}
						<button
							class="guestbook-composer__login"
							type="button"
							onclick={onLogin}
							disabled={loggingIn}
						>
							{loggingIn ? i18n(I18nKey.gbLoggingIn) : i18n(I18nKey.login)}
						</button>
					{/if}
				{/if}

				<button
					class="guestbook-composer__send"
					type="button"
					onclick={() => void submitMessage()}
					disabled={inputDisabled || isSending || isUploadingImage}
					aria-busy={isSending}
				>
					{isSending ? i18n(I18nKey.sending) : i18n(I18nKey.send)}
				</button>
			</div>
		</div>

		{#if showEmojiPicker}
			<div
				bind:this={emojiPanel}
				id="guestbook-emoji-picker"
				class="guestbook-composer__emojis"
				role="dialog"
				aria-label={i18n(I18nKey.gbWalineEmojiAria)}
			>
				{#if isLoadingEmojis}
					<div class="guestbook-composer__emoji-state" role="status">
						<LoaderCircle class="is-spinning" size={18} aria-hidden="true" />{i18n(I18nKey.gbLoadingEmoji)}
					</div>
				{:else if emojiError}
					<div class="guestbook-composer__emoji-state" role="alert">
						<span>{emojiError}</span>
						<button type="button" onclick={() => void loadEmojis()}>{i18n(I18nKey.retry)}</button>
					</div>
				{:else if activeEmojiPack}
					<div class="guestbook-composer__emoji-tabs" role="tablist" aria-label={i18n(I18nKey.gbEmojiPacksAria)}>
						{#each emojiPacks as pack, index}
							<button
								type="button"
								role="tab"
								aria-selected={activeEmojiPackIndex === index}
								class:is-active={activeEmojiPackIndex === index}
								onclick={() => (activeEmojiPackIndex = index)}
								title={pack.name}
							>
								<img src={pack.icon} alt={pack.name} loading="lazy" />
							</button>
						{/each}
					</div>
					<div class="guestbook-composer__emoji-grid">
						{#each activeEmojiPack.items as emoji}
							<button
								type="button"
								onclick={() => insertEmoji(emoji)}
								aria-label={i18n(I18nKey.gbInsertEmojiAria).replace(
									"{key}",
									emoji.key,
								)}
								title={emoji.key}
							>
								<img src={emoji.url} alt="" loading="lazy" />
							</button>
						{/each}
					</div>
				{/if}
			</div>
		{/if}
	</div>

	{#if composerError}
		<div class="guestbook-composer__error" role="alert">
			<TriangleAlert size={16} aria-hidden="true" />
			<span>{composerError}</span>
			<button
				type="button"
				onclick={() => onToolError("")}
					aria-label={i18n(I18nKey.gbCloseTip)}
					title={i18n(I18nKey.gbCloseTip)}
			>
				<X size={15} aria-hidden="true" />
			</button>
		</div>
	{/if}
</footer>

<dialog
	bind:this={profileDialog}
	class="privacy-modal guestbook-profile-modal"
	aria-labelledby="guestbook-profile-title"
	onclose={() => {
		profileDialogError = "";
		document.body.style.overflow = "";
	}}
	oncancel={(event) => {
		event.preventDefault();
		closeGuestProfile();
	}}
>
	<div class="privacy-overlay" onclick={closeGuestProfile}></div>
	<form
		class="privacy-panel guestbook-profile-modal__panel"
		onsubmit={(event) => {
			event.preventDefault();
			saveGuestProfile();
		}}
	>
		<div class="privacy-header">
				<h2 id="guestbook-profile-title" class="privacy-title">{i18n(I18nKey.gbGuestProfile)}</h2>
			<button
				class="privacy-close"
				type="button"
				onclick={closeGuestProfile}
				aria-label={i18n(I18nKey.gbCloseGuestProfile)}
			>
				<X size={20} aria-hidden="true" />
			</button>
		</div>
		<div class="privacy-body guestbook-profile-modal__body">
			<label>
				<span>{i18n(I18nKey.gbNickname)}</span>
				<input
					bind:this={profileNickInput}
					bind:value={profileDraft.nick}
					maxlength="30"
					autocomplete="nickname"
					placeholder={i18n(I18nKey.gbNicknamePlaceholder)}
					required
				/>
			</label>
			<label>
				<span>{i18n(I18nKey.gbEmail)}</span>
				<input
					bind:value={profileDraft.mail}
					maxlength="100"
					type="email"
					autocomplete="email"
					placeholder={i18n(I18nKey.gbEmailPlaceholder)}
				/>
			</label>
			<label>
				<span>{i18n(I18nKey.gbLink)}</span>
				<input
					bind:value={profileDraft.link}
					maxlength="200"
					type="url"
					autocomplete="url"
					placeholder={i18n(I18nKey.gbOptional)}
				/>
			</label>
			{#if profileDialogError}
				<p class="guestbook-profile-modal__error" role="alert">
					{profileDialogError}
				</p>
			{/if}
		</div>
		<div class="privacy-footer guestbook-profile-modal__actions">
			<button type="button" onclick={closeGuestProfile}>{i18n(I18nKey.cancel)}</button>
			<button class="privacy-confirm-btn" type="submit">{i18n(I18nKey.gbSaveProfile)}</button>
		</div>
	</form>
</dialog>
