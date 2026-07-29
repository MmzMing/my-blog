import Key from "../i18nKey";
import type { Translation } from "../translation";

export const ru: Translation = {
	[Key.home]: "Главная",
	[Key.about]: "О нас",
	[Key.archive]: "Архив",
	[Key.postHeatmap]: "Тепловая карта",
	[Key.githubHeatmap]: "Вклад в GitHub",
	[Key.githubContributions]: "вкладов",
	[Key.githubCommits]: "коммитов",
	[Key.archiveStatsTotalPosts]: "Все публикации",
	[Key.archiveStatsYearPosts]: "Публикации за год",
	[Key.archiveStatsMonthPosts]: "Публикации за месяц",
	[Key.archiveStatsWritingSpan]: "Период публикаций (дни)",
	[Key.archiveStatsEvaluationAhead]:
		"Темп публикаций заметно опережает план. Осталось {remaining} публикаций и {months} месяцев — около {pace} публикаций в месяц достаточно для уверенного выполнения цели.",
	[Key.archiveStatsEvaluationOnTrack]:
		"Темп публикаций соответствует плану. Осталось {remaining} публикаций и {months} месяцев; сохраняйте темп около {pace} публикаций в месяц.",
	[Key.archiveStatsEvaluationBehind]:
		"Темп публикаций пока отстаёт от плана. Для оставшихся {remaining} публикаций за {months} месяцев потребуется около {pace} публикаций в месяц.",
	[Key.archiveStatsEvaluationComplete]:
		"Годовая цель выполнена. Теперь можно сосредоточиться на качестве материалов, сериях и долгосрочной ценности.",
	[Key.archiveStatsCategoryPosts]: "Публикации в категории",
	[Key.archiveStatsTagPosts]: "Публикации с тегом",
	[Key.archiveStatsProgress]: "Годовой прогресс",
	[Key.archiveStatsUnavailable]: "--",
	[Key.archiveStatsGoal]: "Годовая цель",
	[Key.search]: "Поиск",
	[Key.searchNoResults]: "Результаты не найдены.",
	[Key.searchTypeSomething]: "Введите ключевое слово для поиска...",
	[Key.searchLoading]: "Поиск...",
	[Key.searchSummary]: "Резюме",
	[Key.searchContent]: "Содержание",
	[Key.searchViewMore]: "Показать еще ({count} шт)",
	[Key.other]: "Прочее",
	[Key.all]: "Все",

	[Key.tags]: "Теги",
	[Key.categories]: "Категории",
	[Key.allPosts]: "Все посты",
	[Key.recentPosts]: "Последние посты",
	[Key.postList]: "Список постов",
	[Key.tableOfContents]: "Содержание",
	[Key.tocEmpty]: "На этой странице нет оглавления",
	[Key.music]: "Музыка",
	[Key.musicNoPlaying]: "Ничего не воспроизводится",
	[Key.musicLyrics]: "Текст песни",
	[Key.musicVolume]: "Громкость",
	[Key.musicPlayMode]: "Переключить режим воспроизведения",
	[Key.musicPrev]: "Предыдущий трек",
	[Key.musicNext]: "Следующий трек",
	[Key.musicPlaylist]: "Плейлист",
	[Key.musicNoLyrics]: "Текст песни отсутствует",
	[Key.musicLoadingLyrics]: "Загрузка текста песни...",
	[Key.musicFailedLyrics]: "Ошибка загрузки текста песни",
	[Key.musicNoSongs]: "Нет песен",
	[Key.musicError]: "Ошибка плеера",
	[Key.musicPlay]: "Воспроизвести",
	[Key.musicPause]: "Пауза",
	[Key.musicProgress]: "Прогресс воспроизведения",
	[Key.musicCover]: "Обложка",
	[Key.musicNoCover]: "Нет обложки",
	[Key.musicAudioPlayer]: "Аудиоплеер",
	[Key.musicFloatingLyrics]: "Плавающий текст",

	// Объявление
	[Key.announcement]: "Объявление",
	[Key.announcementClose]: "Закрыть",

	[Key.comments]: "Комментарии",
	[Key.commentSection]: "Комментарии",
	[Key.commentSubtitle]: "Поделитесь своими мыслями и обсудите с остальными",
	[Key.commentNotConfigured]: "Система комментариев не настроена",
	[Key.guestbookCommentHint]:
		"Вы еще не включили систему комментариев в файле конфигурации. После включения посетители смогут оставлять сообщения здесь",
	[Key.friends]: "Ссылки",
	[Key.friendsDescription]:
		"Вот мои друзья, добро пожаловать посетить и общаться друг с другом",
	[Key.friendsApply]: "Подать заявку на ссылку",
	[Key.guestbook]: "Гостевая книга",
	[Key.guestbookDescription]:
		"Добро пожаловать, оставьте свой след здесь, поделитесь своими мыслями и предложениями",
	[Key.untitled]: "Без названия",
	[Key.uncategorized]: "Без категории",
	[Key.noTags]: "Нет тегов",

	[Key.wordCount]: "слово",
	[Key.wordsCount]: "слова",
	[Key.minuteCount]: "минута",
	[Key.minutesCount]: "минуты",
	[Key.postCount]: "пост",
	[Key.postsCount]: "постов",

	[Key.themeColor]: "Цвет темы",

	[Key.lightMode]: "Светлая",
	[Key.darkMode]: "Тёмная",
	[Key.systemMode]: "Система",

	[Key.more]: "Ещё",
	[Key.collapse]: "Свернуть",

	[Key.author]: "Автор",
	[Key.publishedAt]: "Опубликовано",
	[Key.updatedAt]: "Обновлено",
	[Key.readTime]: "Время чтения",
	[Key.license]: "Лицензия",
	[Key.bangumi]: "Бангуми",

	// Фильтр и статус Бангуми текст
	[Key.bangumiTitle]: "Мой план группы",
	[Key.bangumiSubtitle]: "Запись моего аниме путешествия",
	[Key.bangumiFilterAll]: "Все",
	[Key.bangumiFilterWatched]: "Просмотрено",
	[Key.bangumiFilterWatching]: "Смотрю",
	[Key.bangumiFilterWish]: "Хочу",
	[Key.bangumiFilterOnHold]: "Отложено",
	[Key.bangumiFilterDropped]: "Брошено",
	[Key.bangumiFilterGamePlayed]: "Пройдено",
	[Key.bangumiFilterGamePlaying]: "Играю",
	[Key.bangumiFilterGameWish]: "Хочу сыграть",
	[Key.bangumiFilterBookRead]: "Прочитано",
	[Key.bangumiFilterBookReading]: "Читаю",
	[Key.bangumiFilterBookWish]: "Хочу прочитать",
	[Key.bangumiFilterMusicListened]: "Прослушано",
	[Key.bangumiFilterMusicListening]: "Слушаю",
	[Key.bangumiFilterMusicWish]: "Хочу послушать",
	[Key.bangumiStatusWish]: "Хочу",
	[Key.bangumiStatusWatched]: "Просмотрено",
	[Key.bangumiStatusWatching]: "Смотрю",
	[Key.bangumiStatusOnHold]: "Отложено",
	[Key.bangumiStatusDropped]: "Брошено",
	[Key.bangumiStatusGameWish]: "Хочу сыграть",
	[Key.bangumiStatusGamePlayed]: "Пройдено",
	[Key.bangumiStatusGamePlaying]: "Играю",
	[Key.bangumiStatusBookWish]: "Хочу прочитать",
	[Key.bangumiStatusBookRead]: "Прочитано",
	[Key.bangumiStatusBookReading]: "Читаю",
	[Key.bangumiStatusMusicWish]: "Хочу послушать",
	[Key.bangumiStatusMusicListened]: "Прослушано",
	[Key.bangumiStatusMusicListening]: "Слушаю",
	[Key.bangumiStatusUnknown]: "Неизвестно",
	[Key.bangumiNoData]: "Нет данных",
	[Key.bangumiNoDataDescription]: "В этой категории нет элементов",
	[Key.bangumiEmpty]: "Нет данных",
	[Key.bangumiEmptyReason]:
		"Возможные причины: имя пользователя не существует, проблема с подключением к сети или ограничение API",
	[Key.bangumiUsername]: "Имя пользователя",
	[Key.bangumiApi]: "API",
	[Key.bangumiConfigTip]:
		"Подсказка: установите правильное имя пользователя Bangumi в конфигурации страницы",
	[Key.bangumiPrevPage]: "Предыдущая",
	[Key.bangumiNextPage]: "Следующая",
	[Key.bangumiCurrentPage]: "Страница",
	[Key.bangumiTotalPages]: "из",
	[Key.bangumiPage]: "страница",

	// Категории Бангуми
	[Key.bangumiCategoryBook]: "Книга",
	[Key.bangumiCategoryAnime]: "Аниме",
	[Key.bangumiCategoryMusic]: "Музыка",
	[Key.bangumiCategoryGame]: "Игра",
	[Key.bangumiCategoryReal]: "Реальный",

	// Обновление данных Бангуми
	[Key.bangumiLastUpdated]: "Данные обновлены",
	[Key.bangumiUpdatedAt]: "Время сборки",
	[Key.bangumiDataStatic]: "Статические данные",

	// Пагинация
	[Key.paginationFirst]: "Первая",
	[Key.paginationPrev]: "Предыдущая",
	[Key.paginationNext]: "Следующая",
	[Key.paginationLast]: "Последняя",
	[Key.paginationPage]: "Страница",
	[Key.paginationOf]: "из",
	[Key.paginationTotal]: ", всего",
	[Key.paginationRecords]: " записей",

	// 404 Страница
	[Key.notFound]: "404",
	[Key.notFoundTitle]: "Страница не найдена",
	[Key.notFoundDescription]:
		"Извините, страница, которую вы посетили, не существует или была перемещена.",
	[Key.backToHome]: "Вернуться на главную",

	// RSS Страница
	[Key.rss]: "RSS лента",
	[Key.rssDescription]: "Подпишитесь, чтобы получать последние обновления",
	[Key.rssSubtitle]:
		"Подписаться через RSS, чтобы сразу получать последние статьи и обновления",
	[Key.rssLink]: "RSS ссылка",
	[Key.rssCopyToReader]: "Скопировать ссылку в ваш RSS читатель",
	[Key.rssCopyLink]: "Скопировать ссылку",
	[Key.rssLatestPosts]: "Последние посты",
	[Key.rssWhatIsRSS]: "Что такое RSS?",
	[Key.rssWhatIsRSSDescription]:
		"RSS (Really Simple Syndication) — стандартный формат для публикации часто обновляемого контента. С RSS вы можете:",
	[Key.rssBenefit1]:
		"Получать последний контент сайта вовремя без ручного посещения",
	[Key.rssBenefit2]: "Управлять подписками на несколько сайтов в одном месте",
	[Key.rssBenefit3]: "Не пропускать важные обновления и статьи",
	[Key.rssBenefit4]: "Наслаждаться чистым чтением без рекламы",
	[Key.rssHowToUse]:
		"Рекомендуется использовать Feedly, Inoreader или другие RSS читатели для подписки на этот сайт.",
	[Key.rssCopied]: "RSS ссылка скопирована в буфер обмена!",
	[Key.rssCopyFailed]:
		"Ошибка копирования, пожалуйста, скопируйте ссылку вручную",

	// Последнее изменение
	[Key.lastModifiedPrefix]: "Последнее обновление: ",
	[Key.lastModifiedOutdated]: "Некоторый контент может быть устаревшим",
	[Key.lastModifiedDaysAgo]: "{days} дней назад",
	[Key.year]: "год",
	[Key.month]: "месяц",
	[Key.day]: "день",
	[Key.hour]: "час",
	[Key.minute]: "минута",
	[Key.second]: "секунда",

	// Статистика просмотров
	[Key.pageViews]: "Просмотры",
	[Key.pageViewsLoading]: "Загрузка...",
	[Key.pageViewsError]: "Статистика недоступна",

	// Закреплено
	[Key.pinned]: "Закреплено",

	// Похожие статьи
	[Key.relatedPosts]: "Похожие статьи",
	[Key.randomPosts]: "Случайные статьи",
	[Key.smartRecommend]: "Умный",
	[Key.randomRecommend]: "Случайный",

	// Зашифровано
	[Key.postEncrypted]: "Эта статья зашифрована",

	// Макет списка сообщений

	// Страница спонсоров
	[Key.sponsor]: "Спонсор",
	[Key.sponsorTitle]: "Поддержать меня",
	[Key.sponsorDescription]:
		"Если мой контент был полезен для вас, добро пожаловать поддержать меня следующими способами. Ваша поддержка - это движущая сила моего постоянного творчества!",
	[Key.sponsorMethods]: "Способы оплаты",
	[Key.sponsorList]: "Спонсоры",
	[Key.sponsorEmpty]: "Пока нет спонсоров",
	[Key.sponsorAmount]: "Сумма",
	[Key.sponsorDate]: "Дата",
	[Key.sponsorMessage]: "Сообщение",
	[Key.sponsorAnonymous]: "Анонимно",
	[Key.scanToSponsor]: "Сканировать для поддержки",
	[Key.sponsorGoTo]: "Перейти к спонсору",
	[Key.sponsorButton]: "Поддержка и Поделиться",
	[Key.sponsorButtonText]:
		"Если эта статья помогла вам, пожалуйста, поделитесь или поддержите!",

	[Key.shareOnSocial]: "Поделиться статьей",
	[Key.shareOnSocialDescription]:
		"Если эта статья помогла вам, пожалуйста, поделитесь ею с другими!",

	// Статистика сайта
	[Key.siteStats]: "Статистика сайта",
	[Key.siteStatsPostCount]: "Статьи",
	[Key.siteStatsCategoryCount]: "Категории",
	[Key.siteStatsTagCount]: "Теги",
	[Key.siteStatsTotalWords]: "Всего слов",
	[Key.siteStatsRunningDays]: "Дней работы",
	[Key.siteStatsLastUpdate]: "Последняя активность",
	[Key.siteStatsDaysAgo]: "{days} дней назад",
	[Key.siteStatsDays]: "{days} дней",
	[Key.siteStatsVisitors]: "Посетители",
	[Key.siteStatsPageViews]: "Просмотры",
	[Key.siteStatsLoading]: "--",
	[Key.siteStatsVisitorPrefix]: "Вы",
	[Key.siteStatsVisitorSuffix]: "-й посетитель",
	[Key.siteStatsPageViewPrefix]: "Всего просмотров:",
	[Key.siteStatsPageViewSuffix]: "",
	[Key.siteStatsHoverHint]: "Наведите для подробностей",
	[Key.siteStatsRevealLine1]:
		"{posts} статей · {categories} категорий · {tags} тегов",
	[Key.siteStatsRevealLine2]: "Всего {words} слов",
	[Key.siteStatsSource]: "Источник",
	[Key.footerRunningDays]: "Работает {days} дней",
	[Key.footerLastUpdate]: "Последнее обновление {days} дней назад",
	[Key.today]: "Сегодня",

	// Компонент календаря
	[Key.calendarSunday]: "Вс",
	[Key.calendarMonday]: "Пн",
	[Key.calendarTuesday]: "Вт",
	[Key.calendarWednesday]: "Ср",
	[Key.calendarThursday]: "Чт",
	[Key.calendarFriday]: "Пт",
	[Key.calendarSaturday]: "Сб",
	[Key.calendarJanuary]: "Янв",
	[Key.calendarFebruary]: "Фев",
	[Key.calendarMarch]: "Мар",
	[Key.calendarApril]: "Апр",
	[Key.calendarMay]: "Май",
	[Key.calendarJune]: "Июн",
	[Key.calendarJuly]: "Июл",
	[Key.calendarAugust]: "Авг",
	[Key.calendarSeptember]: "Сен",
	[Key.calendarOctober]: "Окт",
	[Key.calendarNovember]: "Ноя",
	[Key.calendarDecember]: "Дек",

	[Key.shareArticle]: "Поделиться",
	[Key.generatingPoster]: "Создание постера...",
	[Key.copied]: "Скопировано",
	[Key.copyLink]: "Копировать ссылку",
	[Key.savePoster]: "Сохранить постер",
	[Key.scanToRead]: "Сканируйте, чтобы прочитать",

	// Конфигурация блоков коллапсируемого кода
	[Key.codeCollapsibleShowMore]: "Развернуть",
	[Key.codeCollapsibleShowLess]: "Свернуть",
	[Key.codeCollapsibleExpanded]: "Блок кода развернут",
	[Key.codeCollapsibleCollapsed]: "Блок кода свернут",

	// Страница галереи
	[Key.gallery]: "Галерея",
	[Key.galleryDescription]: "Запечатлеть прекрасные моменты жизни",
	[Key.galleryPhotos]: "фото",
	[Key.galleryAlbums]: "альбомов",
	[Key.galleryNoAlbums]: "Пока нет альбомов",
	[Key.galleryBackToAlbums]: "Вернуться к альбомам",
	[Key.galleryLocalAlbum]: "Локальный альбом",
	[Key.galleryNetworkAlbum]: "Сетевой альбом",
	[Key.galleryCategory]: "Категория",
	[Key.galleryQuantity]: "Количество",
	[Key.galleryRandomFetch]: "Случайный запрос",
	[Key.galleryFetching]: "Загрузка...",
	[Key.galleryFetchError]: "Ошибка загрузки, попробуйте снова",
	[Key.galleryNoImages]: "Нет изображений, нажмите кнопку выше для загрузки",

	// Страница коллекций API
	[Key.collections]: "Коллекции",
	[Key.collectionsDescription]: "Сбор и управление часто используемыми API",
	[Key.collectionsEmpty]: "Нет сохранённых API",
	[Key.collectionsCopy]: "Копировать ссылку",
	[Key.collectionsCopied]: "Скопировано",

	// Страница статистики
	[Key.stats]: "Статистика",
	[Key.statsDescription]: "Статистика и аналитика сайта",
	[Key.statsDeveloping]: "В разработке",
	[Key.statsDevelopingDesc]:
		"Эта страница находится в разработке, следите за обновлениями",

	// Защита паролем
	[Key.passwordProtected]: "Защищено паролем",
	[Key.passwordProtectedDesc]:
		"Эта статья защищена паролем. Пожалуйста, введите пароль для просмотра содержимого.",
	[Key.passwordHint]: "Подсказка",
	[Key.passwordPlaceholder]: "Введите пароль",
	[Key.passwordSubmit]: "Разблокировать",
	[Key.passwordError]: "Неверный пароль, попробуйте снова.",
	[Key.passwordProtectedRss]:
		"Эта статья зашифрована. Пожалуйста, посетите сайт для просмотра.",

	// Календарь
	[Key.calendar]: "Календарь",
	[Key.feibichi]: "Фэйби Цзюби",
	[Key.contactMe]: "Связаться",
	[Key.qqGroup]: "QQ Группа",
	[Key.navPosts]: "Статьи",
	[Key.navMy]: "Моё",
	[Key.calendarDescription]:
		"Праздники, дни рождения, события и публикации в одном месте",
	[Key.calendarToday]: "Сегодня",
	[Key.calendarTomorrow]: "Завтра",
	[Key.calendarDaysLater]: "Через {n} дн.",
	[Key.calendarBirthday]: "День рождения",
	[Key.calendarHoliday]: "Праздник",
	[Key.calendarSchedule]: "События",
	[Key.calendarPost]: "Пост",
	[Key.calendarLunar]: "Лунный",
	[Key.calendarUpcoming]: "Скоро",
	[Key.calendarTodayEvents]: "Сегодня",
	[Key.calendarNoEvents]: "На этот день нет событий",
	[Key.calendarMore]: "ещё {n}",
	[Key.calendarBackToToday]: "К сегодня",
	[Key.calendarNearestHoliday]: "Ближайшие праздники",
	[Key.calendarNearestBirthday]: "Ближайшие дни рождения",
	[Key.calendarNearestSchedule]: "Ближайшие события",
};
