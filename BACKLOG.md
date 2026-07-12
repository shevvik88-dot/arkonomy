# Arkonomy — Backlog

> Накопленные задачи и готовые промпты для Claude Code.
> Обновлено: 12 июля 2026.
> Как пользоваться: копируй блок промпта в Claude Code. Отмечай `[x]` по мере выполнения.
> Порядок — сверху вниз по приоритету.

---

## 📋 ЗАПЛАНИРОВАНО — промпты готовы

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

### 11. Email-кампания Free → Pro (компенсация конверсии после anti-steering фикса на iOS)

```
Следствие Варианта 3 по IAP (см. "Известные компромиссы" ниже): iOS-сборка
больше не конвертирует Free → Pro вообще — ни цены, ни слова "upgrade", ни
упоминания веба нигде в приложении. Apple разрешает email-коммуникацию о
ценах/подписке ВНЕ приложения — это не 3.1.3, это обычный email-маркетинг.

ЗАДАЧА: email-кампания для Free-юзеров iOS (и вообще всех Free) с рассказом
о Pro и ссылкой на оформление на app.arkonomy.com. Нужно: сегментация
Free-юзеров (profiles.plan != 'pro'), Resend-интеграция (в CLAUDE.md уже
значится как "planned"), контент писем, частота/анти-спам, unsubscribe.
Покажи план перед реализацией.
```

---

## 📌 Известные компромиссы (product trade-offs)

- **iOS-сборка не конвертирует Free → Pro вообще** — anti-steering фикс (Guideline
  3.1.3, 10 июля) убрал из iOS не только кнопку покупки, но и любое упоминание
  цены/слова "upgrade"/веба где-либо в приложении (UpgradeModal, Trial Expired
  Modal, Markets/Savings/Profile/Insights paywall-тексты). Это осознанная цена
  Варианта 3 (быстрое прохождение ревью без интеграции StoreKit/IAP) — iOS
  теперь чисто канал **удержания** уже оплативших на вебе юзеров, не канал
  **приобретения** новых. Компенсация — задача 11 (email) выше; долгосрочно —
  Вариант 1 (настоящий Apple IAP) из чеклиста, если конверсия через веб
  окажется недостаточной.

---

## 🧷 ТЕХДОЛГ — зафиксировано, не срочно

- [ ] `weekly-report/index.ts` (~236-237) дублирует руками формулу savings-points из `healthScore.js` — числа совпадают, риск дрейфа при будущих правках healthScore.
- [ ] `supabase/functions/_shared/recurringDetector.ts` (Deno-порт, использует `get-insights` и `push-notify`) — та же проблема, что была у клиентского `src/recurringDetector.js` (удалён 12 июля): 90-дневное окно, keyword allow-list, НЕ знает про `merchant_aliases`. Клиент уже мигрирован на `computeRecurringSummary`/`getUpcomingCharges` (recurringSummary.js), но Deno не может импортировать из `src/` (та же причина, что и weekly-report/healthScore.js дублирование выше) — нужен отдельный заход на портирование alias-aware логики в Deno, не сделано сегодня.
- [ ] `App.jsx` определяет свой локальный объект `C` (design-system цвета), отдельный от `export const C` в `src/utils/colors.js` — Dashboard.jsx/Transactions.jsx импортируют `C` из colors.js, App.jsx нет. Найден реальный дрейф значения: `faint: "#4A5E7A"` (App.jsx) vs `faint: "#8BA1B7"` (colors.js) — один и тот же "приглушённый" цвет рендерится по-разному в разных частях приложения. Не тронуто (12 июля, при аудите CAT_COLORS) — `C` используется в сотнях мест App.jsx, консолидация рискованна и не связана с задачей календаря. `colors.js` также экспортирует `orange: "#F97316"`, которого нет в локальном `C` App.jsx.
- [ ] `computeRecurringSummary`/`groupExpensesByDay` (recurringSummary.js, клиент — бывший `detectRecurringCharges`, удалён 12 июля) требуют ≥2 подтверждённых списаний с консистентным интервалом — не ловят разовый крупный счёт (первый месяц новой подписки, нерегулярный платёж). Используется и в Insights, и в Dashboard Cash Flow Forecast — согласованы между собой (один источник). Deno-сторона (`_shared/recurringDetector.ts`) теперь разошлась с клиентом архитектурно, см. отдельный пункт выше.
- [ ] Health Score не имеет balance-floor: формула `calculateHealthScore()` не смотрит на баланс, "Excellent" структурно возможен при дефиците. Пока только косметика (cashPositionLow подпись). Серьёзный фикс — 5-й компонент/множитель в формуле.
- [ ] available vs current семантика при multi-account: суммирование `available ?? current` по нескольким счетам может смешать разные семантики. Для одного checking неважно. Код-комментарий добавлен в get-insights.

