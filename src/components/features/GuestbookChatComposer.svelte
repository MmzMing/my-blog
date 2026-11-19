<script lang="ts">
import {
	ArrowUp,
	Keyboard,
	LoaderCircle,
	Mic,
	Plus,
	Reply,
	RotateCcw,
	Smile,
	TriangleAlert,
	UserRound,
	X,
} from "lucide-svelte";
import type { Snippet } from "svelte";
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
	GuestbookSpeechSession,
} from "@/types/guestbook-chat";
import {
	isGuestbookSpeechSupported,
	loadGuestbookEmojiPacks,
	startGuestbookSpeech,
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
	children?: Snippet;
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
	children,
}: Props = $props();

const MAX_DRAFT_LENGTH = 300;
const MAX_REMOTE_IMAGE_SIZE = 5 * 1024 * 1024;
const TEXTAREA_MAX_HEIGHT = 144;
// 与 CSS 里 @media (max-width: 768px) 断点保持一致，改一处要同时改另一处
const MOBILE_MEDIA = "(max-width: 768px)";
// Safari 在 compositionend 之后才派发 Enter 的 keydown，补一段时间拦住选字回车
const COMPOSITION_ENTER_GUARD = 500;
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
let profileCard = $state<HTMLElement | null>(null);
let profileNickInput = $state<HTMLInputElement | null>(null);
let showProfileCard = $state(false);
let showEmojiPicker = $state(false);
let isComposing = $state(false);
let compositionEndedAt = 0;
let isLoadingEmojis = $state(false);
let isUploadingImage = $state(false);
let pendingImage = $state<GuestbookImageAttachment | null>(null);
let emojiError = $state("");
let emojiPacks = $state<GuestbookEmojiPack[]>([]);
let activeEmojiPackIndex = $state(0);
let profileDraft = $state<GuestbookProfile>({ nick: "", mail: "", link: "" });
let profileDialogError = $state("");
let profileSaveTimer: number | null = null;

let isMobile = $state(window.matchMedia(MOBILE_MEDIA).matches);
let editorMode = $state<"text" | "voice">("text");
let keyboardOpen = $state(false);
let isListening = $state(false);
let voiceInterim = $state("");
let voiceButton = $state<HTMLButtonElement | null>(null);
let voiceSession: GuestbookSpeechSession | null = null;
let voiceFinalText = "";
let voiceDiscarded = false;

const inputDisabled = $derived(
	isOffline || (loginMode === "force" && !authUser),
);
const isSendDisabled = $derived(
	inputDisabled ||
		isSending ||
		isUploadingImage ||
		(!draft.trim() && !pendingImage),
);
const authName = $derived(authUser?.display_name || i18n(I18nKey.gbVisitor));
const activeEmojiPack = $derived(emojiPacks[activeEmojiPackIndex] ?? null);
const hasGuestProfile = $derived(profile.nick.trim().length >= 2);
const identityLabel = $derived(
	authUser ? authName : hasGuestProfile ? profile.nick : i18n(I18nKey.login),
);
const textareaPlaceholder = $derived(
	loginMode === "force" && !authUser
		? i18n(I18nKey.gbPlaceholderRequireLogin)
		: i18n(I18nKey.gbPlaceholder),
);
const charCountLabel = $derived(
	i18n(I18nKey.gbCharCount)
		.replace("{count}", String(draft.length))
		.replace("{max}", String(MAX_DRAFT_LENGTH)),
);
const modeToggleLabel = $derived(
	i18n(
		editorMode === "voice"
			? I18nKey.gbSwitchToKeyboard
			: I18nKey.gbSwitchToVoice,
	),
);
async function openGuestProfile() {
	if (profileSaveTimer !== null) {
		window.clearTimeout(profileSaveTimer);
		profileSaveTimer = null;
	}
	profileDraft = { ...profile };
	profileDialogError = "";
	showProfileCard = true;
	await tick();
	profileNickInput?.focus();
}

function closeGuestProfile() {
	flushProfileSave();
	showProfileCard = false;
	profileDialogError = "";
}

function handleDialogLogin() {
	closeGuestProfile();
	onLogin();
}

