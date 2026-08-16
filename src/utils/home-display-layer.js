export const MOBILE_REMOVAL_WIDTH = 768;
export const DESKTOP_MEDIA_QUERY = `(min-width: ${MOBILE_REMOVAL_WIDTH + 1}px)`;
const DISPLAY_MIN_SCROLL_VIEWPORTS = 4;

/**
 * 计算展示层 pin 的滚动距离。
 * 取配置值与「最小视口倍数」中的较大者，确保动画有足够展开空间。
 */
export function getDisplayPinEndDistance(
	configuredDistance,
	viewportHeight,
	minViewportMultiplier = DISPLAY_MIN_SCROLL_VIEWPORTS,
) {
	const configured = Number(configuredDistance);
	const viewport = Number(viewportHeight);
	const fallback = Math.round(
		(Number.isFinite(viewport) && viewport > 0 ? viewport : 0) *
			minViewportMultiplier,
	);

	return Math.max(Number.isFinite(configured) ? configured : 0, fallback);
}
