export type ArchiveView = "time" | "category" | "tag";

export interface ArchivePost {
	kind: "post";
	id: string;
	title: string;
	url: string;
	date: string;
	dateLabel: string;
	isoDate: string;
	category: string;
	tags: string[];
}

export interface ArchiveGroup {
	kind: "group";
	id: string;
	label: string;
	count: number;
	isOpen: boolean;
	children: ArchiveNode[];
}

export type ArchiveNode = ArchivePost | ArchiveGroup;
export type ArchiveViews = Record<ArchiveView, ArchiveGroup[]>;
