# Arkonomy — Backlog

> Накопленные задачи и готовые промпты для Claude Code.
> Обновлено: 9 июля 2026.
> Как пользоваться: копируй блок промпта в Claude Code. Отмечай `[x]` по мере выполнения.
> Порядок — сверху вниз по приоритету.

---

## 📋 ЗАПЛАНИРОВАНО — промпты готовы

### 1. Удаление отменённых подписок из Regular Payments (быстрый, независимый)

```
Вопрос: как приложение определяет, что recurring-подписка/платёж больше не активна
(юзер отменил), и через какое время она перестаёт отображаться в Subscriptions/
Regular Payments (Insights.jsx / get-insights)?

Проверь:
1. Есть ли явная логика "N месяцев без новой транзакции по этому мерчанту →
   считать cancelled и убрать из списка"? Если да — какое N, в каком файле?
2. Или подписка просто исчезает, потому что список строится по последним N
   месяцам транзакций, и как только транзакция выпадает из окна — пропадает?
3. Риск ложного удаления: подписка раз в год (Lemonade Insurance 12 мес) —
   не выпадет ли раньше времени, если detection-окно короче интервала списания?
4. Есть ли UI-сигнал "подписка, похоже, отменена" — или она молча исчезает,
   что сбивает при сверке бюджета.

Это часть общего аудита — ответь, без изменений в коде.
```

### 2. AI-ответы в приложении как финансовый коуч (ПОСЛЕ рефакторинга)

```
Нужно улучшить логику ответов AI-ассистента внутри приложения (system prompt
в edge function ai-chat) — сделать его полезным финансовым коучем, не болталкой.

ТРЕБОВАНИЯ:
1. AI читает уже посчитанный контекст (getInsight() / get-insights — availableSafe,
   savingsRate, forecast, upcoming bills, health score), НЕ пересчитывает состояние
   сам из сырых транзакций (иначе третий источник правды → новый рассинхрон).
2. Tiered-тон по состоянию:
   - Дефицит/availableSafe<=0/cash_risk: спокойно, конкретно, "вот что сделать
     сейчас". Без "trim spending" — только конкретика на данных юзера.
   - Позитив: явно подчеркнуть сильные стороны + следующий шаг роста (концептуально,
     без рекламы конкретных инструментов).
3. Анализ трат: опираться на Regular Payments/Subscriptions — указывать платежи,
   перекрывающие доход; потенциальные дубли; крупнейшие recurring по убыванию.
   Тон не морализаторский — факты и варианты, юзер решает.
4. Projection: сложный процент для иллюстрации ("$20/мес при средней доходности
   X% → через год ~$Y"), БЕЗ конкретных бумаг и БЕЗ гарантий доходности.
5. Сохранить существующий compliance-блок без изменений (no personal investment
   advice, no specific securities, no guaranteed returns, всё через Alpaca,
   educational only).

Покажи текущий системный промпт, предложи обновлённую версию, покажи как
расширить financialContext (getInsight-контекст: isWarning, isPositive,
availableSafe, top regular payments, duplicate subscriptions). Не деплой —
сначала обсудим формулировки.
```

### 3. Кредитные карты — отображение и контроль (план)

```
Спланируй (только план, не код) фичу отображения и контроля кредитных карт.
Контекст: plaid_accounts уже хранит credit-счета (type='credit',
balance_current = долг, balance_available = доступный лимит) — данные есть,
но юзеру нигде не показываются. Для "Financial Autopilot" не видеть долг
по картам — слепая зона.

По уровням, оцени каждый:
1. Отображение: где показать долг (карточка на Home? вкладка? секция Insights?),
   суммарный + по каждой карте, доступный лимит, utilization %.
2. Net picture: стоит ли ввести "net" вид (кэш минус долги) и как показать,
   не пугая юзера отрицательным числом там, где он ждёт баланс. Дай варианты.
3. Влияние на советы (важно, связано с уже чинёнными багами): при долге под
   высокий % советы про сбережения/инвестиции должны это учитывать —
   математически неверно советовать "отложи под ~4%" при долге под ~20-24%.
   Как встроить в единую логику приоритизации сигналов в get-insights?
4. Plaid liabilities product даёт APR и due dates по картам — проверь, подключён
   ли liabilities в нашем плане, что даст добавление.

Только план и объём — реализацию обсудим отдельно.
```

