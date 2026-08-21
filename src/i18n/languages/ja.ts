import Key from "../i18nKey";
import type { Translation } from "../translation";

export const ja: Translation = {
	[Key.home]: "ホーム",
	[Key.about]: "について",
	[Key.archive]: "アーカイブ",
	[Key.archiveStatsTotalPosts]: "全記事",
	[Key.archiveStatsMonthPosts]: "今月の記事",
	[Key.archiveStatsWritingSpan]: "執筆期間（日）",
	[Key.archiveStatsEvaluationAhead]:
		"今年の更新ペースは計画を上回っています。残り {remaining} 件を {months} か月で進めるには、月約 {pace} 件で余裕を持って達成できます。",
	[Key.archiveStatsEvaluationOnTrack]:
		"今年の更新ペースはほぼ計画通りです。残り {remaining} 件を、今後 {months} か月は月約 {pace} 件のペースで進めましょう。",
	[Key.archiveStatsEvaluationBehind]:
		"今年の更新ペースは現在計画を下回っています。残り {remaining} 件を達成するには、今後 {months} か月で月約 {pace} 件が必要です。",
	[Key.archiveStatsEvaluationComplete]:
		"今年の年間目標は達成済みです。今後は量よりも品質やシリーズの整理、長期的な蓄積に注力できます。",
	[Key.archiveStatsCategoryPosts]: "このカテゴリの記事",
	[Key.archiveStatsTagPosts]: "このタグの記事",
	[Key.archiveStatsProgress]: "年間進捗",
	[Key.archiveStatsUnavailable]: "--",
	[Key.archiveStatsGoal]: "年間目標",
	[Key.search]: "検索",
	[Key.searchNoResults]: "結果が見つかりません。",
	[Key.searchTypeSomething]: "検索キーワードを入力してください。",
	[Key.searchLoading]: "検索中...",
	[Key.all]: "すべて",

	[Key.tags]: "タグ",
	[Key.categories]: "カテゴリ",
	[Key.postList]: "投稿リスト",
	[Key.tableOfContents]: "目次",
	[Key.readingProgress]: "読書の進捗",
	[Key.tocEmpty]: "このページには目次がありません",
	[Key.music]: "音楽",
	[Key.musicNoPlaying]: "再生中なし",
	[Key.musicLyrics]: "歌詞",
	[Key.musicVolume]: "音量",
	[Key.musicPlayMode]: "再生モードを切り替え",
	[Key.musicPrev]: "前の曲",
	[Key.musicNext]: "次の曲",
	[Key.musicPlaylist]: "プレイリスト",
	[Key.musicNoLyrics]: "歌詞なし",
	[Key.musicLoadingLyrics]: "歌詞を読み込み中...",
	[Key.musicFailedLyrics]: "歌詞の読み込みに失敗しました",
	[Key.musicNoSongs]: "曲なし",
	[Key.musicError]: "プレーヤーエラー",
	[Key.musicPlay]: "再生",
	[Key.musicPause]: "一時停止",
	[Key.musicProgress]: "再生の進捗",
	[Key.musicCover]: "カバー",
	[Key.musicNoCover]: "カバーなし",
	[Key.musicFloatingLyrics]: "フローティング歌詞",

	// お知らせ
	[Key.announcement]: "お知らせ",
	[Key.announcementClose]: "閉じる",

	[Key.comments]: "コメント",
	[Key.friends]: "友達",
	[Key.friendsDescription]:
		"このサイトに登録された友人サイトや個人ブログを紹介します。気になるサイトを見つけ、相互リンクの申請方法や交流のきっかけを確認できます。",
	[Key.guestbook]: "ゲストブック",
	[Key.guestbookDescription]:
		"留言板で感想、提案、交流のメッセージを残し、ほかの訪問者と交流できます。コミュニティのルールを守り、安心して話せる場づくりにご協力ください。",
	[Key.commentSection]: "コメント",
	[Key.commentSubtitle]: "お気軽にコメントして議論に参加してください",
	[Key.commentNotConfigured]:
		"コメント機能が設定されていません。管理パネルでコメントシステムを設定してください。",
	[Key.uncategorized]: "未分類",
	[Key.noTags]: "タグなし",

	[Key.wordCount]: "語",
	[Key.wordsCount]: "語",
	[Key.minuteCount]: "分",
	[Key.minutesCount]: "分",
	[Key.postCount]: "投稿",
	[Key.postsCount]: "投稿",
	[Key.articles]: "記事",

	[Key.more]: "もっと",
	[Key.collapse]: "折りたたむ",

	[Key.author]: "著者",
	[Key.publishedAt]: "公開日",
	[Key.license]: "ライセンス",
	[Key.bangumi]: "バングミ",

	// バングミフィルターと状態文本
	[Key.bangumiPage]: "ページ",

	// バングミカテゴリ

	// バングミデータ更新

	// ページネーション
	[Key.paginationPrev]: "前へ",
	[Key.paginationNext]: "次へ",
	[Key.paginationPage]: "",
	[Key.paginationOf]: "ページ、全",
	[Key.paginationStatus]: "{current} / {total} ページ",

	// 404ページ
	[Key.notFound]: "404",
	[Key.notFoundTitle]: "ページが見つかりません",
	[Key.notFoundDescription]:
		"申し訳ありませんが、アクセスしたページは存在しないか、移動されています。",
	[Key.backToHome]: "ホームに戻る",

	// RSSページ
	[Key.rss]: "RSSフィード",
	[Key.rssDescription]:
		"このサイトのRSSフィードを購読すると、最新記事を普段使うリーダーで受け取れます。サイトを毎回訪れずに更新をまとめて確認できます。",
	[Key.rssLink]: "RSSリンク",
	[Key.rssCopyToReader]: "RSSリンクをリーダーにコピー",
	[Key.rssCopyLink]: "リンクをコピー",
	[Key.rssLatestPosts]: "最新の投稿",
	[Key.rssWhatIsRSS]: "RSSとは？",
	[Key.rssWhatIsRSSDescription]:
		"RSS（Really Simple Syndication）は、頻繁に更新されるコンテンツを公開するための標準形式です。RSSを使用すると：",
	[Key.rssBenefit1]:
		"手動で訪問することなく、最新のウェブサイトコンテンツを及时に取得",
	[Key.rssBenefit2]: "1か所で複数のウェブサイトの購読を管理",
	[Key.rssBenefit3]: "重要な更新や記事を見逃すことを回避",
	[Key.rssBenefit4]: "広告なしのクリーンな読書体験を楽しむ",
	[Key.rssHowToUse]:
		"Feedly、Inoreaderまたは他のRSSリーダーを使用してこのサイトを購読することを推奨します。",
	[Key.rssCopied]: "RSSリンクがクリップボードにコピーされました！",
	[Key.rssCopyFailed]: "コピーに失敗しました。手動でリンクをコピーしてください",

	// 最終更新時間カード
	[Key.lastModifiedPrefix]: "最終更新日：",
	[Key.lastModifiedOutdated]: "一部の内容が古くなっている可能性があります",
	[Key.lastModifiedDaysAgo]: "{days}日前",
	[Key.year]: "年",
	[Key.month]: "月",
	[Key.day]: "日",
	[Key.hour]: "時",
	[Key.minute]: "分",
	[Key.second]: "秒",

	// ページビュー統計
	[Key.pageViews]: "閲覧数",
	[Key.pageViewsLoading]: "読み込み中...",

	// ピン留め
	[Key.pinned]: "ピン留め",

	// 関連記事
	[Key.relatedPosts]: "関連記事",

	// 暗号化

	// 投稿リストレイアウト

	// スポンサーページ
	[Key.sponsor]: "スポンサー",
	[Key.sponsorTitle]: "サポート",
	[Key.sponsorDescription]:
		"支援方法と支援者一覧を掲載しています。いただいたご支援は、サイトの運営、コンテンツ制作、継続的な更新に活用されます。",
	[Key.sponsorList]: "スポンサーリスト",
	[Key.sponsorEmpty]: "スポンサー記録なし",
	[Key.scanToSponsor]: "スキャンしてスポンサー",

	// サイト統計
	[Key.siteStats]: "サイト統計",
	[Key.siteStatsPostCount]: "記事",
	[Key.siteStatsCategoryCount]: "カテゴリー",
	[Key.siteStatsTagCount]: "タグ",
	[Key.siteStatsVisitors]: "訪問者",
	[Key.siteStatsSource]: "ソース",
	[Key.footerRunningDays]: "運用 {days} 日",
	[Key.footerLastUpdate]: "最終更新は {days} 日前",
	[Key.today]: "今日",

	// カレンダーコンポーネント
	[Key.calendarSunday]: "日",
	[Key.calendarMonday]: "月",
	[Key.calendarTuesday]: "火",
	[Key.calendarWednesday]: "水",
	[Key.calendarThursday]: "木",
	[Key.calendarFriday]: "金",
	[Key.calendarSaturday]: "土",
	[Key.calendarJanuary]: "1月",
	[Key.calendarFebruary]: "2月",
	[Key.calendarMarch]: "3月",
	[Key.calendarApril]: "4月",
	[Key.calendarMay]: "5月",
	[Key.calendarJune]: "6月",
	[Key.calendarJuly]: "7月",
	[Key.calendarAugust]: "8月",
	[Key.calendarSeptember]: "9月",
	[Key.calendarOctober]: "10月",
	[Key.calendarNovember]: "11月",
	[Key.calendarDecember]: "12月",

	[Key.shareArticle]: "共有",
	[Key.generatingPoster]: "ポスター生成中...",
	[Key.copied]: "コピーしました",
	[Key.copyLink]: "リンクをコピー",
	[Key.savePoster]: "ポスターを保存",
	[Key.scanToRead]: "QRコードで読む",

	// コードブロック折りたたみ設定

	// ギャラリーページ
	[Key.gallery]: "ギャラリー",
	[Key.galleryDescription]:
		"サイトに収録したローカル・オンラインアルバムを閲覧し、テーマごとに写真や作品を探せます。残しておきたい瞬間や創作の記録をお楽しみください。",
	[Key.galleryPhotos]: "枚の写真",
	[Key.galleryNoAlbums]: "アルバムがありません",
	[Key.galleryBackToAlbums]: "アルバム一覧に戻る",
	[Key.galleryLocalAlbum]: "ローカルアルバム",
	[Key.galleryNetworkAlbum]: "ネットワークアルバム",
	[Key.galleryCategory]: "カテゴリ",
	[Key.galleryQuantity]: "数量",
	[Key.galleryRandomFetch]: "ランダム取得",
	[Key.galleryFetching]: "取得中...",
	[Key.galleryFetchError]: "取得に失敗しました、もう一度お試しください",
	[Key.galleryNoImages]:
		"画像がありません、上のボタンをクリックして取得してください",

	// 收藏APIページ
	[Key.collections]: "コレクション",
	[Key.collectionsDescription]:
		"サイトで整理した便利なツール、公開API、リソースリンクをまとめて閲覧できます。カテゴリから目的に合うサービスをすばやく探せます。",
	[Key.collectionsEmpty]: "収集したAPIはまだありません",

	// 統計ページ
	[Key.stats]: "統計",

	// パスワード保護
	[Key.passwordProtected]: "パスワード保護",
	[Key.passwordProtectedDesc]:
		"この記事はパスワードで保護されています。内容を表示するにはパスワードを入力してください。",
	[Key.passwordHint]: "ヒント",
	[Key.passwordPlaceholder]: "パスワードを入力",
	[Key.passwordSubmit]: "ロック解除",
	[Key.passwordError]: "パスワードが間違っています。もう一度お試しください。",
	[Key.passwordProtectedRss]:
		"この記事は暗号化されています。ウェブサイトにアクセスしてご覧ください。",

	// カレンダーページ
	[Key.calendar]: "カレンダー",
	[Key.feibichi]: "个人主站",
	[Key.contactMe]: "連絡",
	[Key.qqGroup]: "QQグループ",
	[Key.navPosts]: "記事",
	[Key.navMy]: "その他",
	[Key.calendarDescription]:
		"祝日、誕生日、予定、記事公開の記録を一つのカレンダーで確認できます。日付ごとに今後の予定やサイト更新を把握できます。",
	[Key.calendarToday]: "今日",
	[Key.calendarBirthday]: "誕生日",
	[Key.calendarHoliday]: "祝日",
	[Key.calendarSchedule]: "予定",
	[Key.calendarPost]: "記事",
	[Key.calendarLunar]: "旧暦",
	[Key.calendarUpcoming]: "近日の予定",
	[Key.calendarTodayEvents]: "本日のイベント",
	[Key.calendarNoEvents]: "この日には予定がありません",
	[Key.calendarMore]: "他 {n} 件",
	[Key.calendarBackToToday]: "今日に戻る",
	[Key.calendarNearestHoliday]: "直近の祝日",
	[Key.calendarNearestBirthday]: "直近の誕生日",
	[Key.calendarNearestSchedule]: "直近のスケジュール",
	// ===== 通用操作 =====
	[Key.close]: "閉じる",
	[Key.expand]: "展開",
	[Key.retry]: "再試行",
	[Key.cancel]: "キャンセル",
	[Key.save]: "保存",
	[Key.deleteLabel]: "削除",
	[Key.send]: "送信",
	[Key.login]: "ログイン",
	[Key.logout]: "ログアウト",
	[Key.gotIt]: "了解しました",
	[Key.visitor]: "訪問者",
	[Key.viewDetails]: "詳細を見る",
	[Key.backToTop]: "トップへ戻る",
	[Key.top]: "トップ",
	[Key.menu]: "メニュー",
	[Key.theme]: "テーマ",
	[Key.tools]: "ツール",
	[Key.breadcrumb]: "パンくずリスト",
	[Key.copyPrefix]: "コピー",
	[Key.copyTemplate]: "テンプレートをコピー",

	// ===== 悬浮坞 / 导航 / 主题 =====
	[Key.aiSearch]: "AI検索",
	[Key.switchToDark]: "ダークモードに切替",
	[Key.switchToLight]: "ライトモードに切替",
	[Key.spineModel]: "Spineモデル",
	[Key.toggleDock]: "ドック切替",
	[Key.quickActions]: "クイックアクション",
	[Key.announcementTicker]: "お知らせティッカー",
	[Key.viewAnnouncement]: "お知らせを見る",

	// ===== 搜索弹窗 =====
	[Key.searchArticles]: "記事を検索",
	[Key.searchPlaceholder1]: "記事・タグ・カテゴリを検索...",
	[Key.searchPlaceholder2]: "キーワードを入力して検索",
	[Key.searchPlaceholder3]: "「Astro」や「Svelte」を試してみて",
	[Key.searchPlaceholder4]: "ESCで検索パネルを閉じる",
	[Key.searchPlaceholder5]: "Ctrl+KでAI検索と通常検索を切替",
	[Key.searchViewAllPrefix]: "すべて見る",
	[Key.searchViewAllSuffix]: "件の結果 →",
	[Key.searchHintClose]: "ESC 閉じる",
	[Key.searchHintSearch]: "ENTER 検索",
	[Key.searchHintToggle]: "Ctrl+K 切替",

	// ===== 首页 Hero 对话 =====
	[Key.techBlogSuffix]: "の技術ブログ",
	[Key.dialogueMenuTitle]: "何を話そうか？",
	[Key.characterDialogue]: "キャラクターとの対話",
	[Key.dialoguePrev]: "前の一言",
	[Key.dialogueNext]: "次の一言",
	[Key.dialogueAutoPlay]: "自動再生",
	[Key.reopenDialogue]: "対話を再開",
	[Key.dialogueRestoreHint]: "ニャ？まだ話したい？",

	// ===== 首页数据层 =====
	[Key.siteData]: "サイトデータ",
	[Key.mapGuide]: "マップガイド",
	[Key.siteVisits]: "サイトアクセス",
	[Key.visitsLoading]: "訪問者と閲覧統計を読み込み中",
	[Key.visitTrajectory]: "アクセス履歴",
	[Key.articleArchive]: "記事アーカイブ",
	[Key.contentIndex]: "コンテンツインデックス",
	[Key.pinnedPosts]: "ピン留め記事",
	[Key.latestUpdates]: "最新の更新",
	[Key.switchPinnedPost]: "次のピン留め記事へ切替",
	[Key.openPost]: "現在の記事を開く",
	[Key.viewPinnedPostPrefix]: "ピン留め記事を見る：",
	[Key.viewLatestPostPrefix]: "最新記事を見る：",
	[Key.continueReadingFallback]: "この記事を開いて読み続けましょう。",
	[Key.noPinnedContent]: "ピン留めコンテンツはありません",
	[Key.noPosts]: "記事はまだありません",
	[Key.categoryIndex]: "カテゴリインデックス",
	[Key.viewAll]: "すべて見る",
	[Key.categoryUnit]: "個のカテゴリ",
	[Key.tagIndex]: "タグインデックス",
	[Key.tagUnit]: "個のタグ",
	[Key.browseAllTags]: "すべてのタグ",
	[Key.subscribeContact]: "購読と連絡",
	[Key.contactMethods]: "主な連絡先",
	[Key.expandContacts]: "すべての連絡先を展開",
	[Key.allContacts]: "すべての連絡先",
	[Key.viewsLabel]: "閲覧数",
	[Key.viewsBrowseLabel]: "閲覧",

	// ===== 页脚 =====
	[Key.privacyPolicy]: "プライバシーポリシー",
	[Key.userAgreement]: "利用規約",
	[Key.policeBeianAlt]: "公安備案",

	// ===== 文章列表页 =====
	[Key.publishDatePrefix]: "公開日：",
	[Key.viewPostPrefix]: "記事を見る：",
	[Key.encryptedPost]: "暗号化された記事",
	[Key.totalPostsPrefix]: "計",
	[Key.sortPosts]: "記事の並び替え",
	[Key.sortLatest]: "最新",
	[Key.sortOldest]: "最古",
	[Key.sortPopular]: "人気",
	[Key.sortByPrefix]: "現在",
	[Key.sortBySuffix]: "順",
	[Key.regularPosts]: "通常の記事",
	[Key.noRegularPosts]: "通常の記事はありません",
	[Key.noPostsHint]: "新しいコンテンツがここに表示されます。",
	[Key.paginationNav]: "記事ページネーション",

	// ===== 相对时间 =====

	// ===== 友链 =====
	[Key.friendRulesTitle]: "リンク申請ガイド",
	[Key.friendSiteInfo]: "当サイトの情報",
	[Key.siteNameLabel]: "サイト名",
	[Key.siteDescLabel]: "サイト説明",
	[Key.siteUrlLabel]: "サイトURL",
	[Key.siteAvatarLabel]: "アバターURL",
	[Key.friendApplyUnderstood]: "了解しました、申請する",
	[Key.applyProcess]: "申請の流れ",
	[Key.applyStep1Title]: "当サイトのリンクを追加",
	[Key.applyStep1Desc]:
		"まずあなたのサイトのリンクページに当サイトの情報を追加してください。上の各項目をコピーできます",
	[Key.applyStep2Title]: "コメント欄で申請",
	[Key.applyStep2Desc]:
		"下のテンプレートをコピーして編集し、このページのコメント欄に投稿してください",
	[Key.applyStep3Title]: "審査をお待ちください",
	[Key.applyStep3Desc]: "情報確認後、できるだけ早くリンクを追加します",
	[Key.friendApplyTemplate]:
		"サイト名：あなたのサイト名\nサイト説明：あなたのサイト説明\nサイトURL：あなたのサイトURL\nアバターURL：あなたのアバターURL",
	[Key.friendNotesTitle]: "注意事項",
	[Key.friendSelfApply]: "セルフ申請（推奨）",
	[Key.goToComments]: "コメント欄へ",
	[Key.friendListAria]: "リンク一覧",
	[Key.friendFilterAria]: "リンクタイプ絞り込み",
	[Key.applyFriendLink]: "リンクを申請",
	[Key.avatarSuffix]: "のアバター",
	[Key.friendEmptyTitle]: "このカテゴリにはリンクがありません",
	[Key.friendEmptyHint]: "他のブログタイプを選んでください",

	// ===== 音乐可视化 =====
	[Key.playModeList]: "リストループ",
	[Key.playModeSingle]: "一曲ループ",
	[Key.playModeShuffle]: "シャッフル",
	[Key.currentTrack]: "現在の曲",
	[Key.musicPlayerLabel]: "音楽プレイヤー",
	[Key.viewPlaylist]: "プレイリストを見る",
	[Key.playbackControls]: "再生コントロール",
	[Key.playlistSwitch]: "プレイリスト切替",
	[Key.backToPlayer]: "プレイヤーに戻る",
	[Key.currentPlaylist]: "現在のプレイリスト",
	[Key.playlistLoading]: "プレイリスト読み込み中",
	[Key.musicVisualizer]: "音楽ビジュアライザー",
	[Key.musicVisualizer3D]: "3Dビジュアライザー",
	[Key.musicVisualizerDescription]:
		"再生中の音楽を立体的な地形と動きで表現する没入型ビジュアライザーです。音に合わせた視覚効果とともに音楽を楽しめます。",

	// ===== 日历事件 =====
	[Key.countdownTo]: "まで",
	[Key.countdownEndIn]: "終了まで：",
	[Key.countdownIn]: "あと：",
	[Key.dayShort]: "日",
	[Key.officialHolidayBadge]: "法定",
	[Key.makeupWorkdayBadge]: "振替出勤",
	[Key.prevMonth]: "前の月",
	[Key.nextMonth]: "次の月",

	// ===== 弹窗 / 杂项 =====
	[Key.pageLoading]: "ページ読み込み中",
	[Key.pageLoadingAnimation]: "読み込みアニメーション",
	[Key.generateSharePoster]: "シェアポスターを生成",
	[Key.categoryFolderMeta]: "{posts} 記事 · {tags} タグ",
	[Key.iconNotFound]: "アイコンが見つかりません：{icon}",
	[Key.aboutSitePrefix]: "このサイトについて：",

	// ===== 页面级描述 =====
	[Key.archiveDescription]:
		"公開日時順にすべての記事を閲覧し、カテゴリ、タグ、絞り込みで必要なテーマを探せます。これまでの執筆記録も振り返れます。",
	[Key.tagGraphPageTitle]: "タググラフ",
	[Key.tagGraphPageDescription]:
		"カテゴリ、タグ、関係グラフからこのサイトの記事をたどり、関心のあるテーマと関連する記事をすばやく見つけられます。",
	[Key.categoryExplorerTitle]: "カテゴリとタグ",
	[Key.categoryExplorerViewPosts]: "記事を見る",
	[Key.categoryExplorerAria]: "カテゴリとタグのブラウザ",
	[Key.listDescription]:
		"カード形式で全記事を閲覧できます。公開日、テーマ、カテゴリ、タグ、閲覧数による並べ替えや絞り込みで読みたい内容を探せます。",
	[Key.noDescriptionFallback]: "概要がありません。クリックして全文を読む。",
	[Key.searchDescription]:
		"サイト内検索で公開済みの記事と関連内容を探せます。キーワードからテーマ、タイトル、本文中の情報をすばやく見つけられます。",
	[Key.aboutDescription]:
		"サイトの作者、発信内容、技術スタック、連絡先を紹介します。更新履歴や運営情報、今後の方向性も確認できます。",
	[Key.aboutChangelogTitle]: "更新履歴",
	[Key.aboutChangelogPagesLabel]: "関連ページ",
	[Key.aboutChangelogRelatedLabel]: "関連する更新",
	[Key.changelogTypeFeat]: "新機能",
	[Key.changelogTypeFix]: "修正",
	[Key.changelogTypeStyle]: "スタイル",
	[Key.changelogTypeRefactor]: "リファクタ",
	[Key.changelogTypeChore]: "メンテナンス",
	[Key.albumPrefix]: "アルバム：",
	[Key.sponsorChooseMethod]: "お好みの支払い方法を選択してください",
	[Key.sponsorNotAvailable]: "現在未対応",
	[Key.postIntroLabel]: "概要",
	[Key.coverImageAltSuffix]: "のカバー画像",

	// ===== AI 搜索 / 留言板（Phase B）=====
	[Key.sending]: "送信中",
	[Key.saving]: "保存中",
	[Key.deleting]: "削除中",
	[Key.image]: "画像",
	[Key.none]: "なし",
	[Key.emoji]: "絵文字",
	[Key.aiSuggestionBlog]: "このブログはどうやって作られたの？",
	[Key.aiSuggestionIntro]: "自分を紹介して",
	[Key.aiFollowUpPosts]: "最近の記事について話して",
	[Key.aiFollowUpProjects]: "おすすめのプロジェクトは？",
	[Key.aiJustNow]: "たった今",
	[Key.aiMinutesAgo]: "{n}分前",
	[Key.aiHoursAgo]: "{n}時間前",
	[Key.aiDaysAgo]: "{n}日前",
	[Key.aiInputTooLong]: "入力が長すぎますニャ、最大 {max} 文字まで~",
	[Key.aiStreamErrorPrefix]: "エラー：{error}",
	[Key.aiCancelled]: "（キャンセル済み）",
	[Key.aiRateLimited]:
		"リクエストが多すぎますニャ、少し待ってから再試行してください~",
	[Key.aiRequestError]:
		"申し訳ありません、リクエストエラーが発生しました。少し待ってから再試行してください~",
	[Key.aiAssistantName]: "ミャオドゥン",
	[Key.aiHistory]: "履歴セッション",
	[Key.aiClearAllSessions]: "全セッションを削除",
	[Key.aiNewSession]: "新規セッション",
	[Key.aiDeleteSession]: "セッションを削除",
	[Key.aiNoHistory]: "履歴セッションはありません",
	[Key.aiEmptyTitle]: "何を聞きたい？",
	[Key.aiRefsTitle]: "参考記事",
	[Key.aiResizeTitle]: "ドラッグで高さを調整",
	[Key.aiAskLabel]: "質問",
	[Key.aiInputPlaceholder]: "質問を入力...",
	[Key.aiInputAria]: "AI検索の質問",
	[Key.aiStopGeneration]: "生成を停止",
	[Key.aiPrivacyNotice]:
		"質問と直近6回の対話は ModelScope または Cloudflare Workers AI に送信されます。パスワード、トークン、機密情報を入力しないでください。セッションは7日間保存されます。",
	[Key.aiRequestFailedStatus]: "リクエスト失敗 ({status})",
	[Key.aiStreamUnreadable]: "レスポンスストリームを読み取れません",
	[Key.aiNewChat]: "新しい対話",
	[Key.gbVisitor]: "訪問者",
	[Key.gbAnonymousVisitor]: "匿名訪問者",
	[Key.gbServerNotConfiguredLogin]:
		"Waline サーバー URL が未設定のため、ログインできません",
	[Key.gbLoginVerifyFailed]:
		"ログイン情報の検証に失敗しました。再度ログインしてください",
	[Key.gbLoginExpired]:
		"ログイン情報の有効期限が切れました。再度ログインしてください",
	[Key.gbAuthExpired]:
		"ログインセッションが失効しました。再度ログインしてください",
	[Key.gbServerNotConfigured]: "Waline サーバー URL が未設定です",
	[Key.gbOfflineInitial]:
		"オフライン状態です。ネットワーク復帰後に自動読み込みします",
	[Key.gbNetworkDisconnected]:
		"ネットワークが切断されました。復帰後に自動同期します",
	[Key.gbSyncOffline]: "オフライン",
	[Key.gbSyncSyncing]: "同期中",
	[Key.gbSyncFailed]: "同期失敗",
	[Key.gbSyncWaiting]: "同期待ち",
	[Key.gbSyncedAt]: "{time} に同期",
	[Key.gbToday]: "今日",
	[Key.gbYesterday]: "昨日",
	[Key.gbMsgMinLength]: "メッセージは最低 {min} 文字必要です",
	[Key.gbMsgMaxLength]: "メッセージは {max} 文字を超えられません",
	[Key.gbMsgReplyMarker]: "メッセージはシステム引用マーカーで開始できません",
	[Key.gbLoginRequired]: "メッセージ送信前にログインしてください",
	[Key.gbNicknameMinLength]: "ゲストニックネームは最低 {min} 文字必要です",
	[Key.gbGuestProfileRequiredDisabled]:
		"ゲストアクセスでプロフィールを記入してから送信してください",
	[Key.gbGuestProfileRequired]:
		"ゲストプロフィールを記入するか、ログインして送信してください",
	[Key.gbEmailInvalid]: "メールアドレスの形式が正しくありません",
	[Key.gbLinkProtocolInvalid]:
		"ウェブサイト URL は http または https のみ対応しています",
	[Key.gbLinkInvalid]: "ウェブサイト URL の形式が正しくありません",
	[Key.gbSendFailed]: "メッセージの送信に失敗しました",
	[Key.gbEditFailed]:
		"メッセージの編集に失敗しました。少し待ってから再試行してください",
	[Key.gbDeleteFailed]:
		"メッセージの削除に失敗しました。少し待ってから再試行してください",
	[Key.gbLoginInvalidResponse]:
		"ログイン応答が無効です。再度ログインしてください",
	[Key.gbLoginFailed]:
		"ログインに失敗しました。少し待ってから再試行してください",
	[Key.gbHiddenUntilVisible]: "ページが表示されると掲示板を自動読み込みします",
	[Key.gbTitle]: "掲示板",
	[Key.gbMessageCount]: "{count} 件のメッセージ",
	[Key.gbSyncIntervalSuffix]: "· 30 s",
	[Key.gbRefreshAria]: "掲示板を更新",
	[Key.gbRefreshingAria]: "掲示板を更新中",
	[Key.gbRefreshNowAria]: "メッセージを今すぐ更新",
	[Key.gbRefreshNowTitle]: "今すぐ更新",
	[Key.gbMembers]: "投稿者",
	[Key.gbCloseAnnouncement]: "お知らせを閉じる",
	[Key.gbLoadingAria]: "メッセージを読み込み中",
	[Key.gbLoadFailedTitle]: "掲示板の読み込みに失敗しました",
	[Key.gbReload]: "再読み込み",
	[Key.gbLoadingOlder]: "過去のメッセージを読み込み中",
	[Key.gbLoadOlder]: "過去のメッセージを読み込む",
	[Key.gbNoMoreMessages]: "これが最初のメッセージです",
	[Key.gbEmptyTitle]: "まだ投稿がありません",
	[Key.gbEmptyBody]: "最初のメッセージを送って会話を始めましょう。",
	[Key.gbNewMessagesAria]: "{count} 件の新着メッセージ、最新へ移動",
	[Key.gbBackToBottom]: "下部へ戻る",
	[Key.gbOffline]: "現在オフライン状態です",
	[Key.gbRetrySync]: "同期を再試行",
	[Key.gbCloseMembers]: "投稿者リストを閉じる",
	[Key.gbMembersListAria]: "投稿者リスト",
	[Key.gbAdmin]: "管理者",
	[Key.gbMemberCountAria]: "{count} 人",
	[Key.gbDeleteMessage]: "メッセージを削除",
	[Key.gbCloseDeleteConfirm]: "削除確認を閉じる",
	[Key.gbDeleteWarning]:
		"削除すると元に戻せません。Waline サーバー側からも削除されます。",
	[Key.gbEmojiLoadFailed]:
		"Waline 絵文字の読み込みに失敗しました。少し待ってから再試行してください",
	[Key.gbEmojiImageTitle]: "絵文字",
	[Key.gbImageTypeUnsupported]: "PNG、JPEG、GIF、WebP のみ対応しています",
	[Key.gbImageTooLarge]: "画像は 5 MB を超えられません",
	[Key.gbImageTooLargeInline]: "Waline 標準画像は 128 KB を超えられません",
	[Key.gbImageUploadFailed]:
		"画像のアップロードに失敗しました。少し待ってから再試行してください",
	[Key.gbComposerReplyTo]: "@{nick} に返信",
	[Key.gbCancelQuote]: "引用をキャンセル",
	[Key.gbResizeAria]: "入力欄の高さを調整",
	[Key.gbResizeTitle]: "上へドラッグで入力欄を拡大",
	[Key.gbPlaceholderRequireLogin]: "ログインしてコメントに参加",
	[Key.gbPlaceholder]: "何か話しかけて...",
	[Key.gbComposerAria]: "メッセージ内容",
	[Key.gbRemoveImageAria]: "送信予定の画像を削除",
	[Key.gbRemoveImageTitle]: "画像を削除",
	[Key.gbEmojiAria]: "絵文字を選択",
	[Key.gbUploadImageAria]: "画像をアップロード",
	[Key.gbCharCount]: "{count}/{max}",
	[Key.gbCurrentUserAria]: "現在のログインユーザー：{name}",
	[Key.gbAdminRole]: "管理者",
	[Key.gbLoggedIn]: "ログイン済み",
	[Key.gbCurrentUser]: "現在のユーザー：{name}",
	[Key.gbGuestProfileAriaFilled]:
		"ゲストプロフィール、ニックネーム {nick}、メール {mail}、サイト {link}",
	[Key.gbGuestProfileAriaEmpty]: "ゲストプロフィール未記入",
	[Key.gbNicknameTooltip]: "ニックネーム：{value}",
	[Key.gbEmailTooltip]: "メール：{value}",
	[Key.gbLinkTooltip]: "サイト：{value}",
	[Key.gbNotFilled]: "未記入",
	[Key.gbGuestProfileNotFilled]: "ゲストプロフィールが未記入です",
	[Key.gbEditGuestProfile]: "ゲストプロフィールを編集",
	[Key.gbFillGuestProfile]: "ゲストプロフィールを記入",
	[Key.gbGuestAccess]: "ゲストアクセス",
	[Key.gbLogoutWalineTitle]: "Waline からログアウト",
	[Key.gbLoggingIn]: "ログイン中",
	[Key.gbWalineEmojiAria]: "Waline 絵文字",
	[Key.gbLoadingEmoji]: "絵文字を読み込み中",
	[Key.gbEmojiPacksAria]: "絵文字パック",
	[Key.gbInsertEmojiAria]: "{key} を挿入",
	[Key.gbCloseTip]: "ヒントを閉じる",
	[Key.gbGuestProfile]: "ゲストプロフィール",
	[Key.gbCloseGuestProfile]: "ゲストプロフィールを閉じる",
	[Key.gbNickname]: "ニックネーム",
	[Key.gbNicknamePlaceholder]: "最低2文字",
	[Key.gbEmail]: "メール",
	[Key.gbEmailPlaceholder]: "アバター用、非公開",
	[Key.gbLink]: "サイト",
	[Key.gbOptional]: "任意",
	[Key.gbSaveProfile]: "プロフィールを保存",
	[Key.gbQuoteNotLoaded]: "元のメッセージが未読み込みです",
	[Key.gbCopyFailed]:
		"コピーに失敗しました。ブラウザのクリップボード権限を確認してください",
	[Key.gbJumpToQuoteAria]: "{nick} の元メッセージへ移動",
	[Key.gbJumpToQuoteTitle]: "元メッセージへ移動",
	[Key.gbVisitSiteTitle]: "{nick} のサイトを訪問",
	[Key.gbPendingReview]: "審査中",
	[Key.gbEditMessageWithName]: "{nick} のメッセージを編集",
	[Key.gbMessageActionsAria]: "メッセージ操作",
	[Key.gbReplyAria]: "{nick} に返信",
	[Key.gbQuoteReply]: "引用返信",
	[Key.gbCopied]: "コピーしました",
	[Key.gbCopyMessage]: "メッセージをコピー",
	[Key.gbEditMessage]: "メッセージを編集",
	[Key.gbConnecting]: "掲示板サービスに接続中",

	[Key.tagGraphAccessible]:
		"タグ関係グラフ、タグ {tags} 個・関連 {links} 件。方向キーでタグを選択し、Enter で開きます。",
	[Key.tagGraphEmpty]: "タグ関係はまだありません",
	[Key.tagGraphPreparing]: "グラフを準備中…",
	[Key.tagGraphSectionTitle]: "タグ関係グラフ",
	[Key.tagGraphFailed]: "グラフの読み込みに失敗しました",
	[Key.switchPinnedAria]: "ピン留め記事を切替",
	[Key.switchLatestAria]: "最新記事を切替",
	[Key.openPostPrefix]: "記事を開く：",
};
