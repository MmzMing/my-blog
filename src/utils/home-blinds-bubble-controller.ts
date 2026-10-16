/** 一条气泡：text 与 image 至少有一个，weight 为被飘出的相对权重 */
export type BubbleMessage = {
	text?: string;
	image?: string;
	weight?: number;
};

/** 一颗气泡的可写部位：控制器只碰这几个节点，不重建结构 */
export type BubbleSlot = {
	/** 外层：只管横向漂移与落位 */
	root: HTMLElement;
	/** 内层卡面：入场的弹跳打在这一层 */
	body: HTMLElement;
	text: HTMLElement;
	image: HTMLImageElement;
};

/** 同屏气泡飘过一趟的时长区间（秒）：逐条随机，免得一排气泡齐步走 */
const MIN_DURATION = 26;
const MAX_DURATION = 46;
/** 气泡纵向落位区间（占留言墙高度的百分比），上下各让开一点边 */
const MIN_TOP_PERCENT = 4;
const MAX_TOP_PERCENT = 84;
/** 字号缩放区间，做出远近层次 */
const MIN_SCALE = 0.82;
const MAX_SCALE = 1.18;

/**
 * 加权抽一条：先把权重累加成一张递增表，抽取时二分定位。
 * 表只在挂载时算一次，之后每换一条只花 O(log n)，不在滚动帧里跑加权随机。
 * 权重为 0 的条目在表上不占区间，因此永不被抽中。
 */
function buildWeightedPicker(messages: BubbleMessage[]) {
	const cumulative: number[] = [];
	let total = 0;
	for (const message of messages) {
		total += Math.max(0, message.weight ?? 1);
		cumulative.push(total);
	}
	if (total <= 0) return null;
	return (random: number) => {
		const target = random * total;
		let low = 0;
		let high = cumulative.length - 1;
		while (low < high) {
			const middle = (low + high) >> 1;
			if (cumulative[middle] < target) low = middle + 1;
			else high = middle;
		}
		return low;
	};
}

function randomBetween(min: number, max: number) {
	return min + Math.random() * (max - min);
}

export type BubbleWall = {
	/** 离屏与后台标签页停表：CSS 动画不会自己因为 visibility: hidden 而停下 */
	setPaused: (paused: boolean) => void;
	/** 往池子里追加几条（评论区捞回来的那条走这里），加权表按新池子重建 */
	addMessages: (messages: BubbleMessage[]) => void;
};

/**
 * 留言墙：一组气泡靠 CSS 动画横向飘过，飘到屏幕外那一刻回收、换一条再飘。
 * 性能取向是「运行时零逐帧 JS」——位移全在合成层里跑，脚本只挂在
 * animationiteration 上改文案与随机参数（这一刻气泡正好在屏幕外，改什么都不看得出来），
 * 一条委托监听吃下所有气泡，不进可视区就整面停表。
 * 带图的那条走懒加载：赋值 src 时先亮占位微光，load/error 回来才淡入，
 * 拉不到图就退回纯文字气泡；命中缓存时 load 不补发，赋值后自己判一次 complete。
 * 进出场与显隐仍归影像层的进离场补间管，本模块只管「谁在飘、飘着哪句」。
 */