function handleDialogLogout() {
	closeGuestProfile();
	onLogout();
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

function autoSaveGuestProfile() {
	const nextProfile = {
		nick: profileDraft.nick.trim(),
		mail: profileDraft.mail.trim(),
		link: profileDraft.link.trim(),
	};
	profileDialogError = validateGuestProfile(nextProfile);
	if (profileDialogError) return;
	onProfileChange(nextProfile);
	onToolError("");
}

function flushProfileSave() {
	if (profileSaveTimer !== null) {
		window.clearTimeout(profileSaveTimer);
		profileSaveTimer = null;
	}
	autoSaveGuestProfile();
}

function scheduleProfileSave() {
	if (profileSaveTimer !== null) window.clearTimeout(profileSaveTimer);
	profileSaveTimer = window.setTimeout(() => {
		profileSaveTimer = null;
		autoSaveGuestProfile();
	}, 400);
}

function resetGuestProfile() {
	if (profileSaveTimer !== null) {
		window.clearTimeout(profileSaveTimer);
		profileSaveTimer = null;
	}
	profileDraft = { nick: "", mail: "", link: "" };
	profileDialogError = "";
	onToolError("");
	onProfileChange({ nick: "", mail: "", link: "" });
	void tick().then(() => profileNickInput?.focus());
}

function resizeTextarea() {
	if (!textarea) return;
	const cssMax = Number.parseFloat(getComputedStyle(textarea).maxHeight);
	textarea.style.height = "auto";
	textarea.style.height = `${Math.min(
		textarea.scrollHeight,
		Number.isFinite(cssMax) ? cssMax : TEXTAREA_MAX_HEIGHT,
	)}px`;
}

function handleInput(event: Event) {
	onDraftChange((event.currentTarget as HTMLTextAreaElement).value);
	resizeTextarea();
}

function handleTextareaFocus() {
	keyboardOpen = true;
}

function handleKeydown(event: KeyboardEvent) {
	if (
		event.key !== "Enter" ||
		// 移动端软键盘的回车留给换行（撑出一行以上即自动展开成卡片），发送交给发送按钮
		isMobile ||
		event.shiftKey ||
		// 输入法选字中的回车只用于确认候选词：isComposing 覆盖大部分浏览器，
		// keyCode 229 兜住部分键盘/输入法组合；Safari 在选字结束后才派发 keydown，
		// 再用时间窗拦住紧随其后的确认回车
		event.isComposing ||
		isComposing ||
		event.keyCode === 229 ||
		Date.now() - compositionEndedAt < COMPOSITION_ENTER_GUARD ||
		isUploadingImage ||
		isSendDisabled
	) {
		return;
	}
	event.preventDefault();
	void submitMessage();
}

function handleCompositionStart() {
	isComposing = true;
}

function handleCompositionEnd() {
	isComposing = false;
	compositionEndedAt = Date.now();
}

function handleWindowKeydown(event: KeyboardEvent) {
	if (event.key !== "Escape") return;
	showEmojiPicker = false;
	closeGuestProfile();
}

function handleWindowPointerdown(event: PointerEvent) {
	const target = event.target;
	if (!(target instanceof Node)) return;
	if (!emojiTrigger?.contains(target) && !emojiPanel?.contains(target)) {
		showEmojiPicker = false;
	}
	if (
		showProfileCard &&
		!profileCard?.contains(target) &&
		!(
			target instanceof Element &&
			target.closest(".guestbook-composer__backplate")
		)
	) {
		closeGuestProfile();
	}
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
	if (isSendDisabled) return;
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
	if (!accepted) return;
	pendingImage = null;
	showEmojiPicker = false;
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

function toggleEditorMode() {
	if (editorMode === "voice") {
		editorMode = "text";
		return;
	}
	if (!isGuestbookSpeechSupported()) {
		onToolError(i18n(I18nKey.gbVoiceUnsupported));
		return;
	}
	editorMode = "voice";
	keyboardOpen = false;
	showEmojiPicker = false;
}

function handleVoicePointerdown(event: PointerEvent) {
	if (inputDisabled || voiceSession) return;
	event.preventDefault();
	voiceButton?.setPointerCapture(event.pointerId);
	voiceFinalText = "";
	voiceInterim = "";
	voiceDiscarded = false;
	onToolError("");
	// 识别语种跟随浏览器界面语言，而不是站点留言组件的展示语种
	voiceSession = startGuestbookSpeech(navigator.language, {
		onText: (finalText, interimText) => {
			voiceFinalText = finalText;
			voiceInterim = interimText;
		},
		onFailure: (failure) => {
			voiceDiscarded = true;
			onToolError(
				i18n(
					failure === "denied"
						? I18nKey.gbVoiceMicDenied
						: I18nKey.gbVoiceFailed,
				),
			);
		},
		onEnd: () => {
			voiceSession = null;
			isListening = false;
			voiceInterim = "";
			if (!voiceDiscarded && voiceFinalText) insertContent(voiceFinalText);
			voiceFinalText = "";
		},
	});
	if (!voiceSession) {
		onToolError(i18n(I18nKey.gbVoiceUnsupported));
		return;
	}
	isListening = true;
}

function handleVoicePointerup() {
	voiceSession?.stop();
}

function handleVoicePointercancel() {
	voiceDiscarded = true;
	voiceSession?.abort();
}

$effect(() => {
	const query = window.matchMedia(MOBILE_MEDIA);
	isMobile = query.matches;
	const handleChange = (event: MediaQueryListEvent) => {
		isMobile = event.matches;
		if (!event.matches) {
			editorMode = "text";
			keyboardOpen = false;
		}
	};
	query.addEventListener("change", handleChange);
	return () => query.removeEventListener("change", handleChange);
});

// 草稿恢复后按内容重新量一次高度，输入框始终自适应
$effect(() => {
	draft;
	if (textarea) resizeTextarea();
});

$effect(() => () => {
	voiceSession?.abort();
	voiceSession = null;
	if (profileSaveTimer !== null) {
		window.clearTimeout(profileSaveTimer);
		profileSaveTimer = null;
	}
});
</script>

<svelte:window
	onkeydown={handleWindowKeydown}
	onpointerdown={handleWindowPointerdown}
/>

{#snippet modeToggleButton()}
	<button
		class="guestbook-composer__mode"
		type="button"
		onclick={toggleEditorMode}
		aria-label={modeToggleLabel}
		data-tooltip={modeToggleLabel}
		disabled={inputDisabled}
	>
		{#if editorMode === "voice"}
			<Keyboard size={20} aria-hidden="true" />
		{:else}
			<Mic size={20} aria-hidden="true" />
		{/if}
	</button>
{/snippet}

{#snippet emojiTriggerButton()}
	<button
		bind:this={emojiTrigger}
		type="button"
		class:is-active={showEmojiPicker}
		onclick={toggleEmojiPicker}
		aria-label={i18n(I18nKey.gbEmojiAria)}
		aria-expanded={showEmojiPicker}
		aria-controls="guestbook-emoji-picker"
		data-tooltip={i18n(I18nKey.emoji)}
		disabled={inputDisabled}
	>
		<Smile size={20} aria-hidden="true" />
	</button>
{/snippet}

{#snippet imageUploadButton()}
	<button
		type="button"
		onclick={openImagePicker}
		aria-label={i18n(I18nKey.gbUploadImageAria)}
		data-tooltip={i18n(I18nKey.image)}
		disabled={inputDisabled || isUploadingImage}
	>
		{#if isUploadingImage}
			<LoaderCircle class="is-spinning" size={20} aria-hidden="true" />
		{:else}
			<Plus size={20} aria-hidden="true" />
		{/if}
	</button>
{/snippet}

{#snippet pendingImagePreview()}
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
{/snippet}

{#snippet sendButton()}
	<button
		class="guestbook-composer__send"
		type="button"
		onclick={() => void submitMessage()}
		disabled={isSendDisabled}
		aria-busy={isSending}
		aria-label={i18n(I18nKey.send)}
		title={i18n(I18nKey.send)}
	>
		{#if isSending}
			<LoaderCircle class="is-spinning" size={18} aria-hidden="true" />
		{:else}
			<ArrowUp size={18} aria-hidden="true" />
		{/if}
	</button>
{/snippet}

{#snippet identityChip()}
	<button
		class="guestbook-composer__identity"
		type="button"
		onclick={() => void openGuestProfile()}
		aria-expanded={showProfileCard}
		aria-controls="guestbook-profile-card"
		title={i18n(I18nKey.gbGuestProfile)}
	>
		<UserRound size={15} aria-hidden="true" />
		{#if authUser?.type === "administrator"}
			<span class="guestbook-composer__identity-role">
				{i18n(I18nKey.gbAdminRole)}
			</span>
		{/if}
		<span class="guestbook-composer__identity-name">{identityLabel}</span>
	</button>
{/snippet}

{#snippet emojiPickerPanel()}
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
{/snippet}

<div class="guestbook-composer-host">
	<div class="guestbook-composer__backplate" class:is-open={showProfileCard}>
		<div class="guestbook-composer__backplate-bar">
			{@render identityChip()}
			<div class="guestbook-composer__backplate-meta">
				{#if !showProfileCard}
					<span class="guestbook-composer__backplate-count">{charCountLabel}</span>
				{/if}
				{#if showProfileCard && !authUser}
					<button
						class="guestbook-composer__profile-reset"
						type="button"
						onclick={resetGuestProfile}
						aria-label={i18n(I18nKey.gbResetProfile)}
						title={i18n(I18nKey.gbResetProfile)}
					>
						<RotateCcw size={15} aria-hidden="true" />
					</button>
				{/if}
				{#if showProfileCard}
					<button
						class="guestbook-composer__profile-close"
						type="button"
						onclick={closeGuestProfile}
						aria-label={i18n(I18nKey.gbCloseGuestProfile)}
					>
						<X size={16} aria-hidden="true" />
					</button>
				{/if}
			</div>
		</div>

		<div
			class="guestbook-composer__backplate-panel"
			aria-hidden={!showProfileCard}
			inert={!showProfileCard}
		>
			<form
				bind:this={profileCard}
				id="guestbook-profile-card"
				class="guestbook-composer__profile"
				aria-label={i18n(I18nKey.gbGuestProfile)}
				onsubmit={(event) => {
					event.preventDefault();
					flushProfileSave();
				}}
			>
				<div class="guestbook-profile-modal__body">
					{#if authUser}
						<p class="guestbook-profile-modal__signed">
							{authUser.type === "administrator"
								? i18n(I18nKey.gbAdminRole)
								: i18n(I18nKey.gbLoggedIn)}
							· {authName}
						</p>
						<button
							class="guestbook-composer__profile-logout"
							type="button"
							onclick={handleDialogLogout}
						>
							{i18n(I18nKey.logout)}
						</button>
					{:else if loginMode === "force"}
						<button
							class="guestbook-composer__profile-login"
							type="button"
							onclick={handleDialogLogin}
							disabled={loggingIn}
						>
							{loggingIn ? i18n(I18nKey.gbLoggingIn) : i18n(I18nKey.login)}
						</button>
					{:else}
						<label>
							<span>{i18n(I18nKey.gbNickname)}</span>
							<input
								bind:this={profileNickInput}
								bind:value={profileDraft.nick}
								oninput={scheduleProfileSave}
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
								oninput={scheduleProfileSave}
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
								oninput={scheduleProfileSave}
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
						{#if loginMode === "enable"}
							<div class="guestbook-profile-modal__login-entry">
								<span class="guestbook-profile-modal__divider" aria-hidden="true">
									{i18n(I18nKey.gbAccountLogin)}
								</span>
								<button
									type="button"
									onclick={handleDialogLogin}
									disabled={loggingIn}
								>
									{loggingIn ? i18n(I18nKey.gbLoggingIn) : i18n(I18nKey.login)}
								</button>
							</div>
						{/if}
					{/if}
				</div>
			</form>
		</div>
	</div>

	<footer
		class="guestbook-composer"
		class:guestbook-composer--mobile={isMobile}
		class:is-keyboard-open={keyboardOpen}
	>
	{#if replyTarget}
		<div class="guestbook-composer__reply">
			<span class="guestbook-composer__reply-icon" aria-hidden="true">
				<Reply size={28} />
			</span>
			<div>
				<span>{i18n(I18nKey.gbComposerReplyTo).replace("{nick}", replyTarget.nick)}</span>
				<small
					>{replyTarget.body
						.replace(/<[^>]*>/gu, "")
						.trim()
						.slice(0, 80)}</small
				>
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

	<div class="guestbook-composer__editor" class:is-listening={isListening}>
		{#if isMobile && editorMode === "voice"}
			<button
				bind:this={voiceButton}
				class="guestbook-composer__voice"
				type="button"
				onpointerdown={handleVoicePointerdown}
				onpointerup={handleVoicePointerup}
				onpointercancel={handleVoicePointercancel}
				oncontextmenu={(event) => event.preventDefault()}
				disabled={inputDisabled}
			>
				{isListening
					? voiceInterim || i18n(I18nKey.gbVoiceReleaseToSend)
					: i18n(I18nKey.gbVoiceHoldToTalk)}
			</button>
		{:else}
			<textarea
				bind:this={textarea}
				value={draft}
				oninput={handleInput}
				onkeydown={handleKeydown}
				onfocus={handleTextareaFocus}
				onblur={() => (keyboardOpen = false)}
				oncompositionstart={handleCompositionStart}
				oncompositionend={handleCompositionEnd}
				rows="2"
				maxlength={MAX_DRAFT_LENGTH}
				placeholder={textareaPlaceholder}
				aria-label={i18n(I18nKey.gbComposerAria)}
				disabled={inputDisabled}
			></textarea>
		{/if}

		{@render pendingImagePreview()}

		<input
			bind:this={imageInput}
			class="guestbook-composer__file-input"
			type="file"
			accept="image/png,image/jpeg,image/gif,image/webp"
			onchange={handleImageSelection}
			tabindex="-1"
			aria-hidden="true"
		/>

		<div class="guestbook-composer__footer">
			<div class="guestbook-composer__tools">
				{@render imageUploadButton()}
				{@render emojiTriggerButton()}
				{@render children?.()}
			</div>

			<div class="guestbook-composer__actions">
				{#if isMobile}
					{@render modeToggleButton()}
				{/if}
				{@render sendButton()}
			</div>
		</div>

		{@render emojiPickerPanel()}
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
</div>
