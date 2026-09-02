import { LinkPresets } from "../constants/link-presets";
import {
	LinkPreset,
	type NavBarConfig,
	type NavBarLink,
	type PersonalSite,
} from "../types/config";
import { siteConfig } from "./siteConfig";

// Logo 下拉资料卡里的「个人网站」列表（图标 + 名字 + 地址）
// 原先挂在 LinkPreset.Feibichi 的「个人主站」外链收编为第一项，该预设已删除。
// name 是站长自维护的站点名（展示在右侧 CTA 上，明文即可）；左侧切换按钮的
// 文案是固定的 i18n 文案（I18nKey.otherSites），不从这里取
const personalSites: PersonalSite[] = [
	{
		name: "个人主站",
		url: "https://www.mmzhiku.xyz/",
		icon: "material-symbols:link",
	},
];

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

	// 4. 导航：原「导航」下拉拆分后的一级项，直接指向工具导航页，页面开关控制显隐
	//    （下拉里的另一项「个人主站」是外链，移到了 Navbar 左段 Logo 的悬停下拉）
	//    文案沿用 I18nKey.navLinks 的既有翻译，不用 collections 的「工具导航」文案
	const linksNav: NavBarLink | null = siteConfig.pages.collections
		? LinkPresets[LinkPreset.NavLinks]
		: null;

	// 5. 统一组装导航栏链接（顺序：主页 → 导航 → 文章 → 联系我 → 其他）
	const links: (NavBarLink | LinkPreset)[] = [
		LinkPreset.Home,
		...(linksNav ? [linksNav] : []),
		...(postsNav ? [postsNav] : []),
		...(contactNav ? [contactNav] : []),
		...(myNav ? [myNav] : []),
	];

	return { links, personalSites };
};

export const navBarConfig: NavBarConfig = buildNavBarConfig();