### 4. Предиктивные push-алерты

```
Новая фича: предиктивные push-алерты о предстоящих списаниях, на которые может
не хватить баланса. Ключевая "autopilot" фича.

Составляющие уже есть: реальный plaidBalance (plaid_accounts), upcoming bills
detection, push pipeline (VAPID, pg_cron, Supabase triggers).

ЗАДАЧА:
1. Логика (edge function или pg_cron, предложи): раз в день проверять для
   каждого юзера — есть ли в ближайшие 3 дня recurring-платежи суммой больше
   текущего plaidBalance?
2. Если да — push: "Heads up: [Merchant] $X due [tomorrow], balance $Y. You may
   want to transfer funds." Тон helpful, не тревожный. i18n 4 локали.
3. Анти-спам: дедупликация по merchant+due_date (таблица sent_alerts).
4. Уважать opt-out пушей.
5. ТОЛЬКО унифицированный источник баланса (plaid_accounts) и тот же источник
   upcoming bills, что UI — никаких новых независимых расчётов.
Покажи план перед реализацией.
```

### 5. Aha-момент в онбординге

```
Фича: мгновенный "aha-момент" сразу после подключения банка — AI даёт одну
персональную неожиданную правду о деньгах юзера в первые 60 секунд.

ЗАДАЧА:
1. После Plaid link + первого синка — полноэкранный интерстишл "Here's what we
   found" ПЕРЕД дашбордом.
2. 2-3 цепляющих факта: подписки ("$X/mo across N subscriptions" + похожие дубли);
   крупнейший recurring ("[Merchant] $X/mo — Y% дохода"); предстоящее списание
   больше баланса; fallback — top-категория трат если мало истории.
3. Карточки с поочерёдной анимацией (переиспользовать стиль онбординг-карусели).
4. CTA "See your full picture →" → дашборд.
5. Цифры из get-insights/aiBrain, не новые расчёты. Лоадер "Analyzing..." если
   ещё синкается (макс 10-15 сек, иначе на дашборд без интерстишла).
6. i18n 4 локали, Playwright happy path. Покажи макет-структуру и план.
```

### 6. Подключить все банки + агрегация multi-Item

```
Улучшение: мотивировать юзера подключить ВСЕ счета — иначе AI-инсайты на
неполной картине могут вводить в заблуждение.

ЗАДАЧА:
1. В онбординге после первого Plaid link — шаг "Connect them all for accurate
   insights" + "Add another account" / "I'm done".
2. На дашборде при 1 банке — dismissible баннер "Add your other accounts"
   (не показывать после 2 отклонений).
3. В ai-chat: при признаках неполных данных (recurring >> income) — мягко
   упомянуть "based on connected account(s), connect others for accuracy".
4. КРИТИЧНО, проверь ПЕРВЫМ: plaid-link поддерживает multi-item (не перезаписывает
   первый Item), и все расчёты (balance, transactions, recurring) агрегируют по
   ВСЕМ Items юзера, а не последнему. Если агрегация сломана — фича сделает хуже.
   Покажи результат проверки до UI-части.
```

### 7. Аудит Free → Pro воронки

```
Аудит монетизационной воронки Free → Pro перед submission. Не менять код —
сначала картина.

1. Таблица: что на Free, что за Pro ($9.99), где гейты (usePlan.js и все места).
2. Путь Free-юзера пошагово: что видит, где упирается в пейволл.
3. Оценка: успевает ли получить aha-момент ДО пейволла? есть ли причина
   возвращаться? заметна ли разница Pro, чтобы платить?
4. Edge case: что после 7-day trial — graceful downgrade или жёсткая блокировка?
   юзер понимает что произошло?
5. Рекомендации: что перенести в Free/Pro, где переместить пейволл, с обоснованием.
```