**ai-chat промпт tech debt (аудит 11 июля, `buildSystemPrompt()` целиком) — не критично, отложено:**
- [ ] REGULAR PAYMENTS & SUBSCRIPTIONS данные gate'уются условием `STATE is cash_risk/warning, or user asks about spending/subscriptions` — если спайк вызван подпиской, но STATE=positive и вопрос не про подписки, PRIORITY ORDER велит вести со спайком, а gate формально блокирует доступ к этим данным. Убрать STATE-условие из gate, оставить только relevance.
- [ ] WINS MATTER ("acknowledge streaks before pivoting") не имеет явного слота в RESPONSE FORMULA (3 шага, 2-4 предложения) — бюджетная теснота, не логическое противоречие. Уточнить: win = insight (шаг 1), или отдельный необязательный кейс.
- [ ] FINANCIAL STATE TIER positive велит проактивно предлагать investing-идею, но PROJECTION ILLUSTRATION (compound growth formula) разрешена только "if user asks about growth over time" — неясно, можно ли иллюстрировать проактивное предложение цифрами.
- [ ] TIME AWARENESS ("day 1-10 → conservative framing") vs FINANCIAL STATE TIER positive ("speak with confidence") — мягкое тональное напряжение в начале месяца при позитивном STATE, решается TONE-секцией ("confident but not absolute"), фикса не требует.

---

## ✅ СДЕЛАНО 12 июля (для истории)

### Устранён третий независимый источник recurring-логики
- [x] `src/recurringDetector.js` — найден как отдельная, независимая от `recurringSummary.js` реализация (90-дневное окно, keyword allow-list), молча расходившаяся в цифрах. Проверено на реальных данных теста-юзера: старый детектор считал upcoming bills 7d = $962, новый (`getUpcomingCharges`/`getUpcomingCardPayments`, оба уже существовали в recurringSummary.js) = $673.48 — расхождение из-за allow-list, пропускавшего часть мерчантов. Все импорты (`grep -rn "recurringDetector" src/`) заменены на `getUpcomingCharges`/`getUpcomingCardPayments`, файл удалён. `_shared/recurringDetector.ts` (Deno-порт, отдельный от `src/`) НЕ тронут — заведён как отдельный техдолг выше.

### Month Calendar — полный двухуровневый редизайн (grid + bottom sheet)
- [x] Level 1: 7-колоночная сетка на весь месяц (понедельник первым днём), цвет дня — категория с наибольшими тратами, интенсивность — по сумме трат за день, лог-шкала (`0.25 + 0.75 * log(1+total)/log(1+maxTotal)`), не линейная — линейная шкала визуально "съедалась" одним крупным разовым платежом (аренда) и делала все остальные дни неразличимо бледными. Тап на день → открывает Level 2, никогда не навигирует напрямую.
- [x] Level 2: bottom sheet с полной разбивкой по категориям для выбранного дня + узкая лента дня ±2 соседних дня. Переиспользован ГОТОВЫЙ UI-паттерн существующего sheet'а "Other spending breakdown" (Dashboard.jsx) — тот же visual/interaction (overlay, slide-up панель, handle, header, close), не изобретён новый компонент.
- [x] i18n: недельные заголовки (`weekday_mon`…`weekday_sun`) — реальные ключи переводов en/ru/es/pt, сознательно НЕ `toLocaleDateString` (та же непоследовательность уже была в Transactions.jsx `monthLabel`, решено не повторять).

### Три навигационных бага — найдены и исправлены до деплоя
- [x] **Взаимное исключение фильтров** — `catFilter`/`merchantFilter`/`dateFilter` в App.jsx не обнуляли друг друга при установке, из-за чего последовательные переходы (например, тап по категории после тапа по дате) комбинировались как неявный AND в Transactions.jsx. Все три handler'а (`onCatClick`, `onMerchantClick`, `onDayClick`/`onDayCategoryClick`) теперь явно обнуляют два других фильтра.
- [x] **Тап по категории в Level 2 не фильтровал по категории** — строка категории и кнопка "View all transactions" вызывали один и тот же `goToDate(selectedDay)`, разницы не было (баг найден самопроверкой при диффе кода перед показом юзеру, не по багрепорту). Добавлен отдельный путь `onDayCategoryClick(date, category)` → ставит оба фильтра сразу.
- [x] **Double-tap-to-drill-in на ленте Level 2** — тап на соседний день в ленте ошибочно сразу уводил на Transactions (копипаст обработчика категории) вместо переключения sheet'а на этот день. Исправлено на паттерн: 1-й тап на другой день → `setSelectedDay` (sheet переключается на него); 2-й тап на уже выбранный день → `goToDate` (навигация в Transactions с полной детализацией). Будущие дни — отдельная ветка, тултип вместо навигации (транзакций ещё нет).
- [x] Все три фикса проверены на реальных данных теста-юзера перед деплоем, подтверждены юзером как рабочие в проде.

### Home — финальный порядок блоков
- [x] Monthly Budget bar и Spending by Category (donut) переставлены выше Календаря — итоговая последовательность: Onboarding → Upcoming Charges → Account Balance → Cash Flow Forecast → Monthly Cash Flow → Health Score → AI Brain Insight → Budget bar → Donut → Calendar → Markets. Логика юзера: Budget→Donut→Calendar — одна смысловая цепочка про траты (от общего к частному), должна идти подряд.

