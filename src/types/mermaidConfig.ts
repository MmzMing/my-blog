import type { HostThemePresetName } from "@mermanjs/web";

export type MermaidThemeName = HostThemePresetName;

export type MermaidConfig = {
	lightTheme: MermaidThemeName;
	darkTheme: MermaidThemeName;
};