### 8. App Store submission compliance-чеклист (ПЕРЕД submission)

```
Проверка готовности к App Store review для финансового приложения. Пройди по
чеклисту, статус каждого (OK / нужен фикс / отсутствует):

1. Account deletion ИЗ приложения (не только email-запрос) — требование Apple
   5.1.1(v). Реально удаляет: Supabase user, Plaid items + tokens revoke, Stripe
   cancel, все данные?
2. Privacy Policy: явно Plaid, какие банковские данные, хранение, third parties
   (Plaid/Stripe/Alpaca/Anthropic/Firebase). Доступна ИЗ приложения.
3. Financial disclaimers "not financial advice" видимо в UI (не только Terms).
   Alpaca-требования на месте.
4. IAP (самый вероятный reject — разбери подробно): подписка Pro через Stripe
   (web). Guideline 3.1.1 — если покупка ВНУТРИ iOS-приложения, Apple требует
   IAP (30%) или reader-app исключение. Как устроен upgrade в Capacitor-версии?
   Опиши риск и варианты.
5. Permissions: purpose strings в Info.plist.
6. Demo account для ревьюеров: QA-аккаунт с подключённым банком (Plaid Sandbox)
   и транзакциями, иначе ревьюер увидит пустоту.
7. Screenshots/метаданные не обещают отсутствующего.

Таблица: пункт | статус | что делать | приоритет. Пункт 4 (IAP) — подробно.
```

### 9. Demo account для App Store ревьюеров (ручная задача, не для Claude Code)

```
Перед submission подготовить вручную QA-аккаунт для ревьюеров Apple:
1. Отдельный логин/пароль (не Test user UUID из CLAUDE.md — тот для внутренней
   разработки, состояние не гарантировано).
2. Подключённый банк через Plaid Sandbox с реалистичными транзакциями за
   несколько месяцев (чтобы Health Score, Insights, recurring/subscriptions,
   Cash Flow Forecast — везде было что показать, не пустые экраны).
3. Указать credentials в App Store Connect → App Review Information → Notes.
4. Если к моменту подачи IAP ещё не готов (см. пункт 4 чеклиста, Вариант 3) —
   убедиться, что ревьюер не видит нерабочую кнопку Upgrade на iOS.
```

### 10. Нативный push для iOS (БЛОКЕР для предиктивных push-алертов на iOS)

```
Сейчас push реализован только как Web Push (Notification API + service worker +
VAPID, profiles.push_subscription) — в iOS-сборке (Capacitor/WKWebView) это
физически не работает: iOS 16.4+ Web Push доступен только для сайтов,
добавленных на домашний экран через Safari, не для WKWebView, обёрнутого в
нативное приложение. Подтверждено анализом 9 июля — не гипотеза.

ЗАДАЧА (additive, НЕ переписывать существующий web-push путь):
1. @capacitor/push-notifications — нативный плагин, Xcode capability +
   entitlements для APNs.
2. Apple Developer: APNs Auth Key (.p8).
3. Добавить iOS-приложение (com.arkonomy.app) в существующий Firebase-проект
   arkonomy-b3f41 (сейчас там только web SDK для App Check) + GoogleService-Info.plist
   в нативный iOS-таргет + залить APNs-ключ в консоль Firebase (FCM как
   кросс-платформенный слой доставки).
4. Новая колонка profiles.fcm_token (или отдельная таблица) — приём токена
   через PushNotifications.addListener('registration', ...) на клиенте.
5. push-notify/index.ts: добавить ПАРАЛЛЕЛЬНУЮ ветку рассылки по fcm_token
   через Firebase Admin SDK/FCM HTTP v1 — существующий web-push цикл по
   push_subscription не трогать.

Оценка (9 июля): дни, не недели — код небольшой и добавляется рядом с
существующим; самое узкое место — не код, а ожидание доступов в Apple
Developer Portal / настройка Firebase-консоли.

Блокирует: пункт 4 бэклога (предиктивные push-алерты) на iOS — сама логика
проверки баланса/upcoming bills не зависит от этого, только доставка. Можно
и стоит реализовать логику алертов с доставкой сначала на веб/Android
(там push уже работает), нативный iOS push — отдельная последующая задача.
```