### Визуальная верификация интенсивности grid + intensity для будущих дней
- [x] После деплоя юзер сообщил, что интенсивность в Level 1 grid не видна — прошедшие дни визуально одинаковы. Проверка по трём уровням (исходник → живой бандл app.arkonomy.com → `git log -S`) показала: формула `dailyIntensityAlpha` была корректно реализована и задеплоена ещё в `bb0f116`, ни разу не удалялась последующими фиксами навигации. Причина отсутствия видимой разницы — закэшированный бандл в браузере юзера, не код. Подтверждено самим юзером после hard refresh — реальная вариация яркости видна.
- [x] Отдельно найдено и исправлено (не было частью изначального плана): будущие дни в гриде красились с ФИКСИРОВАННОЙ альфой `0x33` независимо от суммы ожидаемого платежа — `dailyIntensityAlpha` для них вообще не вызывалась. Добавлена `maxFutureDayTotal` (считается отдельно от `maxDayTotal` прошлого) — раздельная шкала выбрана осознанно: прошлое — это СУММА всех транзакций за день, будущее — сумма ОДНОГО доминирующего мерчанта (разные величины по смыслу), и общий максимум (обычно аренда $2210) утопил бы все будущие платежи внизу диапазона. Проверено на реальных upcoming charges: Microsoft $9.99 → alpha 55%, Citi Card $396.58 → alpha 100%.

## ✅ СДЕЛАНО 11 июля (для истории)

### App Store submission compliance-чеклист — проверено по коду, не по памяти о коммитах
5 из 7 пунктов закрыты, оставшиеся 2 уже отдельно отслеживаются (пункт 9 выше):
- [x] Account deletion из приложения — `delete-account/index.ts`: Stripe cancel + Plaid /item/remove + полное удаление данных, триггер в Profile.jsx.
- [x] Privacy Policy — `public/privacy.html` §4 явно называет Plaid/Anthropic/Stripe/Alpaca/Firebase, доступна из Profile.jsx.
- [x] Financial disclaimers в UI — Markets.jsx + Chat.jsx/Insights.jsx, видимый текст, не только Terms.
- [x] IAP/Guideline 3.1.1 — Вариант 3 подтверждён: `IS_IOS_NATIVE` скрывает цены/Upgrade на iOS, StoreKit не подключался.
- [x] Permissions/Info.plist — N/A, приложение не использует камеру/фото/геолокацию.
- [ ] Demo account для ревьюеров — не сделано, см. пункт 9 выше.
- [ ] Screenshots/метаданные — не сделано, submission ещё не было, часть той же задачи что demo account.

### Month Calendar Strip на Home — заменяет Recent Transactions
- [x] `CAT_COLORS` консолидирована — была определена 3 раза (colors.js, неиспользуемый; Dashboard.jsx и Transactions.jsx, дублирующиеся локальные копии, байт-в-байт идентичные). Dashboard.jsx/Transactions.jsx теперь импортируют из `colors.js`, локальные копии удалены.
- [x] Горизонтальная лента дней текущего месяца: прошедшие дни — цвет по доминирующей категории трат за день (новая функция `getDailyDominantCategory`, с нуля — "This Week" виджет не подошёл, он агрегирует неделю целиком, не по дням); будущие дни — цвет по доминирующему предсказанному платежу (`getUpcomingChargesByDay`, переиспользует уже мигрированные `getUpcomingCharges`/`getUpcomingCardPayments`, не строит третий источник). Тап на прошедший день → фильтр Transactions по дате (новый `dateFilter`, по аналогии с `catFilter`/`merchantFilter`). Тап на будущий день → тултип с деталями, без навигации (транзакции ещё не существует).
- [x] **Найден и в ТУ ЖЕ сессию исправлен date-boundary баг**: `getUpcomingChargesByDay` изначально извлекала только номер дня из `expectedDate` (`slice(8,10)`) без проверки месяца/года — проекция мерчанта с интервалом, близким к "дней до конца месяца", может попасть на 1-3 число СЛЕДУЮЩЕГО месяца, и номер дня теоретически мог столкнуться с ещё не наступившим днём 1-3 ТЕКУЩЕГО месяца. Пойман тестом на реальных данных (Lemonade Insurance спроецировался на 1 августа при 19-20 днях до конца июля) ДО деплоя, не после. Фикс: проверка `expectedDate.startsWith(monthPrefix)` перед группировкой по дню. Не оставлено как открытый техдолг — закрыто сразу.
- [x] Верифицировано на реальных данных: 10 июля → Food & Dining (совпадает с ожиданием юзера по скриншотам), будущие дни (22/23/25/31 июля) — без утечки в август после фикса.
- Инфраструктура merchant navigation (`merchantFilter`, чип в Transactions.jsx) осталась нетронутой, но временно без UI-триггера — Recent Transactions (её единственная точка входа) заменена календарём. Решение отложено намеренно: искать новую точку входа после того, как календарь будет проверен в проде, не расширять скоуп сейчас.

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
