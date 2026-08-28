import type { CoverImageSource } from "./cover-image";

export type ArticleListPost = {
	id: string;
	title: string;
	url: string;
	publishedIso: string;
	publishedTimestamp: number;
	publishedText: string;
	category: string;
	categoryHue: number;
	tags: string[];
	description: string;
	pinned: boolean;
	password: boolean;
	wordCount: number;
	/** 构建期算好的封面数据；为 null 表示这篇文章不渲染封面 */
	cover: CoverImageSource | null;
	apiUrls: string[];
};

export type UmamiPageviewConfig = {
	apiBase: string;
	enabled: boolean;
	shareId: string;
};

export type PaginationItem =
	| {
			kind: "page";
			page: number;
	  }
	| {
			kind: "ellipsis";
	  };
