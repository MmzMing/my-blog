import { LinkPresets } from "../constants/link-presets";
import {
	LinkPreset,
	type NavBarConfig,
	type NavBarLink,
} from "../types/config";
import { siteConfig } from "./siteConfig";

/**
 * 构建导航栏链接配置
 * 遵循企业级代码规范：
 * - 使用 LinkPreset 枚举消除魔法值
 * - 通过 LinkPresets 集中管理链接元数据（i18n、图标、URL）
 * - 页面开关控制可选链接的显隐
 * - 先依次构建各导航项，再统一组装到 links 数组
 */
const buildNavBarConfig = (): NavBarConfig => {
	// 1. 构建文章下拉菜单（子项顺序：文档 → 归档 → 图谱）
	const postsChildren: (NavBarLink | LinkPreset)[] = [];
	if (siteConfig.pages.postList) {
		postsChildren.push(LinkPreset.PostList);
	}
	if (siteConfig.pages.archive) {
		postsChildren.push(LinkPreset.Archive);
	}
	if (siteConfig.pages.categories) {
		postsChildren.push(LinkPreset.Categories);
	}

	// 子项全部关闭时不渲染空的下拉菜单
	const postsNav: NavBarLink | null =
		postsChildren.length > 0
			? {
					...LinkPresets[LinkPreset.NavPosts],
					activePathPrefixes: ["/posts/"],
					children: postsChildren,
				}
			: null;

	// 2. 构建联系我下拉菜单
	const contactChildren: (NavBarLink | LinkPreset)[] = [];
	if (siteConfig.pages.friends) {
		contactChildren.push(LinkPreset.Friends);
	}
	if (siteConfig.pages.guestbook) {
		contactChildren.push(LinkPreset.Guestbook);
	}

	const contactNav: NavBarLink | null =
		contactChildren.length > 0
			? {
					...LinkPresets[LinkPreset.ContactMe],
					children: contactChildren,
				}
			: null;

	// 3. 构建我的下拉菜单
	const myChildren: (NavBarLink | LinkPreset)[] = [];
	if (siteConfig.pages.gallery) {
		myChildren.push(LinkPreset.Gallery);
	}
	if (siteConfig.pages.sponsor) {
		myChildren.push(LinkPreset.Sponsor);
	}
	if (siteConfig.pages.music) {
		myChildren.push(LinkPreset.Music);
	}
	if (siteConfig.pages.about) {
		myChildren.push(LinkPreset.About);
	}

	// 子项全部关闭时不渲染空的下拉菜单
	const myNav: NavBarLink | null =
		myChildren.length > 0
			? {
					...LinkPresets[LinkPreset.NavMy],
					children: myChildren,
				}
			: null;

	// 4. 构建导航下拉菜单（子项顺序：个人主站 → 工具导航）
	// 个人主站是外链、不随页面开关变化，因此下拉至少有一项，无需判空
	const linksChildren: (NavBarLink | LinkPreset)[] = [LinkPreset.Feibichi];
	if (siteConfig.pages.collections) {
		linksChildren.push(LinkPreset.Collections);
	}

	const linksNav: NavBarLink = {
		...LinkPresets[LinkPreset.NavLinks],
		children: linksChildren,
	};

	// 5. 统一组装导航栏链接（顺序：主页 → 导航 → 文章 → 联系我 → 我的）
	const links: (NavBarLink | LinkPreset)[] = [
		LinkPreset.Home,
		linksNav,
		...(postsNav ? [postsNav] : []),
		...(contactNav ? [contactNav] : []),
		...(myNav ? [myNav] : []),
	];

	return { links };
};

export const navBarConfig: NavBarConfig = buildNavBarConfig();
