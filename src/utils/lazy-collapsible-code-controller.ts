const LAZY_FRAME_SELECTOR = ".ec-collapse[data-ec-lazy-code]";
const LAZY_TEMPLATE_SELECTOR = "template.ec-collapse__lazy-template";
const TOGGLE_SELECTOR = ".ec-collapse__toggle, .ec-collapse__header-toggle";

declare global {
	interface Window {
		__lazyCollapsibleCodeBound?: boolean;
	}
}

function getLazyTemplate(frame: HTMLElement): HTMLTemplateElement | null {
	return frame.querySelector<HTMLTemplateElement>(LAZY_TEMPLATE_SELECTOR);
}

function prepareTemplate(template: HTMLTemplateElement): void {
	const encodedHtml = template.dataset.deferredHtml;
	if (!encodedHtml) return;

	const binaryHtml = atob(encodedHtml);
	const bytes = Uint8Array.from(binaryHtml, (character) =>
		character.charCodeAt(0),
	);
	template.innerHTML = new TextDecoder().decode(bytes);
	delete template.dataset.deferredHtml;
}

function materializeCode(frame: HTMLElement): void {
	const template = getLazyTemplate(frame);
	const code = template?.parentElement;
	if (!template || !code) return;

	prepareTemplate(template);
	if (template.content.childNodes.length === 0) return;

	code.insertBefore(template.content, template);
	frame.dataset.ecLazyMaterialized = "true";
}

function dematerializeCode(frame: HTMLElement): void {
	if (!frame.classList.contains("ec-collapse--collapsed")) return;

	const template = getLazyTemplate(frame);
	const code = template?.parentElement;
	if (!template || !code) return;

	const previewLines = Number.parseInt(
		frame.dataset.collapsePreviewLines ?? "8",
		10,
	);
	const codeLines = Array.from(code.children).filter((child) =>
		child.classList.contains("ec-line"),
	);

	for (const line of codeLines.slice(previewLines)) {
		template.content.appendChild(line);
	}
	delete frame.dataset.ecLazyMaterialized;
}

function handleToggleClick(event: MouseEvent): void {
	if (!(event.target instanceof Element)) return;

	const toggle = event.target.closest(TOGGLE_SELECTOR);
	const frame = toggle?.closest<HTMLElement>(LAZY_FRAME_SELECTOR);
	if (!frame) return;

	// The collapsible plugin handles the same click at the button. Capture first so
	// its existing state, line-number and accessibility behavior stays unchanged.
	materializeCode(frame);
	queueMicrotask(() => {
		if (frame.isConnected) dematerializeCode(frame);
	});
}

export function installLazyCollapsibleCodeController(): void {
	if (window.__lazyCollapsibleCodeBound) return;

	window.__lazyCollapsibleCodeBound = true;
	document.addEventListener("click", handleToggleClick, true);
}
