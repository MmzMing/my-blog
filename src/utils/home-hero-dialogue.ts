import type { HeroDialogueConfig, HeroDialogueLine } from "@/types/config";

type DialogueMode = "intro" | "topic" | "menu";

type ResolvedDialogueConfig = Required<
	Pick<HeroDialogueConfig, "intro" | "topics">
> & {
	speakers: { host: string; visitor: string };
	menuTitle: string;
	typingSpeed: number;
	autoDelay: number;
};

export type HomeHeroDialogueController = {
	setSceneVisible: (visible: boolean) => void;
	destroy: () => void;
};

type DialogueElements = {
	box: HTMLElement;
	name: HTMLElement;
	text: HTMLElement;
	menu: HTMLUListElement;
	body: HTMLElement;
	footer: HTMLElement | null;
	advance: HTMLButtonElement | null;
	advanceLabel: HTMLElement | null;
	autoButton: HTMLButtonElement | null;
	restoreButton: HTMLButtonElement | null;
};

type DialogueState = {
	root: HTMLElement;
	config: ResolvedDialogueConfig;
	elements: DialogueElements;
	mode: DialogueMode;
	lines: HeroDialogueLine[];
	lineIndex: number;
	topicIndex: number;
	typing: boolean;
	auto: boolean;
	started: boolean;
	sceneVisible: boolean;
	closed: boolean;
	typeTimer: number | null;
	autoTimer: number | null;
	abortController: AbortController;
};

function parseConfig(root: HTMLElement): ResolvedDialogueConfig | null {
	try {
		const raw = JSON.parse(
			root.dataset.dialogue ?? "",
		) as ResolvedDialogueConfig;
		if (
			!raw.speakers ||
			!Array.isArray(raw.intro) ||
			!Array.isArray(raw.topics)
		) {
			return null;
		}
		return raw;
	} catch {
		return null;
	}
}

function clearTypeTimer(state: DialogueState) {
	if (state.typeTimer === null) return;
	window.clearTimeout(state.typeTimer);
	state.typeTimer = null;
}

function clearAutoTimer(state: DialogueState) {
	if (state.autoTimer === null) return;
	window.clearTimeout(state.autoTimer);
	state.autoTimer = null;
}

function clearTimers(state: DialogueState) {
	clearTypeTimer(state);
	clearAutoTimer(state);
}

function setSpeaker(state: DialogueState, speaker?: "host" | "visitor") {
	const resolvedSpeaker = speaker === "visitor" ? "visitor" : "host";
	state.elements.name.textContent = state.config.speakers[resolvedSpeaker];
	state.elements.box.dataset.speaker = resolvedSpeaker;
}

function updateAdvanceLabel(state: DialogueState) {
	const isLastLine = state.lineIndex >= state.lines.length - 1;
	if (state.elements.advanceLabel) {
		state.elements.advanceLabel.textContent = isLastLine
			? "选择话题"
			: "下一句";
	}
	if (state.elements.footer) {
		state.elements.footer.dataset.end = String(isLastLine);
	}
}

function scheduleAutoAdvance(state: DialogueState, advance: () => void) {
	clearAutoTimer(state);
	if (
		!state.auto ||
		!state.sceneVisible ||
		state.closed ||
		state.mode === "menu"
	) {
		return;
	}
	state.autoTimer = window.setTimeout(advance, state.config.autoDelay);
}

function syncDialogueAccessibility(state: DialogueState) {
	const hidden = state.closed || !state.sceneVisible;
	const activeElement = document.activeElement;
	if (
		activeElement instanceof HTMLElement &&
		state.root.contains(activeElement)
	) {
		const restore = state.elements.restoreButton;
		if (state.closed && state.sceneVisible && restore) {
			restore.focus({ preventScroll: true });
		} else {
			activeElement.blur();
		}
	}
	state.root.toggleAttribute("inert", hidden);
	state.root.setAttribute("aria-hidden", String(hidden));
}

function syncRestoreButton(state: DialogueState) {
	const restore = state.elements.restoreButton;
	if (!restore) return;
	const available = state.closed && state.sceneVisible;
	if (!available && document.activeElement === restore) {
		if (state.sceneVisible && !state.closed && state.elements.advance) {
			state.elements.advance.focus({ preventScroll: true });
		} else {
			restore.blur();
		}
	}
	restore.classList.toggle("is-dialogue-closed", available);
	restore.setAttribute("aria-hidden", String(!available));
	restore.tabIndex = available ? 0 : -1;
}

