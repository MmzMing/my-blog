import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";
import { glob } from "glob";

export type PostFile = {
	slug: string;
	draft: boolean;
	password: boolean;
};

/** 读取文章文件的最小元数据，供构建外脚本复用。 */
export async function loadPostFiles(cwd = process.cwd()): Promise<PostFile[]> {
	const files = await glob("src/content/posts/**/*.{md,mdx}", { cwd });
	const posts: PostFile[] = [];

	for (const file of files.sort()) {
		const fullPath = path.resolve(cwd, file);
		const { data } = matter(fs.readFileSync(fullPath, "utf-8"));
		const normalized = file.replaceAll("\\", "/");
		const slug = normalized
			.replace(/^src\/content\/posts\//, "")
			.replace(/\.(md|mdx)$/i, "");

		posts.push({
			slug,
			draft: data.draft === true,
			password: Boolean(data.password),
		});
	}

	return posts;
}