---

## 🧷 ТЕХДОЛГ — зафиксировано, не срочно

- [ ] `weekly-report/index.ts` (~236-237) дублирует руками формулу savings-points из `healthScore.js` — числа совпадают, риск дрейфа при будущих правках healthScore.
- [ ] `detectRecurringCharges` требует ≥2 списаний — не ловит разовый крупный счёт (первый месяц новой подписки). Тот же детектор у Dashboard Cash Flow Forecast — ошибаются синхронно.
- [ ] Health Score не имеет balance-floor: формула `calculateHealthScore()` не смотрит на баланс, "Excellent" структурно возможен при дефиците. Пока только косметика (cashPositionLow подпись). Серьёзный фикс — 5-й компонент/множитель в формуле.
- [ ] available vs current семантика при multi-account: суммирование `available ?? current` по нескольким счетам может смешать разные семантики. Для одного checking неважно. Код-комментарий добавлен в get-insights.

---

## ✅ СДЕЛАНО 9 июля (для истории)

### Рефакторинг: единый источник финансовой логики — завершён, все 5 шагов
- [x] **Шаг 1** — миграция `plaid_accounts`.
- [x] **Шаг 2** — `plaid-sync-transactions` v46 пишет реальный баланс (checking $112.02 подтверждён, кредитка отсеивается фильтром `depository`).
- [x] **Шаг 3** — get-insights: shared constants (`_shared/financialConstants.ts`) + реальный баланс из `plaid_accounts` + реальный `upcomingBills7d` через порт `recurringDetector` (`_shared/recurringDetector.ts`).
- [x] **Шаг 4** — App.jsx (`effectiveIncome` fallback по месяцу, `availableSafeToMove` капается балансом) + Dashboard.jsx (`cashPositionLow` в HealthScoreBar) — Health Score паритет Home/Insights подтверждён в приложении.
- [x] **Шаг 5** — мёртвый код удалён: `src/engine/ai-brain/*` (7 файлов: index.js, metrics.js, signals.js, prioritize.js, screenResolver.js, textRenderer.js, types.js) + `src/hooks/useInsights.js` — нигде не импортировались, бандл байт-в-байт идентичен до/после удаления.

- Savings rate 0% vs −12% рассинхрон устранён: `healthScore.js` теперь возвращает раздельные signed (для отображения) и clamped (только для очков, floor 5pts не изменился) значения `savings.rate`; убран дублирующий `actualSavingsRate` override в Insights.jsx — Home, свёрнутый и развёрнутый вид Insights теперь читают одну формулу.
- delete-account: Stripe subscription cancel + Plaid /item/remove при удалении аккаунта, таблица account_deletion_issues для разбора ошибок. Протестировано на Stripe test mode + Plaid Sandbox, оба API-контракта подтверждены.

## ✅ СДЕЛАНО 8 июля (для истории)

- Транзакции 07/04-07/06 не отображались → root cause: BofA pending lag + незарегистрированный Plaid webhook. Webhook зарегистрирован (существующий Item + авто для новых через plaid-link-token). pending сохраняется в БД + бейдж "Processing" (4 локали). Push-уведомления: silent DB write fail + onchange listener пофикшены.
- Savings-инсайт "$400 при балансе $132" → availableSafe капается реальным балансом. Рассинхрон $400 vs $50-100 устранён (одна формула).
- Insights "Excellent Savings Rate / invest surplus" при дефиците → учитывает plaidBalance, подавляет при низком балансе.
- TDZ-краш get-insights (currentBalance до объявления) → v68, get-insights ожил (был мёртв, отдавал 500, Insights маскировал fallback'ом).
- Полный аудит несостыковок финансовой логики → 6 High-находок, план рефакторинга (в работе).