export function startBubbleWall(options: {
	container: HTMLElement;
	bubbles: BubbleSlot[];
	messages: BubbleMessage[];
	signal: AbortSignal;
	/** 每颗气泡换条时回调一次，交给调用方补上入场弹跳（本模块不碰动画库） */
	onRespawn?: (body: HTMLElement) => void;
}): BubbleWall {
	const { container, bubbles, messages, signal } = options;
	const setPaused = (paused: boolean) =>
		container.classList.toggle("is-paused", paused);
	// 池子允许事后追加（评论区那条是异步回来的），所以加权表也得能重建；
	// 只往尾部 push，已发出的索引不会失效
	const pool = [...messages];
	const initialPick = buildWeightedPicker(pool);
	// 兜底函数在下面的守卫之后不可能被调到，只是为了让 pick 的类型非空
	let pick = initialPick ?? (() => 0);

	const addMessages = (incoming: BubbleMessage[]) => {
		const usable = incoming.filter(
			(message) => (message.text ?? "").trim().length > 0,
		);
		if (usable.length === 0) return;
		pool.push(...usable);
		const rebuilt = buildWeightedPicker(pool);
		if (rebuilt) pick = rebuilt;
	};

	if (!initialPick || bubbles.length === 0) return { setPaused, addMessages };

	const slotByRoot = new Map(bubbles.map((slot) => [slot.root, slot]));
	const lastPickBySlot = new Map<BubbleSlot, number>();

	/** 图片到位：成功就淡入，失败就退回纯文字气泡，不留一块灰框挂在墙上 */
	const settle = (slot: BubbleSlot, ok: boolean) => {
		slot.image.classList.remove("is-loading");
		if (ok) slot.image.classList.add("is-loaded");
		else slot.root.classList.remove("has-image");
	};

	/** 填内容：文字直接给 text 节点；带图的那条先亮占位动效，解码完再淡入 */
	const paint = (slot: BubbleSlot, message: BubbleMessage) => {
		slot.text.textContent = message.text ?? "";
		const image = message.image ?? "";
		if (!image) {
			slot.root.classList.remove("has-image");
			return;
		}
		slot.root.classList.add("has-image");
		// 连着两条命中同一张图时别重赋 src：状态本就到位，再赋只是白跑一遍解码
		if (slot.image.getAttribute("src") === image) return;
		slot.image.classList.remove("is-loaded");
		slot.image.classList.add("is-loading");
		slot.image.src = image;
		// 图已在缓存里时 load 不再补发，赋值后自己判一次；
		// complete 对没有 src 的 img 同样成立，所以还得看 naturalWidth
		if (slot.image.complete) settle(slot, slot.image.naturalWidth > 0);
	};

	const assign = (slot: BubbleSlot) => {
		let index = pick(Math.random());
		// 同一颗气泡连着两次抽到同一条会露出「随机」的底，重掷一次即可
		if (index === lastPickBySlot.get(slot)) index = pick(Math.random());
		lastPickBySlot.set(slot, index);
		paint(slot, pool[index]);
	};

	/**
	 * 重掷落位与字号。**绝对不碰时长**：气泡挂着负 animation-delay，
	 * 进度 = ((本地时间 + |delay|) mod 时长) / 时长，animationiteration 触发的那一刻
	 * 恰好是「已走时间 = k × 旧时长」，把时长一换，取模结果就不再是 0，
	 * 气泡会当场瞬移到新路径上的随机位置（常常就在屏幕中间）——
	 * 看着就是「突然冒出来、下一圈又突然没了」。时长只在挂载时定一次。
	 */
	const reposition = (slot: BubbleSlot) => {
		slot.root.style.setProperty(
			"--home-blinds-bubble-top",
			`${randomBetween(MIN_TOP_PERCENT, MAX_TOP_PERCENT).toFixed(2)}%`,
		);
		slot.root.style.setProperty(
			"--home-blinds-bubble-scale",
			randomBetween(MIN_SCALE, MAX_SCALE).toFixed(2),
		);
	};

	// 首趟按负延迟把气泡撒满整条路径：进影像层就是一面飘着的墙，不必干等第一轮跑完
	for (const slot of bubbles) {
		// 一张图只挂一对监听，跟着 signal 一起拆；换条时不重复绑
		slot.image.addEventListener("load", () => settle(slot, true), { signal });
		slot.image.addEventListener("error", () => settle(slot, false), {
			signal,
		});
		const duration = randomBetween(MIN_DURATION, MAX_DURATION);
		slot.root.style.setProperty(
			"--home-blinds-bubble-duration",
			`${duration.toFixed(2)}s`,
		);
		reposition(slot);
		assign(slot);
		slot.root.style.animationDelay = `${(-Math.random() * duration).toFixed(2)}s`;
	}

	container.addEventListener(
		"animationiteration",
		(event) => {
			const root = event.target;
			if (!(root instanceof HTMLElement)) return;
			const slot = slotByRoot.get(root);
			if (!slot) return;
			reposition(slot);
			assign(slot);
			// 这一刻气泡正整颗藏在屏幕右侧之外，正好让它飘进来的同时弹一下
			options.onRespawn?.(slot.body);
		},
		{ signal },
	);

	return { setPaused, addMessages };
}

/** 一次捞多少条候选 */
const COMMENT_SAMPLE_SIZE = 20;
/** 捞回来的留言最长留这么多字：气泡窄，再长就只剩一排省略号 */
const MAX_COMMENT_LENGTH = 48;

/** Waline 所有接口都套这层信封，成功时 errno 为 0，评论在 data 里 */
type WalineRecentResponse = {
	errno?: number;
	data?: { comment?: string }[];
};

/**
 * 把服务端渲染好的评论 HTML 收成纯文本。走 DOMParser 解析到一份游离文档再取
 * textContent：这份文档从不进页面，脚本不执行、图片不加载，标签与 HTML 注释
 * （留言板夹的回复标记）也一并被丢掉，所以既不需要额外 sanitizer，也没有注入面。
 */
function commentToPlainText(rendered: string): string {
	if (typeof DOMParser === "undefined") return "";
	return (
		new DOMParser()
			.parseFromString(rendered, "text/html")
			.body.textContent?.replace(/\s+/gu, " ")
			.trim() ?? ""
	);
}

/**
 * 从评论区捞一条真实留言，供调用方混进气泡池。
 * 直接打 Waline 的匿名 recent 接口（与留言板手写 /api/token 是同一套做法），没有用
 * @waline/api 的 getRecentComment：它声明返回数组，实际把 {errno,errmsg,data} 信封原样
 * 吐出来且不解包、不查 errno，自己发一次请求反而更准，还省掉一个 chunk。
 * 任何一步拿不到可用文本都返回 null，由调用方安静跳过——评论服务停了，首页不该跟着少一块东西。
 */
export async function loadCommentBubble(options: {
	serverURL: string;
	lang: string;
	weight: number;
	signal: AbortSignal;
}): Promise<BubbleMessage | null> {
	const { serverURL, lang, weight, signal } = options;
	if (!serverURL || signal.aborted) return null;
	const response = await fetch(
		`${serverURL.replace(/\/?$/u, "/")}api/comment?type=recent&count=${COMMENT_SAMPLE_SIZE}&lang=${encodeURIComponent(lang)}`,
		{ signal },
	);
	if (!response.ok) return null;
	const body: WalineRecentResponse = await response.json();
	if (signal.aborted || body?.errno || !Array.isArray(body?.data)) return null;
	const texts = body.data
		.map((comment) => commentToPlainText(comment.comment ?? ""))
		.filter((text) => text.length >= 2 && text.length <= MAX_COMMENT_LENGTH);
	if (texts.length === 0) return null;
	return { text: texts[Math.floor(Math.random() * texts.length)], weight };
}
