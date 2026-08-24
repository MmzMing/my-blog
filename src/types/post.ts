/** Post frontmatter data type matching the Zod schema in content.config.ts */
export interface PostData {
	title: string;
	published: Date;
	updated?: Date;
	draft?: boolean;
	description?: string;
	image?: string;
	tags?: string[];
	category?: string | null;
	lang?: string;
	pinned?: boolean;
	author?: string;
	sourceLink?: string;
	licenseName?: string;
	licenseUrl?: string;
	comment?: boolean;
	password?: string;
	passwordHint?: string;
	wikiExclude?: boolean;
	prevTitle: string;
	prevSlug: string;
	nextTitle: string;
	nextSlug: string;
}

/** Collection entry helper with explicitly typed data for use with --isolatedDeclarations */
export interface TypedPostEntry {
	id: string;
	data: PostData;
}
