/** 文章顶部与目录底部共用分享入口；系统分享必须直接在点击调用链里发起。 */
export function mountPostShare(): () => void {
	const main = document.getElementById("swup-container");
	const menu = main?.querySelector<HTMLElement>(".post-hero__share-menu");
	const dialog = menu?.querySelector<HTMLDialogElement>(
		"[data-post-share-dialog]",
	);
	if (!main || !menu || !dialog) return () => {};

	const abortController = new AbortController();
	const { signal } = abortController;
	const triggers = main.querySelectorAll<HTMLButtonElement>(
		"[data-post-share-native]",
	);
	const copyButton = dialog.querySelector<HTMLButtonElement>(
		"[data-post-share-copy]",
	);
	const copyLabel = copyButton?.querySelector<HTMLElement>(
		"[data-post-share-copy-label]",
	);
	const status = dialog.querySelector<HTMLElement>("[data-post-share-status]");
	const urlInput = dialog.querySelector<HTMLInputElement>(
		"[data-post-share-url]",
	);
	const shareData = {
		title: menu.dataset.shareTitle || "",
		text: menu.dataset.shareText || "",
		url: menu.dataset.shareUrl || "",
	};
	let isSharing = false;
	let lastTrigger: HTMLButtonElement | null = null;
	let copyResetTimer: ReturnType<typeof setTimeout> | null = null;

	const openDialog = (trigger: HTMLButtonElement): void => {
		if (signal.aborted) return;
		lastTrigger = trigger;
		if (!dialog.open) dialog.showModal();
	};

	const share = async (trigger: HTMLButtonElement): Promise<void> => {
		if (isSharing) return;
		if (typeof navigator.share !== "function") {
			openDialog(trigger);
			return;
		}
		isSharing = true;
		try {
			// 调用前不做请求、图片获取等异步操作，保留浏览器的用户激活状态。
			await navigator.share(shareData);
		} catch (error) {
			// 取消系统分享是正常操作，不接着弹出另一个窗口。
			if (error instanceof Error && error.name === "AbortError") return;
			openDialog(trigger);
		} finally {
			isSharing = false;
		}
	};

	triggers.forEach((trigger) => {
		trigger.addEventListener("click", () => void share(trigger), { signal });
	});
	dialog
		.querySelector<HTMLButtonElement>("[data-post-share-close]")
		?.addEventListener("click", () => dialog.close(), { signal });
	dialog.addEventListener(
		"click",
		(event) => {
			if (event.target !== dialog) return;
			const rect = dialog.getBoundingClientRect();
			if (
				event.clientX < rect.left ||
				event.clientX > rect.right ||
				event.clientY < rect.top ||
				event.clientY > rect.bottom
			) {
				dialog.close();
			}
		},
		{ signal },
	);
	dialog.addEventListener(
		"close",
		() => {
			if (lastTrigger?.isConnected) lastTrigger.focus();
		},
		{ signal },
	);

	copyButton?.addEventListener(
		"click",
		async () => {
			try {
				await navigator.clipboard.writeText(shareData.url);
				if (signal.aborted) return;
				const copied = copyButton.dataset.copiedLabel || "";
				if (copyLabel) copyLabel.textContent = copied;
				if (status) status.textContent = copied;
				if (copyResetTimer) clearTimeout(copyResetTimer);
				copyResetTimer = setTimeout(() => {
					copyResetTimer = null;
					if (copyLabel)
						copyLabel.textContent = copyButton.dataset.copyLabel || "";
					if (status) status.textContent = "";
				}, 1600);
			} catch {
				if (signal.aborted) return;
				if (status) status.textContent = copyButton.dataset.failedLabel || "";
				urlInput?.focus();
				urlInput?.select();
			}
		},
		{ signal },
	);

	return () => {
		abortController.abort();
		if (copyResetTimer) clearTimeout(copyResetTimer);
		if (dialog.open) dialog.close();
	};
}
