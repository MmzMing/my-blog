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
	imageUrl: string;
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
