import I18nKey from "../i18n/i18nKey";
import { i18n } from "../i18n/translation";
import { LinkPreset, type NavBarLink } from "../types/config";

export const LinkPresets: { [key in LinkPreset]: NavBarLink } = {
	[LinkPreset.Home]: {
		name: i18n(I18nKey.home),
		url: "/",
		icon: "material-symbols:home",
	},
	[LinkPreset.About]: {
		name: i18n(I18nKey.about),
		url: "/about/",
		icon: "material-symbols:person",
	},
	[LinkPreset.Archive]: {
		name: i18n(I18nKey.archive),
		url: "/archive/",
		icon: "material-symbols:inventory-2",
	},
	[LinkPreset.PostList]: {
		name: i18n(I18nKey.postList),
		url: "/list/",
		icon: "material-symbols:list-alt-outline-rounded",
	},
	[LinkPreset.Friends]: {
		name: i18n(I18nKey.friends),
		url: "/friends/",
		icon: "material-symbols:group",
	},
	[LinkPreset.Sponsor]: {
		name: i18n(I18nKey.sponsor),
		url: "/sponsor/",
		icon: "material-symbols:favorite",
	},
	[LinkPreset.Guestbook]: {
		name: i18n(I18nKey.guestbook),
		url: "/guestbook/",
		icon: "material-symbols:chat",
	},
	[LinkPreset.Bangumi]: {
		name: i18n(I18nKey.bangumi),
		url: "/bangumi/",
		icon: "material-symbols:movie",
	},
	[LinkPreset.Gallery]: {
		name: i18n(I18nKey.gallery),
		url: "/gallery/",
		icon: "material-symbols:photo-library",
	},
	[LinkPreset.Collections]: {
		name: i18n(I18nKey.collections),
		url: "/collections/",
		icon: "material-symbols:bookmark",
	},
	[LinkPreset.Stats]: {
		name: i18n(I18nKey.stats),
		url: "/stats/",
		icon: "material-symbols:bar-chart",
	},
	[LinkPreset.Categories]: {
		name: "图谱",
		url: "/categories/",
		icon: "material-symbols:hub-outline",
	},
	[LinkPreset.Tags]: {
		name: i18n(I18nKey.tags),
		url: "/tags/",
		icon: "material-symbols:label",
	},
	[LinkPreset.ContactMe]: {
		name: i18n(I18nKey.contactMe),
		url: "/contact/",
		icon: "material-symbols:mail",
	},
	[LinkPreset.QQGroup]: {
		name: i18n(I18nKey.qqGroup),
		url: "https://qm.qq.com/q/2R07cjGTZ0",
		icon: "fa7-brands:qq",
		external: true,
	},
	[LinkPreset.NavPosts]: {
		name: i18n(I18nKey.navPosts),
		url: "/list/",
		icon: "material-symbols:article",
	},
	[LinkPreset.NavMy]: {
		name: i18n(I18nKey.navMy),
		url: "/my/",
		icon: "material-symbols:person",
	},
	[LinkPreset.Music]: {
		name: i18n(I18nKey.music),
		url: "/music/",
		icon: "material-symbols:graphic-eq-rounded",
	},
	[LinkPreset.NavLinks]: {
		name: i18n(I18nKey.navLinks),
		// 父项有子菜单时渲染为按钮，不使用该 url；此处保持与主要子项一致
		url: "/collections/",
		icon: "material-symbols:explore",
	},
};
