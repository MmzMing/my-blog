export const SHUTTER_PANEL_COUNT = 5;
export const MOBILE_REMOVAL_WIDTH = 768;
export const DESKTOP_MEDIA_QUERY = `(min-width: ${MOBILE_REMOVAL_WIDTH + 1}px)`;
export const SHUTTER_PANEL_STEP = 0.5;
export const SHUTTER_MERGE_DELAY = 0.22;

export function getPanelDirection(index) {
	return index % 2 === 0 ? "up" : "down";
}

export function normalizeShutterPanels(panels = []) {
	if (!Array.isArray(panels) || panels.length !== SHUTTER_PANEL_COUNT) {
		throw new Error(
			`Portfolio shutter requires exactly ${SHUTTER_PANEL_COUNT} panels.`,
		);
	}

	return panels.map((panel, index) => ({
		...panel,
		index,
		direction: getPanelDirection(index),
	}));
}

export function getShutterMergeStart(
	panelCount = SHUTTER_PANEL_COUNT,
	panelStep = SHUTTER_PANEL_STEP,
	mergeDelay = SHUTTER_MERGE_DELAY,
) {
	return Number((panelCount * panelStep + mergeDelay).toFixed(2));
}