function setClosedState(state: DialogueState, closed: boolean) {
	state.closed = closed;
	state.root.dataset.hidden = String(closed);
	if (closed) {
		syncRestoreButton(state);
		syncDialogueAccessibility(state);
	} else {
		syncDialogueAccessibility(state);
		syncRestoreButton(state);
	}
	if (closed) clearAutoTimer(state);
}

export function initHomeHeroDialogue(
	hero: HTMLElement,
): HomeHeroDialogueController {
	const root = hero.querySelector<HTMLElement>("[data-hero-dialogue]");
	const config = root ? parseConfig(root) : null;
	const box = root?.querySelector<HTMLElement>("[data-dialogue-box]") ?? null;
	const name = root?.querySelector<HTMLElement>("[data-dialogue-name]") ?? null;
	const text = root?.querySelector<HTMLElement>("[data-dialogue-text]") ?? null;
	const menu =
		root?.querySelector<HTMLUListElement>("[data-dialogue-menu]") ?? null;
	const body =
		root?.querySelector<HTMLElement>("[data-dialogue-click]") ?? null;

	if (!root || !config || !box || !name || !text || !menu || !body) {
		return {
			setSceneVisible: () => undefined,
			destroy: () => undefined,
		};
	}

	const abortController = new AbortController();
	const state: DialogueState = {
		root,
		config,
		elements: {
			box,
			name,
			text,
			menu,
			body,
			footer: root.querySelector<HTMLElement>(".home-hero__dialogue-footer"),
			advance: root.querySelector<HTMLButtonElement>("[data-dialogue-advance]"),
			advanceLabel: root.querySelector<HTMLElement>(
				"[data-dialogue-advance-label]",
			),
			autoButton: root.querySelector<HTMLButtonElement>(
				'[data-dialogue-action="auto"]',
			),
			restoreButton: hero.querySelector<HTMLButtonElement>(
				"[data-hero-dialogue-restore]",
			),
		},
		mode: "intro",
		lines: config.intro,
		lineIndex: 0,
		topicIndex: 0,
		typing: false,
		auto: false,
		started: false,
		sceneVisible: false,
		closed: false,
		typeTimer: null,
		autoTimer: null,
		abortController,
	};

	const showMenu = () => {
		clearTimers(state);
		state.mode = "menu";
		state.typing = false;
		state.elements.box.dataset.typing = "false";
		setSpeaker(state, "host");
		state.elements.text.textContent = state.config.menuTitle;
		state.elements.text.hidden = false;
		state.elements.menu.replaceChildren();

		state.config.topics.forEach((topic, topicIndex) => {
			const item = document.createElement("li");
			const button = document.createElement("button");
			const particles = document.createElement("span");
			const label = document.createElement("span");
			button.type = "button";
			button.className = "home-hero__dialogue-menu-item";
			particles.className = "home-hero__dialogue-menu-particles";
			particles.setAttribute("aria-hidden", "true");
			for (let particleIndex = 0; particleIndex < 10; particleIndex += 1) {
				const particle = document.createElement("span");
				particle.className = "home-hero__dialogue-menu-particle";
				particles.appendChild(particle);
			}
			label.className = "home-hero__dialogue-menu-label";
			label.textContent = topic.title;
			button.appendChild(particles);
			button.appendChild(label);
			button.addEventListener("click", (event) => {
				event.stopPropagation();
				state.mode = "topic";
				state.topicIndex = topicIndex;
				state.lines = topic.lines;
				state.lineIndex = 0;
				state.elements.menu.hidden = true;
				playLine(0);
			});
			item.appendChild(button);
			state.elements.menu.appendChild(item);
		});

		state.elements.menu.hidden = state.config.topics.length === 0;
		if (state.elements.footer) state.elements.footer.dataset.end = "false";
		if (state.elements.advanceLabel) {
			state.elements.advanceLabel.textContent = "下一句";
		}
	};

	const advance = () => {
		if (!state.sceneVisible || state.closed || state.mode === "menu") return;
		if (state.typing) {
			clearTypeTimer(state);
			state.elements.text.textContent =
				state.lines[state.lineIndex]?.text ?? "";
			state.typing = false;
			state.elements.box.dataset.typing = "false";
			updateAdvanceLabel(state);
			scheduleAutoAdvance(state, advance);
			return;
		}
		if (state.lineIndex < state.lines.length - 1) {
			playLine(state.lineIndex + 1);
			return;
		}
		showMenu();
	};

	const playLine = (lineIndex: number) => {
		const line = state.lines[lineIndex];
		if (!line) {
			showMenu();
			return;
		}

		clearTimers(state);
		state.lineIndex = lineIndex;
		state.typing = true;
		state.elements.box.dataset.typing = "true";
		state.elements.menu.hidden = true;
		state.elements.text.hidden = false;
		state.elements.text.textContent = "";
		setSpeaker(state, line.speaker);

		const characters = Array.from(line.text);
		let characterIndex = 0;
		const typeNextCharacter = () => {
			if (!state.sceneVisible || state.closed) {
				state.typeTimer = null;
				return;
			}
			if (characterIndex >= characters.length) {
				state.typing = false;
				state.typeTimer = null;
				state.elements.box.dataset.typing = "false";
				updateAdvanceLabel(state);
				scheduleAutoAdvance(state, advance);
				return;
			}
			state.elements.text.textContent += characters[characterIndex];
			characterIndex += 1;
			state.typeTimer = window.setTimeout(
				typeNextCharacter,
				state.config.typingSpeed,
			);
		};
		typeNextCharacter();
	};

	const start = () => {
		if (state.started) return;
		state.started = true;
		if (state.config.intro.length === 0) {
			showMenu();
			return;
		}
		state.mode = "intro";
		state.lines = state.config.intro;
		playLine(0);
	};

	const back = () => {
		if (state.mode === "menu") return;
		if (state.lineIndex > 0) {
			playLine(state.lineIndex - 1);
			return;
		}
		if (state.mode === "topic") showMenu();
	};

	const toggleAuto = () => {
		state.auto = !state.auto;
		state.elements.autoButton?.setAttribute("aria-pressed", String(state.auto));
		state.elements.box.dataset.auto = String(state.auto);
		if (state.auto && !state.typing) {
			scheduleAutoAdvance(state, advance);
		} else if (!state.auto) {
			clearAutoTimer(state);
		}
	};

	body.addEventListener(
		"click",
		(event) => {
			if (!(event.target as Element).closest("button")) advance();
		},
		{ signal: abortController.signal },
	);
	state.elements.advance?.addEventListener("click", advance, {
		signal: abortController.signal,
	});
	root
		.querySelector<HTMLButtonElement>('[data-dialogue-action="back"]')
		?.addEventListener("click", back, { signal: abortController.signal });
	state.elements.autoButton?.addEventListener("click", toggleAuto, {
		signal: abortController.signal,
	});
	root
		.querySelector<HTMLButtonElement>('[data-dialogue-action="hide"]')
		?.addEventListener("click", () => setClosedState(state, true), {
			signal: abortController.signal,
		});
	state.elements.restoreButton?.addEventListener(
		"click",
		() => setClosedState(state, false),
		{ signal: abortController.signal },
	);
	document.addEventListener(
		"keydown",
		(event) => {
			if (event.key === "Escape" && state.sceneVisible && !state.closed) {
				setClosedState(state, true);
			}
		},
		{ signal: abortController.signal },
	);

	setSpeaker(state, "host");
	setClosedState(state, false);

	return {
		setSceneVisible(visible) {
			if (state.sceneVisible === visible) return;
			state.sceneVisible = visible;
			state.root.dataset.sceneVisible = String(visible);
			if (visible && !state.closed) {
				syncDialogueAccessibility(state);
				syncRestoreButton(state);
			} else {
				syncRestoreButton(state);
				syncDialogueAccessibility(state);
			}
			if (visible) {
				start();
				if (state.started && state.typing && state.typeTimer === null) {
					state.elements.text.textContent =
						state.lines[state.lineIndex]?.text ?? "";
					state.typing = false;
					state.elements.box.dataset.typing = "false";
					updateAdvanceLabel(state);
				}
				return;
			}
			clearTimers(state);
		},
		destroy() {
			clearTimers(state);
			abortController.abort();
		},
	};
}
