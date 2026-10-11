<script lang="ts">
import {
	ArrowUp,
	ImagePlus,
	Keyboard,
	LoaderCircle,
	Mic,
	Plus,
	Reply,
	Smile,
	TriangleAlert,
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
const MIN_MESSAGE_PANE_HEIGHT = 128;
const RESIZE_KEYBOARD_STEP = 16;
const TEXTAREA_MAX_HEIGHT = 144;
// 与 CSS 里 @media (max-width: 768px) 断点保持一致，改一处要同时改另一处
const MOBILE_MEDIA = "(max-width: 768px)";
const MORPH_DURATION = 320;
const MORPH_EASING = "cubic-bezier(0.22, 1, 0.36, 1)";
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

type ComposerShape = "pill" | "card";

let isMobile = $state(window.matchMedia(MOBILE_MEDIA).matches);
let shape = $state<ComposerShape>("pill");
let editorMode = $state<"text" | "voice">("text");
let keyboardOpen = $state(false);
let isListening = $state(false);
let voiceInterim = $state("");
let shellEl = $state<HTMLDivElement | null>(null);
let voiceButton = $state<HTMLButtonElement | null>(null);
let voiceSession: GuestbookSpeechSession | null = null;
let voiceFinalText = "";
let voiceDiscarded = false;
let morphAnimations: Animation[] = [];
let morphToken = 0;

function stopMorphAnimations() {
	for (const animation of morphAnimations) animation.cancel();
	morphAnimations = [];
}

const inputDisabled = $derived(
	isOffline || (loginMode === "force" && !authUser),
);
const authName = $derived(authUser?.display_name || i18n(I18nKey.gbVisitor));
const activeEmojiPack = $derived(emojiPacks[activeEmojiPackIndex] ?? null);
const hasGuestProfile = $derived(profile.nick.trim().length >= 2);
const identityLabel = $derived(
	authUser
		? authName
		: hasGuestProfile
			? profile.nick
			: i18n(I18nKey.gbNotLoggedIn),
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
const expandLabel = $derived(
	i18n(shape === "pill" ? I18nKey.gbMoreTools : I18nKey.gbCollapseInput),
);

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
	if (isMobile) {
		if (shape === "pill") {
			// 椭圆态由 CSS 锁死单行，内容撑出一行才展开成卡片
			textarea.style.height = "";
			if (textarea.scrollHeight > textarea.clientHeight + 1) {
				void setShape("card");
			}
			return;
		}
		const cssMax = Number.parseFloat(getComputedStyle(textarea).maxHeight);
		textarea.style.height = "auto";
		textarea.style.height = `${Math.min(
			textarea.scrollHeight,
			Number.isFinite(cssMax) ? cssMax : TEXTAREA_MAX_HEIGHT,
		)}px`;
		return;
	}
	if (manualTextareaHeight !== null) return;
	textarea.style.height = "auto";
	textarea.style.height = `${Math.min(textarea.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
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

function prefersReducedMotion(): boolean {
	return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * 椭圆态的 9999px 圆角直接补间会长时间"看着没变"、最后一下才收成方角，
 * 换成实际半高后收角过程才和高度同步。
 */
function morphRadius(target: ComposerShape, height: number, computed: string) {
	return target === "pill" ? `${height / 2}px` : computed;
}

/**
 * 椭圆条 ↔ 卡片切换。两态高度都由 CSS 决定，切换时把旧高度先钉在行内样式上再换形态，
 * 否则新形态的自然高度会先被浏览器画一帧——收缩时看到的那一下抖就是它。
 * 高度、圆角与输入框用同一段时长和缓动一起补间，动画期间加 is-morphing 裁掉溢出。
 */
async function setShape(next: ComposerShape) {
	if (next === shape) return;
	const shell = shellEl;
	if (!shell) {
		shape = next;
		return;
	}
	stopMorphAnimations();
	const token = ++morphToken;
	const fromHeight = shell.offsetHeight;
	const fromTextareaHeight = textarea?.offsetHeight ?? 0;
	const fromRadius = morphRadius(
		shape,
		fromHeight,
		getComputedStyle(shell).borderRadius,
	);
	shell.style.height = `${fromHeight}px`;
	shell.classList.add("is-morphing");
	shape = next;
	await tick();
	if (textarea) {
		if (next === "pill") textarea.style.height = "";
		else resizeTextarea();
	}
	const toTextareaHeight = textarea?.offsetHeight ?? 0;
	shell.style.height = "auto";
	const toHeight = shell.offsetHeight;
	shell.style.height = `${fromHeight}px`;
	const toRadius = morphRadius(
		next,
		toHeight,
		getComputedStyle(shell).borderRadius,
	);

	const finish = () => {
		if (token !== morphToken) return;
		shell.style.height = "";
		shell.classList.remove("is-morphing");
	};
	if (prefersReducedMotion() || fromHeight === toHeight) {
		finish();
		return;
	}

	const timing: KeyframeAnimationOptions = {
		duration: MORPH_DURATION,
		easing: MORPH_EASING,
	};
	morphAnimations = [
		shell.animate(
			[
				{ height: `${fromHeight}px`, borderRadius: fromRadius },
				{ height: `${toHeight}px`, borderRadius: toRadius },
			],
			timing,
		),
	];
	if (textarea && fromTextareaHeight !== toTextareaHeight) {
		morphAnimations.push(
			textarea.animate(
				[
					{ height: `${fromTextareaHeight}px` },
					{ height: `${toTextareaHeight}px` },
				],
				timing,
			),
		);
	}
	void Promise.allSettled(morphAnimations.map((item) => item.finished)).then(
		finish,
	);
}

function handleInput(event: Event) {
	onDraftChange((event.currentTarget as HTMLTextAreaElement).value);
	resizeTextarea();
}

function handleKeydown(event: KeyboardEvent) {
	if (
		event.key !== "Enter" ||
		// 移动端软键盘的回车留给换行（撑出一行以上即自动展开成卡片），发送交给发送按钮
		isMobile ||
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
	if (!accepted) return;
	pendingImage = null;
	if (isMobile) {
		showEmojiPicker = false;
		void setShape("pill");
	}
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
		// 待发图片只在卡片态露出，附件成功后展开，避免用户看不到已选中的图
		if (isMobile) void setShape("card");
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
			shape = "pill";
			editorMode = "text";
			keyboardOpen = false;
		}
	};
	query.addEventListener("change", handleChange);
	return () => query.removeEventListener("change", handleChange);
});

$effect(() => () => {
	voiceSession?.abort();
	voiceSession = null;
	stopMorphAnimations();
});
</script>

<svelte:window
	onkeydown={handleWindowKeydown}
	onpointerdown={handleWindowPointerdown}
	onresize={handleWindowResize}
/>

{#snippet emojiTriggerButton()}
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
{/snippet}

{#snippet imageUploadButton()}
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
		disabled={inputDisabled || isSending || isUploadingImage}
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
		title={i18n(I18nKey.gbGuestProfile)}
	>
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

<footer
	class="guestbook-composer"
	class:guestbook-composer--mobile={isMobile}
	class:is-keyboard-open={keyboardOpen}
>
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

	{#if isMobile}
		<div class="guestbook-composer__stage">
			{@render identityChip()}
			<div
				bind:this={shellEl}
				class="guestbook-composer__shell"
				class:is-listening={isListening}
				data-shape={shape}
			>
				{@render pendingImagePreview()}

				<div class="guestbook-composer__bar guestbook-composer__input">
					<button
						class="guestbook-composer__mode"
						type="button"
						onclick={toggleEditorMode}
						aria-label={modeToggleLabel}
						title={modeToggleLabel}
						disabled={inputDisabled}
					>
						{#if editorMode === "voice"}
							<Keyboard size={20} aria-hidden="true" />
						{:else}
							<Mic size={20} aria-hidden="true" />
						{/if}
					</button>

					{#if editorMode === "voice"}
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
							onfocus={() => (keyboardOpen = true)}
							onblur={() => (keyboardOpen = false)}
							oncompositionstart={() => (isComposing = true)}
							oncompositionend={() => (isComposing = false)}
							rows="1"
							maxlength={MAX_DRAFT_LENGTH}
							placeholder={textareaPlaceholder}
							aria-label={i18n(I18nKey.gbComposerAria)}
							disabled={inputDisabled}
						></textarea>
					{/if}

					{@render emojiTriggerButton()}

					{#if shape === "pill" && draft.trim()}
						{@render sendButton()}
					{:else}
						<button
							class="guestbook-composer__expand"
							class:is-expanded={shape === "card"}
							type="button"
							onclick={() =>
								void setShape(shape === "pill" ? "card" : "pill")}
							aria-label={expandLabel}
							title={expandLabel}
							disabled={inputDisabled}
						>
							<Plus size={20} aria-hidden="true" />
						</button>
					{/if}
				</div>

				{#if shape === "card"}
					<div class="guestbook-composer__bar guestbook-composer__tray">
						<div class="guestbook-composer__tools">
							{@render imageUploadButton()}
							{@render children?.()}
						</div>
						<div class="guestbook-composer__actions">
							{@render sendButton()}
						</div>
					</div>
				{/if}

				{@render emojiPickerPanel()}
			</div>
		</div>
	{:else}
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
				maxlength={MAX_DRAFT_LENGTH}
				placeholder={textareaPlaceholder}
				aria-label={i18n(I18nKey.gbComposerAria)}
				disabled={inputDisabled}
			></textarea>

			{@render pendingImagePreview()}

			<span class="guestbook-composer__count">{charCountLabel}</span>

			<div class="guestbook-composer__footer">
				<div class="guestbook-composer__tools">
					{@render emojiTriggerButton()}
					{@render imageUploadButton()}
					{@render children?.()}
				</div>

				<div class="guestbook-composer__actions">
					{@render identityChip()}
					{@render sendButton()}
				</div>
			</div>

			{@render emojiPickerPanel()}
		</div>
	{/if}

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
			{#if authUser}
				<p class="guestbook-profile-modal__signed">
					{authUser.type === "administrator"
						? i18n(I18nKey.gbAdminRole)
						: i18n(I18nKey.gbLoggedIn)}
					· {authName}
				</p>
			{:else if loginMode !== "force"}
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
				{#if loginMode === "enable"}
					<div class="guestbook-profile-modal__login-entry">
						<span class="guestbook-profile-modal__divider" aria-hidden="true">
							{i18n(I18nKey.gbOr)}
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
		<div class="privacy-footer guestbook-profile-modal__actions">
			{#if authUser}
				<button
					class="guestbook-profile-modal__logout"
					type="button"
					onclick={handleDialogLogout}
				>
					{i18n(I18nKey.logout)}
				</button>
				<button class="privacy-confirm-btn" type="button" onclick={closeGuestProfile}>
					{i18n(I18nKey.close)}
				</button>
			{:else if loginMode === "force"}
				<button type="button" onclick={closeGuestProfile}>
					{i18n(I18nKey.cancel)}
				</button>
				<button
					class="privacy-confirm-btn"
					type="button"
					onclick={handleDialogLogin}
					disabled={loggingIn}
				>
					{loggingIn ? i18n(I18nKey.gbLoggingIn) : i18n(I18nKey.login)}
				</button>
			{:else}
				<button type="button" onclick={closeGuestProfile}>
					{i18n(I18nKey.cancel)}
				</button>
				<button class="privacy-confirm-btn" type="submit">
					{i18n(I18nKey.gbSaveProfile)}
				</button>
			{/if}
		</div>
	</form>
</dialog>
