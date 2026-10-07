import type { UserInfo } from "@waline/api";

type GuestbookMessageLocalState = "sending" | "failed";

export type GuestbookAuthUser = UserInfo & {
	remember?: boolean;
};

export interface GuestbookProfile {
	nick: string;
	mail: string;
	link: string;
}

export interface GuestbookEmojiItem {
	key: string;
	url: string;
}

export interface GuestbookEmojiPack {
	name: string;
	icon: string;
	items: GuestbookEmojiItem[];
}

export interface GuestbookImageAttachment {
	name: string;
	url: string;
}

export interface GuestbookChatMessage {
	id: string;
	objectId?: number;
	/** 所在线程的根评论 ID，回复子评论时作为 rid 提交 */
	rootId?: number;
	userId?: number;
	nick: string;
	avatar: string;
	link?: string;
	body: string;
	createdAt: number;
	browser?: string;
	os?: string;
	addr?: string;
	label?: string;
	isAdmin: boolean;
	replyToId?: string;
	replyToNick?: string;
	/** 仅本地未发送成功的消息使用，重发时据此还原 pid 目标 */
	replyTargetId?: string;
	/** 改用 pid 之前写进正文的引用标记，编辑时需原样保留 */
	legacyReplyMarker?: string;
	status?: string;
	localState?: GuestbookMessageLocalState;
	failureReason?: string;
}
