export function countReadableCharacters(body = "") {
	const text = String(body)
		.replace(/```[\s\S]*?```/g, "")
		.replace(/`[^`]*`/g, "")
		.replace(/\s+/g, " ")
		.trim();
	const cn = text.match(/[一-龥]/g) || [];
	const en = text.match(/[a-zA-Z]/g) || [];
	return cn.length + en.length;
}

export function formatCompactNumber(value) {
	if (value === null || value === undefined || Number.isNaN(Number(value))) {
		return "--";
	}
	const number = Number(value);
	if (Math.abs(number) < 1000) return String(number);
	const compact = number / 1000;
	const rounded = Number.isInteger(compact)
		? compact.toFixed(0)
		: compact.toFixed(1);
	return `${rounded}k`;
}
