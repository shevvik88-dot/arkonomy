# Arkonomy — Backlog

> Накопленные задачи и готовые промпты для Claude Code.
> Обновлено: 13 июля 2026.
> Как пользоваться: копируй блок промпта в Claude Code. Отмечай `[x]` по мере выполнения.
> Порядок — сверху вниз по приоритету.

---

## 📋 ЗАПЛАНИРОВАНО — промпты готовы

### 13. Полный RLS-аудит по всем таблицам — ЗАКРЫТ 2026-07-17

security-auditor (opus) прошёлся по всем 14 таблиц (live `pg_tables`/`pg_policies`, не только миграции). Найдено 3 находки, все зафиксированы и исправлены:

- **HIGH — `rate_limits`**: `check_and_increment_rate_limit` (`SECURITY DEFINER`) не был зареважен от `PUBLIC`/`anon`/`authenticated` (в отличие от `login_attempts`) — любой залогиненный юзер мог звать RPC с чужим `p_user_id` и выжечь чужой rate-limit. Фикс: `REVOKE EXECUTE ... FROM PUBLIC, anon, authenticated; GRANT ... TO service_role`. Применено, проверено вживую (`information_schema.routine_privileges`).
- **HIGH — `profiles.alpaca_access_token`**: живой Alpaca trading OAuth-токен грузился в браузер целиком ради `!!token`. Фикс: новый RPC `has_alpaca_token()` (без `SECURITY DEFINER`, без параметров, работает через существующий `profiles_owner_select` RLS) — токен больше не покидает сервер. Заодно проверен `alpaca_refresh_token` на тот же паттерн — чисто, нигде не читается клиентом.
- **MEDIUM → расширено при расследовании — дрейф миграций**: обнаружилось, что **6** таблиц (`profiles`, `categories`, `savings`, `transactions`, `investments`, `notification_preferences`), а не только `investments`, вообще не имеют `CREATE TABLE` ни в одной миграции — созданы до того, как в проекте завели папку миграций. Закрыто 6 отдельными baseline-миграциями (`20260412000000`-`20260412000005`), каждая — реальная live-схема через `information_schema`/`pg_constraint` (не по коду приложения), с датой раньше первой существующей миграции, трогающей эту таблицу — чтобы чистый replay с нуля реально воспроизводил прод. Каждая миграция прошла code-reviewer + security-auditor по отдельности перед применением, каждая — подтверждённый no-op на живой базе.

Все 5 таблиц изначально без policies (`plaid_items`, `plaid_accounts`, `account_deletion_issues`, `login_attempts`, `rate_limits`) подтверждены как легитимный паттерн service-role/RPC-only — клиент их нигде не читает напрямую (grep). `plaid_items` без SELECT — по-прежнему осознанное решение, не трогали.

### 14. Rate limiting / cost guard на ai-chat — ЗАКРЫТ 2026-07-26, уже был реализован ранее

Проверено на живом задеплоенном бандле (не только в исходниках, через `get_edge_function`) — доделывать нечего:

- `ai-chat/index.ts:41-42` — `enforceRateLimit(user.id, "ai-chat")` сразу после `auth.getUser(token)` (реальный ID юзера, не клиентский), до парсинга body и до вызова Anthropic API.
- `_shared/rateLimit.ts`: `RATE_LIMITS['ai-chat'] = 20`, честный скользящий часовой лимит через `check_and_increment_rate_limit` RPC (`20260610000000_rate_limits.sql`) — не заглушка, реальный `window_start < NOW() - INTERVAL '1 hour'` сброс.
- RPC защищена: `20260717000000_revoke_rate_limit_rpc.sql` — `REVOKE ... FROM PUBLIC/anon/authenticated`, `GRANT ... TO service_role` (найдено и исправлено при RLS-аудите 17 июля) — клиент не может дёрнуть RPC напрямую с чужим `p_user_id`.
- Fail-open при ошибке БД (`if (error) return null`) — корректно: это reliability-guard cost-контроля, не access-control, падение проверки не должно блокировать легитимных юзеров.

App Check (упомянутый в исходной задаче) закрывает анонимный спам на транспортном уровне — оба слоя защиты уже на месте, новый код не требуется.

### 15. Weekly digest push

```
Уже частично упоминалось (email digest toggles в Notification preferences
UI, CLAUDE.md Next tasks #4), но стало дешевле собрать: теперь есть
честный календарь трат, scheduled payments, частично рабочий push
pipeline (push-notify batch-скан уже перебирает юзеров с
push_subscription). Дайджест вида "на этой неделе потратил $X, на 12%
меньше прошлой" — даёт причину открывать приложение регулярно, не только
по алертам.

ЗАДАЧА: план (не код) — откуда брать сравнение неделя-к-неделе (тот же
источник, что Cash Flow Forecast/Insights, не новый расчёт), периодичность
(раз в неделю, какой день), анти-спам, opt-out. Покажи план перед
реализацией.
```

### 16. Аудит экранов — ВЕСЬ СПИСОК ЗАКРЫТ 2026-07-25 (Dashboard/Home, Transactions, Insights, Recurring, Savings, Markets/StockDetail, Profile/Settings)

**Dashboard/Home — done, коммит `a5d4453`.** Полный проход по `Dashboard.jsx` (не только недавние правки), находки разбиты на функциональные/визуальные/App Store readiness, обе группы зафиксированы отдельным ревью code-reviewer перед деплоем каждой:

- Функциональные: Account Balance, `MonthCalendar`, Monthly Cash Flow не проверяли `bankConnected` вообще (тот же класс бага, что уже чинили в CashFlowForecast, `Dashboard.jsx:614`) — теперь все переиспользуют общий `ConnectBankPrompt`. Welcome-баннер больше не показывает "Connect Bank" тому, кто банк уже подключил (переходное состояние first-sync). Живой i18n-баг — Monthly Cash Flow сравнивал `item.label === "Net"` с переведённой строкой, молча ломался на ru/es/pt — фикс на стабильный `item.key`.
- Визуальные/консистентность: 4 aria-label обёрнуты в `t()` (7 новых ключей на 4 локали); хардкод-цвета вынесены в `C` object (точные совпадения — на существующие константы, новые — именованные `C.bgDeep`/`C.cardBgStart`/`C.amber`/`C.emerald`); 2 из 3 "тёмная карточка" градиентов унифицированы в `C.cardBgStart`; хардкод `"en-US"` заменён на `undefined` (2 места); мёртвые пропсы `balance`/`totalSpent`/`upcomingCharges` убраны из `CashFlowForecast`.
- Осознанно не тронуто: welcome-баннер градиент (`linear-gradient(135deg,#0D2A4A,#0B1A30)`, другой угол + cyan-рамка/тень) — намеренный CTA-акцент, не дрейф, подтверждено пользователем.
- Найдено, не в скоупе: onboarding-тур шаг 1 (`OnboardingFlow.jsx:12`) — copy не подходит под состояние `ConnectBankPrompt` (см. ТЕХДОЛГ ниже).

**Transactions — done, коммиты `d88ba13`, `9f01d56`, `2873a27`, `ae8bfe5`, `fa878b7`, `7c1d765`.** Полный проход по `Transactions.jsx`:

- Функциональные: Income/Expenses breakdown sheet считался по all-time транзакциям вместо текущего месяца (не совпадал с заголовком sheet'а) — исправлено на `effectiveCurTxs`, тот же баг нашёлся и в Income sheet, не только в Expense. Убраны 5 фейковых UI-действий ("Move to Savings"/"Flag" в QuickActionsMenu, 3 CTA в BreakdownSheet) — показывали success-тост без реального сохранения. `bankConnected` + `ConnectBankPrompt` добавлены (экран вообще не проверял банк). Удалён мёртвый `AIInsightCard`/`INSIGHT_DEFS` (~250 строк, ни разу не рендерился) + orphan-файл `InsightCard.jsx` — подключён реальный `InsightCard` из `Insights.jsx`.
- Визуальные/дублирование: локальная `CatIcon`-мапа в `AddTransactionModal` дублировала уже импортированные `CAT_COLORS`/`CAT_ICONS_MAP` — консолидировано, заодно поймало реальный дрейф (Travel-иконка отличалась от остального экрана).
- i18n: aria-label "Previous/Next month" + оставшиеся хардкод-тосты/sheet-тексты обёрнуты в `t()` (4 локали).

**Insights.jsx — done, коммиты `3d144fe`, `91eca35`, `4f7d81d`, `1e10e9b`, `8289466`, `2d606fe`, `9009ee7`.** Полный проход по `Insights.jsx`:

- **Самое критичное**: локальный fallback-инсайт (срабатывает когда бэкенд `get-insights` не вернул `allInsights` — ровно сценарий нового юзера без единой транзакции) кормил `calculateHealthScore({totalIncome:0, totalSpent:0,...})` — формула на чистых нулях отдаёт не 0, а ~62/100 (floor/neutral-логика по каждому из 4 компонентов), из-за чего юзеру без единой транзакции показывалась сфабрикованная карточка "Some areas to watch — your finances are mostly stable". Все остальные секции экрана (`HealthScore`, `WeeklySummary`, `RecurringSummary`) уже честно гейтились на отсутствие данных — только эта не гейтилась. Фикс: `hasNoData` гейт (`totalIncome===0 && totalSpent===0`) перед всеми вычислениями + `bankConnected`/`ConnectBankPrompt` (тот же паттерн, что на Dashboard/Transactions) — один гейт закрыл оба бага сразу.
- Дублирование: `InsightCardControlled` (использовался только на самом экране Insights через `InsightCardGroup`) разошёлся с экспортируемым `InsightCard` (Dashboard/Savings/Transactions) — не умел goal_off_track мини-карточку, round-up CTA, automate-roundups подсказку. Один и тот же инсайт выглядел по-разному в зависимости от экрана. Консолидировано в `InsightCard` с опциональным controlled-режимом (`expanded`/`onToggle`), `InsightCardControlled` удалён целиком (104 строки). Заодно убрана мёртвая переменная `cleanCta` (считалась, нигде не использовалась) из обоих компонентов.
- Мёртвый код: `getMerchantDomainCandidates()` (22 строки, ни разу не вызывалась) удалена.
- Цветовая консолидация: `#4A5E7A` хардкодился в 4 местах (Insights/OnboardingFlow×2/UpcomingChargesCard) — это оказалось точным значением ЧУЖОГО, уже задокументированного как дрейф `C.faint` из локального `C`-объекта `App.jsx` (не из `colors.js`); стандартизировано на `colors.js`'s `C.faint`. `rgba(154,164,178,X)` (7 мест) — точный RGB-эквивалент `C.muted`, переведено на `C.muted + hex-альфа`. Round-up-CTA акцент (`rgba(75,108,183,...)`/`#8BA7E8`) не совпадал ни с одним существующим цветом — заведены новые именованные константы (`C.roundupAccent*`), не смешаны с существующей палитрой.
- `ConnectBankPrompt` по ходу вынесен из `Dashboard.jsx` в `src/components/shared/ConnectBankPrompt.jsx` — прямой импорт в `Insights.jsx` создавал бы circular import (`Dashboard.jsx` уже импортирует `InsightCard` из `Insights.jsx`).
- Также обёрнут в `t()` большой оставшийся i18n-пробел: `getSmartCta()` CTA-лейблы, "Available"/"Safe to move"/"Goal"-fallback, весь текст локального fallback-массива (6 генераторов инсайтов, включая AI-context строки, которые реально уходят в чат).

**Recurring — done, коммиты `fa1fc49`, `6fd79b4`, `9243d7b`, `415e44e`.** Не отдельный экран (в App.jsx нет раута "recurring") — полный проход по `recurringSummary.js` (ядро логики) + `UpcomingChargesCard.jsx` (Dashboard-карусель); `RecurringSummary`-компонент внутри `Insights.jsx` уже покрыт прошлым аудитом, не повторяли; `_shared/recurringDetector.ts` (Deno) сознательно не включён — уже прошёл security-auditor + live-verification отдельным процессом при миграции push-notify:

- **Самое критичное, живой баг**: `getUpcomingCharges`/`getUpcomingCardPayments` считали `daysUntil = Math.round((nextDate - referenceDate) / MS_PER_DAY)` — `nextDate` всегда выровнен на полночь, а `referenceDate` — сырой `new Date()` с текущим временем суток; рядом уже был корректно посчитанный `todayStart` (полночь), но использовался не он. Один и тот же платёж на "завтра в полночь" показывал "Today" вечером и "Tomorrow" утром. Тот же баг-класс уже задокументирован в Known issues для Deno-версии (`_shared/recurringDetector.ts:211`), но там он признан не срочным из-за фиксированного cron в 09:00 — здесь обе функции вызываются живьём в любое время суток и затрагивают все 3 потребителя (карусель Upcoming Charges, Cash Flow Forecast, Month Calendar), то есть клиентская версия была больше подвержена этой проблеме. Исправлено на `todayStart` в обеих функциях.
- Функциональное: карусель "Upcoming Charges" на Home молча не учитывала платежи по кредитке — `App.jsx`'s `upcomingCharges` state считался только через `getUpcomingCharges()`, без мержа с `getUpcomingCardPayments()`, хотя `Dashboard.jsx`'s собственные Cash Flow Forecast и Month Calendar уже мержили обе функции. Добавлен `getUpcomingChargesForCarousel()` тем же паттерном, что уже в Dashboard.jsx.
- Цветовая консолидация: `#FF5C7A`/`#FFB800`/`#1E2D4A` → `C.red`/`C.yellow`/`C.border` (точные дубли). `#FF9320` — оказался реально переиспользуемым акцентом (тот же хекс независимо хардкодился в `CheckInCard.jsx`'s `UPCOMING_CHARGES`-состоянии) — заведена именованная `C.urgentOrange`, не смешана с близким, но другим `C.orange`. `#EEF4FF`/`#4A6480` (текст названия/даты платежа, больше нигде в проекте) — заведены `C.chargeCardText`/`C.chargeCardDate` отдельной группой под будущие похожие "glass card" карточки.
- i18n: `UpcomingChargesCard.jsx` не имел вообще ни одного `t()` — заголовок "Upcoming Charges" (переиспользовал уже существующий, но нигде не подключённый ключ `dashboard.upcoming_charges`) + urgency-лейблы Today/Tomorrow/{{n}}d обёрнуты в `t()` (4 локали).

**Savings — done, коммиты `d4c5eac`, `36f8085`, `1fd81ac`, `b08d0da`, `526792d`, `0a57df8`.** Полный проход по `Savings.jsx`:

- **Самое критичное**: "All Time" round-up тайл показывал `roundupTotal = roundupBase * roundupMultiplier * 3.2` — необъяснённый множитель `3.2`, в приложении нет таблицы, которая бы реально копила историю round-up-инвестиций, то есть это не факт, а синтетическая проекция. Рядом — захардкоженная строка `"+12.4% avg yield"`, показывалась всегда, независимо от того, включены ли round-ups и было ли реальное инвестирование хоть раз. В финтех-приложении сфабрикованная "доходность" рядом с настоящими цифрами — риск ревью App Store и прямое введение в заблуждение. Тайл убран целиком, остался только честный "This Month" (реальные данные из транзакций).
- Функциональное, найдено но не в скоупе (занесено в ТЕХДОЛГ ниже): `monthlyRate` для проекции даты цели считает ВСЕ `type==="income" && category_name==="Transfer"` транзакции месяца без привязки к конкретной цели (нет `goal_id` в транзакциях) — при 2+ целях каждая карточка независимо посчитает одну и ту же сумму трансфера "своей", задваивая прогноз.
- i18n-баг, не просто пробел: `` ✨ {t("upgrade.benefit_investing_title")} goal reached! `` — неправильно переиспользованный чужой ключ (означает "Spare Change Investing", из upsell-экрана) склеенный с хардкод-английским, рендерился как бессмыслица "Spare Change Investing goal reached!". Заведён свой `savings.goal_reached` с интерполяцией имени цели.
- Переведена кнопка реального финансового действия — "Confirm & Place Order" (подтверждение Alpaca-ордера).
- Дни недели напоминаний (short + full names) переведены — short переиспользуют уже существующий `day.mon`/`day.tue`/... namespace (использовался в Insights.jsx), full names — новые `day.monday`/... По ходу того же фикса пойман и исправлен грамматический баг: фолбэк `"your bank"` вместе с шаблоном `"in your {{bank}} app"` давал дубль "in your your bank app" — фолбэк исправлен под грамматику каждой локали отдельно (ru/es/pt имеют разные предложные конструкции, не буквальный перевод).
- Мёртвый код: `isDeficit` (считался дважды, нигде не использовался), `roundupYearly` (нигде не использовался) — удалены.
- Цветовая консолидация: `#A78BFA` → `C.purple` (точное совпадение).
- Найдено, не в скоупе (занесено в ТЕХДОЛГ ниже): `#7C6BFF` ("Pro"-акцент) используется в 6 файлах проекта, нигде не заведён именованной константой — консолидация выходит за рамки одного экрана.
- Уже хорошо: `bankConnected` — единственный из проверенных экранов, где он изначально был на месте и корректно использовался (привязка цели к реальному счёту + честная ветка без банка); напоминания — реальные Supabase-записи + реальный push, не фейковый тост.

**Markets/StockDetail — done, коммиты `67c4245`, `7803732`, `4d4f28c`, `e76c056`, `e620eaf`.** Полный проход по `Markets.jsx` (включает `StockDetail` — отдельного файла нет, компонент живёт в том же файле):

- **Самое критичное**: AI-таб при отсутствующем `ANTHROPIC_API_KEY` показывал юзеру буквальную dev-инструкцию — "ANTHROPIC_API_KEY is not configured in Supabase secrets. Run: supabase secrets set ANTHROPIC_API_KEY=your_key" — раскрытие внутренней инфраструктуры постороннему плюс бессмысленная для обычного юзера CLI-команда. Buy-таб показывал сырой `buyResult.error` от Alpaca напрямую, тоже без фильтрации. Общий принцип применён: сырая ошибка бэкенда никогда не должна попадать в UI как есть — `stock-ai-analysis`/`alpaca-invest` уже покрыты Sentry на бэкенде, этого достаточно для дебага. Заменено на общие переведённые сообщения.
- Дублирование форматирования: Portfolio-блок форматировал деньги сырым `.toFixed(2)` вместо `fmtPrice()`, который используется во всех остальных частях экрана — для крупных сумм это давало "$12345.67" без разделителя тысяч вместо "$12,345.67" как везде на экране. `unrealized_pl` заодно получил `$`-префикс, которого не было вообще.
- i18n: "shares" (Portfolio) переведено.
- Цветовая консолидация: `#FFB800` → `C.yellow` (точное совпадение, уже используется в этом же файле в AI-табе). `#C8B86A` (Alpaca-disclaimer текст) — локален только этому файлу, заведена именованная `C.alpacaWarningMuted`. `#F5C842`/`#F5A623` (тот же Alpaca-блок) — оказались разделены с `App.jsx`, тот же класс, что уже залогированный `#7C6BFF`-техдолг из Savings-аудита — не консолидировано сейчас, занесено в ТЕХДОЛГ отдельным пунктом (для `#F5A623` смысловая связь между экранами не подтверждена).
- Уже хорошо: этот экран про инвестиции (Alpaca), не про банк — `bankConnected` неприменим, релевантный гейт `alpacaConnected` уже был на месте и корректно использовался (Buy-таб и Portfolio-секция честно показывают "Connect Alpaca", если не подключено). `handleBuy`/`runAiAnalysis` — реальные вызовы, не фейковые тосты. `MARKET_META` — единственный источник цвета/иконки тикера, без дублирования.

**Profile/Settings — done, коммиты `02437cc`, `ed7affb`, `86dbe5e`, `bd5fcdf`, `844a7d8`, `66d7123`.** Полный проход по `Profile.jsx` (Settings — тот же файл, отдельного нет):

- **Самое критичное**: единственное необратимое действие на всём экране (Delete Account — заголовок модалки, предупреждающий текст, "Type DELETE to confirm", кнопки) было целиком на английском. Переведено первым, до всего остального.
- Функциональное, реальный баг: `notification_preferences` содержит 7 полей, которые Profile.jsx даёт юзеру переключать, но `weekly-report` реально уважал только 3 из них (frequency/spending/balance/ai_tip) — `include_upcoming_bills` и `include_market_update` сохранялись в БД, но не влияли на письмо вообще, "тумблер ничего не делает". Разделённое решение: `include_upcoming_bills` реализован полностью (переиспользован уже готовый `_shared/recurringDetector.ts`, тот же паттерн, что `get-insights`; в письме показывается `category`, не `merchant`, — сырой банковский дескриптор в реальном письме был бы хуже, чем его отсутствие, `cleanMerchantName` сознательно не портирован в Deno в этом заходе). `include_market_update` — тумблер скрыт из UI (нет бэкенд-потребителя, реализация — новая интеграция market-data внутри weekly-report, отдельная задача).
- i18n: крупнейший пробел всей серии аудитов — блок "Notifications & Reports" (~90 строк, заголовок/подзаголовок/frequency-кнопки/5 тумблеров/Excel-секция/кнопка сохранения) был целиком на английском, ни одного `t()`. Плюс `pwError()` (валидация пароля), кнопка "Reconnect Bank", budget-vs-income warning — тоже переведены.
- Цветовая консолидация: `#F59E0B` → `C.amber` (точное совпадение). `#1A56DB` ("Plaid/bank-connect blue", 5 повторов в этом файле) оказался разделён ещё с 2 файлами (`OnboardingFlow.jsx`, `shared/PlaidLinkButton.jsx`) — тот же класс, что уже залогированные `#7C6BFF`/`#F5C842`/`#F5A623`, не консолидировано сейчас, занесено в ТЕХДОЛГ.
- Уже хорошо: Delete/Export/ChangePassword — реальные вызовы, не заглушки; Face ID toggle честно задизейблен с "Coming soon"; "Coming Next" — честные плейсхолдеры, не выдают себя за рабочую функциональность.

Тот же шаблон (три категории, ничего не чинить без подтверждения, коммит после каждой группы перед следующей — см. CLAUDE.md Coding rules) — экран был последним в исходном списке BACKLOG #16; итог всей серии см. ниже.

```
Для каждого экрана по очереди (Profile/Settings) —
(а) полный список блоков/секций на экране,
(б) проверка на избыточность/дублирование путей к одной и той же информации
    (тот же класс проблемы, что recurringDetector.js/CAT_COLORS/C-объект —
    искать явно, не предполагать что всё чисто),
(в) оценка, что нуждается в той же дисциплине, что получил Dashboard/Home
    (единый источник, честные пустые состояния, разумные пороги, bankConnected
    gating, i18n-полнота),
(г) рассмотреть объединение/удаление избыточных блоков,
(д) явно отметить, что уже хорошо — не переписывать то, что не сломано.
Покажи находки по каждому экрану перед любыми правками.
```

### 18. Расширить Sentry-мониторинг на остальные edge functions — ПОЛНОСТЬЮ ЗАКРЫТ (перепроверено 2026-07-26: 21/21 функций)

10 функций высокого приоритета (деньги/чувствительные операции) — все 10 готовы, подтверждены в Sentry dashboard. Далее — 9 среднего:

**Высокий приоритет:**
- [x] `delete-account` — готово 14 июля. `verify_jwt: true` (в отличие от ai-chat/get-insights, у которых `false`) — первая проверка Sentry-паттерна на пути, где JWT валидируется гейтвеем ДО кода функции; подтверждено рабочим. Функция не имела единого try/catch вокруг хендлера (только точечные try/catch вокруг Stripe/Plaid best-effort вызовов, намеренно проглатывающих ошибки в `account_deletion_issues`) — добавлен один общий try/catch вокруг всего тела, точечные оставлены нетронутыми. Событие подтверждено в dashboard (`function_name: delete-account`, `handled: true`). По пути найден и исправлен баг тестового скрипта (не в проде): `$ApiKey` потерялась при ручной правке `.ps1`, из-за чего `Invoke-WebRequest` падал `NullReferenceException` до сети — воспроизведено на dummy-токене, не реальный Sentry/деплой баг.
- [x] `stripe-checkout` — готово 14 июля. `verify_jwt: false` (auth в коде, как ai-chat/get-insights). Уже был единый try/catch на весь хендлер — добавлен только import/init + `captureAndFlush` в существующий catch, тест-хук через `?__sentryTest=1` (функция не читает body). Событие подтверждено в dashboard (`function_name: stripe-checkout`, `handled: true`).
- [x] `plaid-sync-transactions` — готово 14 июля. `verify_jwt: false`. Уже был единый try/catch на весь хендлер (admin resync_all/sync_item + обычный per-user sync в одной функции) — добавлен только import/init + `captureAndFlush`, тест-хук сразу после парсинга body, до всех веток (admin и обычной). Событие подтверждено в dashboard (`function_name: plaid-sync-transactions`, `handled: true`).
- [x] `plaid-link-token` — готово 14 июля. `verify_jwt: false`. Единый try/catch уже был — добавлен только import/init + `captureAndFlush`, тест-хук после парсинга body, до реального Plaid `/link/token/create` вызова. Событие подтверждено в dashboard (`function_name: plaid-link-token`, `handled: true`).
- [x] `alpaca-invest` — готово 14 июля. `verify_jwt: false`. Единый try/catch уже был — добавлен только import/init + `captureAndFlush`, тест-хук после парсинга body (пришлось разбить одну строку деструктуризации на присвоение+деструктуризацию, чтобы получить доступ к `__sentryTest`), до реальных Alpaca account/order вызовов. Событие подтверждено в dashboard (`function_name: alpaca-invest`, `handled: true`).
- [x] `alpaca-portfolio` — готово 14 июля. `verify_jwt: false`. Read-only, не читает body — тест-хук через `?__sentryTest=1` (как stripe-checkout), сразу после auth, до реальных Alpaca account/positions вызовов. Событие подтверждено в dashboard (`function_name: alpaca-portfolio`, `handled: true`).
- [x] `stripe-webhook` — готово 14 июля. Единственная функция без Bearer JWT auth (проверка подлинности через `stripe-signature` HMAC). Тест-хук отличался от остальных 6: не хардкоженный маркер в коде (риск для платёжного вебхука, даже временный), а сравнение `stripe-signature` с одноразовым секретом `SENTRY_TEST_MARKER` (сгенерирован `openssl rand -hex 24`, установлен только на время теста через `supabase secrets set`, удалён сразу после подтверждения через `secrets unset`). Реальная `constructEventAsync`-верификация не тронута ни строкой. Событие подтверждено в dashboard (`function_name: stripe-webhook`, `handled: true`). После очистки проверено: старый маркер-значение теперь даёт `400 Webhook Error` (не 500) — байпас полностью убран, невалидная подпись отклоняется как и до изменений. Позитивный кейс (валидная Stripe-подпись всё ещё проходит) не перепроверен вживую — нет доступа к Stripe Dashboard "Send test webhook"; риск минимален, т.к. сама строка `constructEventAsync(...)` не менялась ни на символ.
- [x] `plaid-exchange-token` — готово 14 июля. `verify_jwt: false`. Единый try/catch уже был — добавлен только import/init + `captureAndFlush`, тест-хук сразу после парсинга body, до валидации `public_token` и до реального Plaid `/item/public_token/exchange` вызова. Событие подтверждено в dashboard (`function_name: plaid-exchange-token`, `handled: true`).
- [x] `plaid-batch-sync` — готово 14 июля. pg_cron джоба, требует именно service role key как Bearer (`token !== serviceKey`, `verify_jwt: true` на гейтвее). Есть отдельный per-item try/catch (проглатывает ошибку одного банка, продолжает батч, собирает в `errors` ответа) — НЕ инструментирован Sentry намеренно, это ожидаемое поведение; только внешний catch (полный отказ батча) получил `captureAndFlush`. Три попытки скопировать реальный service role JWT из Dashboard дали три разных значения, ни одно не совпало по SHA256 с digest в `supabase secrets list` — вместо продолжения поиска (или тем более ротации самого `SUPABASE_SERVICE_ROLE_KEY`, что сломало бы admin-доступ во ВСЕХ функциях сразу) применён тот же маркер-паттерн, что на `stripe-webhook`: одноразовый `SENTRY_TEST_MARKER` секрет, сверяется с заголовком `x-sentry-test` ДО реальной проверки `token !== serviceKey`. Реальная проверка не тронута ни строкой, подтверждено после очистки (маркер теперь падает в `403`, не `500`). Событие подтверждено в dashboard (`function_name: plaid-batch-sync`, `handled: true`).
- [x] `alpaca-oauth-callback` — готово 14 июля. Структурно самая нестандартная из 10: браузерный OAuth-redirect endpoint (Alpaca редиректит юзера сюда напрямую), нет ни одного `throw`, каждая ошибка обрабатывается вручную через `Response.redirect(...?alpaca_error=...)`, не JSON-ответ. Не было единого try/catch — добавлен (как в delete-account) вокруг всего хендлера, редиректит на `?alpaca_error=unexpected_error` вместо голого краша при неожиданной ошибке. `captureAndFlush` добавлен в 3 из 4 уже существующих веток отказа (token exchange failed, auth failed, db error) — НЕ добавлен в non-fatal account-ID fetch (тот же класс "намеренно проглоченное", что per-item catch в plaid-batch-sync). `verify_jwt: false`, гейтвей вообще не требует apikey/Authorization для этого эндпоинта (публичный redirect-callback, авторизация через `state`-параметр). Событие подтверждено в dashboard (`function_name: alpaca-oauth-callback`, `handled: true`).

**ВСЕ 10 ФУНКЦИЙ ВЫСОКОГО ПРИОРИТЕТА ЗАКРЫТЫ 14 июля**, каждая подтверждена реальным событием в Sentry dashboard (`arkonomy-edge-functions`), не просто "код выглядит правильно".

**Средний приоритет — ПОДТВЕРЖДЁН ЗАКРЫТЫМ 2026-07-26** (запись была устаревшей, не отмечена закрытой после фактического завершения в одной из прошлых сессий — закрытие проверено сейчас напрямую по коду, не по памяти): `grep initSentry\( supabase/functions/*/index.ts` — все 9 функций очереди (`weekly-report`, `push-notify`, `plaid-webhook`, `plaid-get-accounts`, `market-data`, `generate-monthly-report`, `stock-ai-analysis`, `check-bank-connection`, `auth-login`) содержат `initSentry(`. Итог: **21 из 21** директорий edge-функций проекта покрыты Sentry — полное совпадение с числом реальных папок в `supabase/functions/`, ни одна не пропущена.

### 19. "Refresh balance now" кнопка — ЗАБЛОКИРОВАНО на стороне Plaid (не код), код полностью готов и протестирован

Найдено 2026-07-17 при диагностике лага обновления баланса "до суток": код нигде не вызывает Plaid `/transactions/refresh` (принудительный переопрос банка Plaid'ом прямо сейчас) — только `/transactions/sync` (читает то, что Plaid уже закэшировал у себя, без гарантии свежести).

**Реализовано 2026-07-26, все 3 части, code-reviewer — ship it на каждой:**
1. Миграция `20260726000000_balance_refresh_cooldown.sql` — `profiles.last_balance_refresh_at` + атомарная `SECURITY DEFINER` RPC `check_and_set_balance_refresh` (5-минутный cooldown, `REVOKE`/`GRANT` сразу, не задним числом).
2. Новая edge function `plaid-refresh-balance` — форсирует `/transactions/refresh` для каждого `plaid_items` юзера, server-side cooldown enforcement, `config.toml` запись `verify_jwt = false` (не полагаясь на CLI-флаг, тот же урок, что и сегодняшний cron-verify_jwt инцидент).
3. UI-кнопка в `Profile.jsx`, рядом с "Sync Now" — loading-стейт, client-side cooldown-countdown (5 мин), 2 отложенных повторных фетча (15с/45с) для подхвата данных после реального вебхука.

**Live-тест (2026-07-26) нашёл блокер — не баг реализации:** реальный вызов дошёл до Plaid и получил `400 INVALID_PRODUCT`: `"client is not authorized to access the following products: [\"transactions_refresh\"]"`. Auth/cooldown/RPC — всё отработало правильно; сам Plaid-клиент проекта не имеет доступа к продукту `transactions_refresh`. Это, вероятно, не самостоятельный переключатель в Dashboard, а гейтированная возможность, требующая отдельного запроса через Plaid Support/account manager — нужно проверить Team Settings → API → Products в Plaid Dashboard и, если там нет `Transactions Refresh`, запросить доступ у Plaid до включения кнопки.

**Кнопка скрыта до подтверждения доступа** — `REFRESH_BALANCE_ENABLED = false` в `Profile.jsx` (одна строка, комментарий с деталями), весь остальной код нетронут и готов — просто флип в `true`, когда Plaid подтвердит продукт. Коммит `f2229ba`. НЕ включать в проде до подтверждения.

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

### 20. Source-map upload — ни Sentry, ни PostHog сейчас не получают читаемые стектрейсы прод-билда

```
Найдено 2026-07-27 при разборе posthog-setup-report.md чек-листа
("Verify before merging"): в проекте нет CI, который делает билд/деплой
(только Semgrep + dependency-review GitHub Actions — Vercel билдит
напрямую на push, не через Actions). Проверил vite.config.js — там нет
@sentry/vite-plugin и никакого upload сорсмапов вообще. Значит Sentry
стектрейсы в проде УЖЕ, вероятно, минифицированы и трудночитаемы — это
не новая проблема от PostHog, она просто всплыла при его чек-листе.

ЗАДАЧА: настроить upload сорсмапов и для Sentry (@sentry/vite-plugin
или posthog-cli-стиль release step), и для PostHog (posthog-cli
sourcemap) — реалистичнее как build-time шаг в package.json (например
postbuild), а не GitHub Actions, раз тут нет билд-CI, куда это
включать. Покажи план перед реализацией — два разных сервиса, возможно
разный upload-механизм под каждый.
```

---

## 🧭 Long-term / product roadmap

> Направления, не задачи — без конкретного плана реализации. Не начинать без отдельного планирования.

### Shared/family account

Возможность объединить аккаунт с супругом(ой): общий вид транзакций, общий
бюджет, но с сохранением приватности отдельных данных где нужно. Нужно
решить: полностью общий доступ, или раздельные аккаунты с shared view.

Затрагивает: RLS-модель (сейчас per-`user_id`), Plaid-подключения (несколько
банков от разных людей в одном "домохозяйстве"), UI (переключение между
"my/shared" view). Крупная архитектурная задача.

### Business/team version

Версия для малого бизнеса: несколько пользователей с ролями
(owner/accountant/viewer), отдельная бизнес-подписка (Free/Pro plan gating
уже есть, нужен третий tier), возможно отдельные Plaid-подключения на
business-счета. Не стартовый MVP-фокус.

### Transaction quick-actions — "Move to savings" / "Flag" / breakdown-sheet CTA

Убраны из `Transactions.jsx` при аудите экрана (2026-07-19) — были
UI-заглушками: показывали success-тост, но ничего не сохраняли
(ни в БД, ни даже в локальном state), так что "перевод в накопления"
или "флаг" пропадал при следующей перезагрузке. В fintech-приложении
это вопрос доверия — решили убрать, а не оставлять как decorative UI.

Если решим реализовать по-настоящему:
- "Move to savings" (из QuickActionsMenu транзакции + из Income/Net
  breakdown sheet) — нужен реальный перевод суммы в конкретную savings
  goal (таблица `savings` уже есть), не просто тост.
- "Flag as unusual" — нужно поле на транзакции (`transactions.flagged`
  или аналог) + персистентность, иначе это опять декоративная кнопка.
- "Set category limit" (Expense breakdown sheet) — нужна модель
  бюджетов по категориям, которой сейчас в схеме нет вообще (только
  `profiles.monthly_budget` — общий бюджет, не per-category).

Не начинать без отдельного планирования — три разных фичи, разного
размера.

### Typed API layer (Zod/DTO-контракты фронт↔Supabase)

Поднято 2026-07-29 в рамках задачи про module boundaries (ESLint
architecture guardrail) — явно вынесено из скоупа той задачи, так как
это отдельная, более крупная тема. Сейчас фронт и Supabase-запросы
(и edge functions) не имеют формальных контрактов на форму данных —
несовпадение полей/типов ловится только в рантайме (или не ловится
вообще). Zod-схемы (или аналог) на границе фронт/Supabase дали бы
статическую+рантайм проверку формы данных и единый источник правды
для типов вместо неявного соглашения по коду.

Post-launch идея, если вообще понадобится при масштабировании — не
стартовать без отдельного планирования (нужно решить: только edge
functions, или и прямые Supabase-запросы с фронта; ручные схемы или
генерация из БД-схемы).

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

- [x] **Закрыто 2026-07-27: PostHog wizard-интеграция — проверен чек-лист "Verify before merging" из `posthog-setup-report.md`, найдены и исправлены реальные проблемы.** Wizard добавил `posthog-js`/`@posthog/react`, `PostHogProvider` в `main.jsx`, 13 событий в 4 файлах, обновил CSP в `vercel.json` (`connect-src`/`script-src`/новая `worker-src` директива под session replay). Прошёлся по всем 7 пунктам чек-листа: билд чистый; тест-сьют — единственный e2e (`e2e/new-user-journey.spec.js`) реально бьёт по продакшену (`baseURL: https://app.arkonomy.com`), не запущен, оставлен на юзера; `.env.example` — в проекте такой конвенции никогда не было (нет ни файла, ни root README в git-истории), пропущено осознанно; Vercel env vars — добавлены `VITE_POSTHOG_PROJECT_TOKEN`/`VITE_POSTHOG_HOST` в Production+Preview (были только в `.env.local`, прод их не видел бы); source-map upload — вынесен в отдельную задачу #20 (затрагивает и Sentry тоже, который сорсмапы вообще никогда не грузил); `identify()`-на-возврате — проверено по коду (не live), корректно, один `useEffect` покрывает и логин, и session restore. **Найдено сверх чек-листа, самое существенное**: `posthog.identify()` в `AuthScreen.jsx` слал `email`/`name` как person-traits — прямое расхождение с уже существующей политикой проекта (`main.jsx`'s Sentry-конфиг явно скрабит `email` через `SENSITIVE_KEYS` + `sendDefaultPii: false`). Исправлено — оставлен только `identify(userId)`, PII убран (2 места, signup+login). `App.jsx`'s `identify(userId, {plan})` не тронут — `plan` не PII. `.env.local`/`.env.test` (содержат реальный `SUPABASE_SERVICE_ROLE_KEY` и e2e-пароль) перепроверены — корректно в `.gitignore`, никогда не коммитились.
- [x] **Закрыто 2026-07-25: `notification_preferences.include_market_update` — тумблер активирован.** Вынесен общий `_shared/marketSnapshot.ts` (SPY/QQQ/BTC/ETH через Finnhub) — чистый рефакторинг существующей логики `market-data`'s `overview`-ветки (сама ветка теперь тоже вызывает этот хелпер, поведение не изменилось), `weekly-report` его переиспользует вместо второй независимой реализации. Снепшот не персонализирован — считается один раз за весь батч-прогон cron, не на каждого юзера. MVP: дневное изменение (`dp` от Finnhub), не настоящий week-over-week расчёт — осознанно отложено до реального сигнала, что это вводит в заблуждение. Тумблер разблокирован в Profile.jsx, `profile.digest_market_update` добавлен во все 4 локали. Коммит `e85bb2a`, code-reviewer — ship it, live-подтверждено реальным письмом (котировки отрендерились).
- [ ] **`cleanMerchantName` не портирован в Deno (`_shared/recurringDetector.ts`) — станет проблемой, если Deno-side email/push когда-нибудь захочет показать merchant name, а не только category/amount.** Найдено при реализации `include_upcoming_bills` в `weekly-report` (2026-07-20) — файл уже содержал предупреждение в шапке, что `cleanMerchantName` сознательно не портирован, так как единственный потребитель (`get-insights`) никогда не показывал `.merchant` юзеру. `weekly-report` стал первым живым исключением — решено показывать `category`, не `merchant`, чтобы не раскрывать сырой банковский дескриптор в письме и не тащить сейчас большой риск рассинхронизации (client-версия `cleanMerchantName` — это десятки regex-правил + brand-fix таблица). Если в будущем понадобится merchant name на Deno-стороне — нужно решить: полный порт (риск дрейфа, тот же класс, что уже задокументирован для всего этого файла — "must be kept in sync BY HAND"), или более лёгкий partial-cleanup без полной параллельной копии.
- [x] **Закрыто 2026-07-25: `GoalCard`'s `monthlyRate` (Savings.jsx) — задваивание прогноза при 2+ целях.** Расследование показало, что исходное условие (`type==="income" && category_name==="Transfer"`) было мёртвым кодом для реальных Plaid-синканных данных — маппинг категорий Plaid никогда не производит `category_name:"Transfer"` на income-транзакции (только TRANSFER_OUT/ATM-снятия, все expense); подтверждено SQL по проду: 0 совпадений за всю историю (1246 транзакций). Это же означало, что изначально описанное задваивание физически не могло проявиться на реальных данных (в проде на момент проверки — 1 юзер, 1 цель, 0 целей с 2+ и 0 привязанных счетов). Дополнительно найдено и исправлено: `transactions.account_id` — колонка существовала в схеме, но `plaidTxToRow()` в `plaid-sync-transactions` никогда не читала `tx.account_id` из ответа Plaid, поэтому колонка была пустой у ВСЕХ синканных транзакций (0 из 1246). Фикс: прокинут `tx.account_id` → `transactions.account_id` (коммит `b867cc5`), бэкофилл через `resync_all` (временный маркер-хук по паттерну stripe-webhook/plaid-batch-sync, использован и удалён в течение сессии), подтверждено вживую SQL-запросом — 1224/1246 строк теперь имеют `account_id` (недостающие 22 — ручные транзакции без Plaid-счёта, корректно). `monthlyRate` переключен с мёртвого `category_name==="Transfer"` на `t.account_id === sv.plaid_account_id` (уже существующее поле привязки цели к счёту, ранее использовалось только для live-баланса) — коммит `c0a31e0`. Побочный эффект: задваивание между целями теперь архитектурно исключено (у каждой цели свой `account_id`, транзакции с разных счетов не пересекаются). Оба коммита прошли code-reviewer ("ship it").
- [x] **Закрыто 2026-07-25: кросс-файловая цветовая консолидация, все 4 акцента.** `#7C6BFF` → `C.proAccent` (6 файлов — `App.jsx`/`BottomNav.jsx`/`Markets.jsx`/`Profile.jsx`/`Savings.jsx`/`UpgradeModal.jsx`, коммиты `fda73f5`/`782fdf5`/`ac16ffe`). `#F5C842` → `C.alpacaAccent` (Markets.jsx + App.jsx, подтверждён один и тот же смысловой Alpaca-акцент, коммит `7b09aa0`). `#F5A623` — исследован и НЕ слит: Markets.jsx (не-US тикер warning) и App.jsx (иконка "trial ended") — совпадение хекса случайное, разные несвязанные фичи; заведены две раздельные константы — `C.nonUsTickerWarning` (общий `colors.js`) и `C.trialEndedAccent` (локальный `C`-объект App.jsx), коммит `78875ce`. `#1A56DB` → `C.bankConnectBlue` (Profile.jsx/OnboardingFlow.jsx/shared/PlaidLinkButton.jsx, коммит `3b88391`). Во всех группах, кроме первой, при grep только по hex-строке был обнаружен неучтённый класс дублей — тот же цвет в decimal RGB нотации (`rgba(124,107,255,...)`, `rgba(245,200,66,...)`, `rgba(245,166,35,...)`, `rgba(26,86,219,...)`) — итоговое число точек замены оказалось заметно больше исходной оценки (17 для `#1A56DB` вместо ожидавшихся ~9). Для `App.jsx`/`UpgradeModal.jsx` (свои отдельные локальные `C`-объекты, не импортирующие общий `colors.js`) использован разный подход в зависимости от того, нужно ли значение синхронизировать с другими файлами: `sharedC`-алиас-импорт для реально общих акцентов (`proAccent`, `alpacaAccent`), но прямое добавление ключа в локальный `C`-объект для `trialEndedAccent` (одноразовое значение, нечему дрейфовать) — осознанно НЕ повторяя прошлую ошибку с `C.faint`.
- [ ] **Баланс/транзакции для non-OAuth банков (Bank of America подтверждён) обновляются по расписанию Plaid, не мгновенно — ограничение платформы, не баг приложения.** Расследовано 2026-07-17 (жалоба на лаг баланса "до суток"): временный debug-хук (`/item/get` + `/institutions/get_by_id` через Plaid, тот же lifecycle что `__sentryTest`, убран после проверки) подтвердил — webhook зарегистрирован и реально срабатывает (`status.transactions.last_webhook` заполнен), но `update_type: "background"` на самом Item означает, что Plaid сам решает, когда переопрашивать банк, независимо от того, когда мы дёргаем `/transactions/sync`. `/transactions/sync` отдаёт то, что Plaid уже закэшировал у себя — НЕ форсирует свежий опрос банка. Для non-OAuth/credentials-based институтов (как Bank of America) это может быть раз в сутки на стороне Plaid. Путь исправления — `/transactions/refresh` (форсирует опрос сейчас), но НЕ как замена автосинка: асинхронный (не возвращает данные сразу, только запускает переопрос + webhook по готовности) и жёстко лимитирован Plaid per-Item в сутки. Решение — задача #19 выше ("Refresh balance now" кнопка по запросу юзера, с client-side cooldown), не текущий приоритет. **Связь с находкой 2026-07-25 ниже**: тогдашняя проверка `status.transactions.last_webhook` подтверждала, что webhook регистрируется и Plaid его помечает отправленным — но не проверяла, доходил ли он реально до кода `plaid-webhook` (gateway блокировал запросы без Authorization ещё до кода) — то подтверждение могло относиться к исключению, а не норме.
- [ ] **`profiles.preferred_language` — мёртвый путь чтения/записи: колонки нет в живой схеме БД.** `App.jsx:1455` пытается `UPDATE` несуществующую колонку (fire-and-forget, ошибка не обработана), `App.jsx:571` читает её же из select. Язык всегда падает на fallback (`localStorage`/`'en'`). Найдено 2026-07-17 при ревью baseline-миграции `profiles` (RLS-аудит). Не влияет на саму миграцию (та отражает реальную схему корректно) — отдельный, независимый баг, не в скоупе RLS-аудита.
- [ ] `weekly-report/index.ts` (~236-237) дублирует руками формулу savings-points из `healthScore.js` — числа совпадают, риск дрейфа при будущих правках healthScore.
- [x] **Закрыто 2026-07-17**: оба независимых Deno-детектора recurring-логики портированы на единый alias-aware `_shared/recurringDetector.ts`. Сначала `get-insights` (портирована сама логика `computeRecurringSummary`/`getUpcomingCharges` из `recurringSummary.js` — calendar-month группировка, block-list, `merchant_aliases`-aware через `resolveAlias`), затем отдельным заходом `push-notify/index.ts` (свой inline `detectUpcoming()` удалён целиком, заменён импортом `getUpcomingCharges` из общего файла). Для push-notify сохранены осознанно: `maxResults: Infinity` (иначе дефолтный cap=4 тихо обрезал бы 5+ платёж), точный фильтр `daysUntil === NOTIFY_DAYS_AHEAD` (иначе слало бы уведомление каждый день вместо одного за N дней), title-case мерчанта на call site (детектор возвращает сырое имя не просто так — get-insights его не показывает юзеру, а push-notify показывает). 90-дневное окно `push-notify` осознанно НЕ расширено до окна get-insights (~3 мес + текущий) — отдельная задача, не в этом заходе. **Живая проверка на реальном аккаунте**: Rent:Sheviakov корректно схлопнулся в одну запись (не 3 дубля по дескрипторам); сумма в push-notify debug-выводе ($2,000) отличается от get-insights/UI ($2,001.45) — разница объяснена и подтверждена SQL-запросом к реальным транзакциям: 90-дневное окно push-notify видит только 3 последних месяца по $2000 (после смены дескриптора аренда реально подешевела с $2002 до $2000), полная история (12 мес, 9×$2002+3×$2000) даёт среднее $2001.50 — не баг мержа, ожидаемое следствие разных lookback-окон. Оба прошли code-reviewer ("ship it"). Найдена (не в рамках этой задачи) отдельная некритичная проблема: `_shared/recurringDetector.ts:211` считает `daysUntil` от полного timestamp, не от полуночи — безопасно при текущем cron в 09:00, зафиксировано в CLAUDE.md Known issues.
- [x] **Закрыто 2026-07-17**: prototype-pollution в клиентском `src/utils/recurringSummary.js`'s `groupTransactionsByMerchant` — точное зеркало фикса, уже сделанного и провалидированного security-auditor на серверной `_shared/recurringDetector.ts` (найдено при ревью push-notify-миграции). Группировка по `groupKey` (из банковского description) шла через plain object `{}` — описание, нормализующееся ровно в `"constructor"`, коллизило бы с `Object.prototype`, портя эту группу. `{}` → `new Map()` в `groupTransactionsByMerchant`, все три потребителя (`computeRecurringSummary`, `getUpcomingCardPayments`, `findMerchantAliasCandidates`) переведены с `Object.values(map)` на `Array.from(map.values())`. Build чистый до/после.
- [x] **Закрыто 2026-07-17**: `Dashboard.jsx:614` — `CashFlowForecast` рендерил вечный безымянный loading-skeleton без CTA, если у юзера не подключён банк (`accountBalance === null` навсегда, а не временно). Найдено qa-explorer при попытке живой проверки alias-фикса на QA-аккаунте без Plaid-подключения. Фикс: новая ветка `!bankConnected` (проп уже был в Dashboard, прокинут дальше в `CashFlowForecast`) показывает CTA "Connect Bank" → `onNavigate('profile')`, тот же паттерн, что уже в welcome-баннере; старый skeleton остаётся только для настоящего "баланс ещё грузится" (`bankConnected=true`, `accountBalance=null` временно). Один новый i18n-ключ `connect_bank_forecast` добавлен во все 4 локали (en/ru/es/pt). Build чистый до/после.
- [x] **Закрыто 2026-07-25: расширенный аудит всех 21 edge function на тот же класс проблем (`verify_jwt`-рассогласование + embedded-select без FK) нашёл ещё 2 живых случая — `plaid-batch-sync` и `plaid-webhook`.** По следам находки weekly-report/generate-monthly-report ниже проверены все cron-триггерные функции (обнаружена 4-я, ранее неучтённая — `arkonomy-daily-sync` → `plaid-batch-sync`, ежедневно 06:00 UTC) плюс `plaid-webhook` (вызывается Plaid, не cron, но тот же риск — нет Supabase-JWT в запросе). `push-notify` проверен отдельно (явно запрошено) — чист по обоим пунктам, `notification_preferences` не использует вообще, единственный embedded-select (`savings_reminders.select(..., savings(name))`) имеет реальный FK. **`plaid-batch-sync`**: `verify_jwt: true`, расходился с остальными 3 cron-функциями — воспроизведено безопасным curl (`UNAUTHORIZED_INVALID_JWT_FORMAT`, без побочных эффектов), исправлено редеплоем `--no-verify-jwt`, подтверждено (теперь возвращает `Forbidden — service role key required`, ошибку своего кода, не gateway). **`plaid-webhook`** — по impact серьёзнее: `verify_jwt: true` + Plaid не шлёт Supabase-Authorization в вебхуках вообще (аутентификация у него отдельным заголовком `plaid-verification`, который код и так корректно проверял) — gateway блокировал ЛЮБОЙ реальный Plaid-вызов (`401 UNAUTHORIZED_NO_AUTH_HEADER`) до того, как код вообще успевал посмотреть на `plaid-verification`. Воспроизведено безопасным curl без Authorization (именно так Plaid реально стучится), исправлено тем же `--no-verify-jwt`, подтверждено — тело ответа сменилось с структурированной gateway-ошибки на `{"error":"Unauthorized"}` (собственная ошибка кода при неверной/отсутствующей Plaid-подписи), значит запрос теперь доходит до `plaid-verification`-логики. Оба фикса — чистая platform-конфигурация, ни одного изменённого файла в git.
- [x] **Закрыто 2026-07-25: `weekly-report`/`generate-monthly-report` перестали приходить регулярно — два независимых, разных бага, не связанных с недавними сессионными изменениями (Sentry, RLS-миграции, include_market_update).** Юзер сообщил, что оба cron-письма пропали "какое-то время назад". Расследование по 5 пунктам (cron-расписание, логи, notification_preferences, связь с сессией, Resend) нашло: (1) **`weekly-report`** имел `verify_jwt: true` на уровне платформы (в отличие от всех соседних cron-функций — `generate-monthly-report`/`market-data`/`plaid-sync-transactions`, у которых `verify_jwt: false`) — Supabase gateway отклонял cron-запрос ДО кода функции, поскольку живой `SUPABASE_SERVICE_ROLE_KEY` (после миграции платформы на новый формат ключей) не JWT-формата, а `sb_secret_...`; воспроизведено напрямую. Фикс — редеплой с `--no-verify-jwt` (platform-config, не код), подтверждено безопасным (auth остаётся внутри кода через `isCron`-сравнение). (2) **Более серьёзный, общий для обеих функций баг**, найденный ТОЛЬКО после (1): cron-ветка обеих функций грузила юзеров через PostgREST embedded-select `profiles.select('..., notification_preferences(...))')` — требует прямого FK между `profiles` и `notification_preferences` для embed-join, а такого FK нет (`notification_preferences.user_id` ссылается на `auth.users`, не на `profiles`) — `PGRST200` на каждом cron-запуске, обе функции падали на самом первом шаге (загрузка списка юзеров), ДО генерации отчёта и ДО Resend. Структурная проблема с рождения таблицы (см. комментарий в `20260412000005_baseline_notification_preferences.sql` — таблица вне миграций с самого начала), не регресс. Живо воспроизведено через безопасный marker-hook тест (одноразовый секрет, ветка до реальной auth-проверки, полностью удалена после использования — паттерн `stripe-webhook`/`plaid-batch-sync`) для `generate-monthly-report` на одном тестовом аккаунте — подтвердило точку падения. Фикс — раздельные запросы (`profiles`, затем `notification_preferences.in(user_id, ...)`, merge через `Map`) в обеих функциях, коммиты `2670d84` (weekly-report) и `0dd9514` (generate-monthly-report), code-reviewer — ship it для обоих. Live-подтверждено ЧЕРЕЗ РЕАЛЬНЫЙ cron-код-путь (не hand-built обход) на одном аккаунте для обеих функций — оба вернули `status: "sent"`, письма дошли. Побочно найдено code-reviewer'ом, не исправлено (вне скоупа): `generate-monthly-report`'s user-triggered (не-cron) ветка вообще не грузит `notification_preferences`, из-за чего ручной запуск отчёта юзером всегда использует `excel_frequency: 'monthly'`/30-дневное окно независимо от реально сохранённого предпочтения (например `quarterly`) — `weekly-report`'s эквивалентная ветка так не делает.
- [x] **Закрыто 2026-07-26: та же CSP-проблема, что fonts.gstatic.com, но для `icons.duckduckgo.com` — блокировала мерчант-фавиконки (`MerchantFavicon`, Insights.jsx) + бросала необработанный `TypeError` в `sw.js`.** Юзер прислал реальные CSP-ошибки из консоли на проде. Тот же механизм: `img-src` уже разрешал `icons.duckduckgo.com` (обычная `<img>` загрузка работала бы), но `sw.js`'s глобальный fetch-listener (`sw.js:71-89`) перехватывает ВСЕ GET-запросы и сам делает `fetch()` изнутри service worker — это уже под `connect-src`, которого там не было. Заблокированный fetch падал в `.catch(() => caches.match(...))`, а для никогда не кэшированного URL это резолвится в `undefined` — `event.respondWith(undefined)` и есть источник `TypeError: Failed to convert value to 'Response'`. Фикс 1: `https://icons.duckduckgo.com` добавлен в `connect-src` (`vercel.json`). Фикс 2, отдельный и более общий: `.catch()`-цепочка в `sw.js` теперь фолбэчится на синтетический `Response('', {status:504})`, если `caches.match()` тоже вернул `undefined` — `event.respondWith()` теперь ВСЕГДА резолвится в реальный Response, независимо от домена/причины сбоя (defense-in-depth, не только для duckduckgo). `MerchantFavicon` уже имел корректный `onError`-фолбэк на letter-avatar — просто никогда не получал шанс сработать из-за необработанного исключения выше по цепочке. Коммит `3f7e80c`, code-reviewer — ship it (один некритичный nit: синтетический 504 теоретически может задеть будущий non-`<img>` `fetch()`-вызов, ожидающий JSON при неудаче — сейчас такого вызова в приложении нет, см. Known issues в CLAUDE.md).
- [x] **Закрыто 2026-07-25: "Transfer up 8300% — one-time expense" — абсурдный % на маленькой базе сравнения, реальный юзер-репорт.** $140 ATM-снятие (`BKOFAMERICA ATM WITHDRWL`) попало в категорию `Transfer` (осознанное решение — Plaid's `TRANSFER_OUT_WITHDRAWAL` намеренно исключена из spending, см. `plaid-sync-transactions/index.ts:113-115`, не тронуто). Проблема была не в категоризации, а в `findTopCategorySpike()`/`renderInsight()` (`get-insights/index.ts`): существующий гейт `delta >= 75` защищает только от тривиальных абсолютных изменений, но не от крошечной БАЗЫ сравнения — подтверждено реальными данными прода (`avg3mSpend` категории Transfer ≈ $1.67-3.33/мес, два из трёх месяцев вообще без Transfer-трат), `pctIncrease = (140-avgSpend)/avgSpend ≈ 8283%`, что и дало репортнутые "8300%". Фикс: при `avgSpend < $15` заголовок инсайта (`one_time_driver` подтип, все 3 языка бэкенда) теперь формулируется через абсолютную разницу ("Transfer: $137 more than usual — one-time expense"), не через %; соседний "recurring" подтип уже был без % изначально, не тронут. **Найдена и починена тем же порогом родственная, независимая уязвимость**: `Dashboard.jsx`'s `checkInData.spikePct` — отдельный, самостоятельный расчёт "% роста по категории" для Daily Check-in карточки (`checkInEngine.js`), не связанный с `get-insights` кодом вообще. Оба расчёта теперь защищены одним и тем же порогом $15, но **сознательно остаются двумя разными функциями** (не слиты) — консолидация не в скоупе, если понадобится в будущем: базовые метрики разные (`avg3mSpend` за 3 месяца vs `prevSpendingByCategory` за 1 предыдущий месяц), и потребители ждут разную форму вывода (готовый headline-текст vs сырой процент). Коммит `1649d65`, code-reviewer — ship it.
- [x] **Закрыто 2026-07-25 (частично): Alpaca-brand compliance — партнёр разрешил интеграцию, но запретил прямые упоминания бренда "Alpaca" в user-facing UI/тексте (требование партнёра, не опция).** Полный grep по `src/`/`supabase/functions/` на "alpaca" (регистронезависимо), находки разделены на код/конфиг (не тронуто — имена переменных/функций/edge functions/БД-полей, комментарии) и user-facing текст. Реально нарушающих строк нашлось два ключа (каждый дублируется в namespace `savings` и `markets` — итого 8 строк × 4 локали en/ru/es/pt): `alpaca_disclaimer1` ("your Alpaca account" → "your investment account") и `alpaca_disclaimer2` (было активным залогом с Alpaca как субъектом — "Alpaca does not warrant..." — переписано в пассивный залог без named subject, чтобы не читалось так, будто Arkonomy дисклеймит само себя). Коммит `e9bc10d`, code-reviewer — ship it. **НЕ тронуто, требует уточнения**: `markets.investment_disclaimer` и `profile.legal_broker` (broker-dealer/FINRA/SIPC юридический дисклеймер, называет "Alpaca Securities LLC" по полному юр. названию) — похоже на обязательное регуляторное раскрытие, которое нельзя убрать по желанию партнёра независимо от остального запрета. Нужно уточнить у Alpaca (support/compliance контакт) или у юриста, распространяется ли их запрет на это конкретное юридическое раскрытие, прежде чем что-либо здесь менять.
- [ ] `App.jsx` определяет свой локальный объект `C` (design-system цвета), отдельный от `export const C` в `src/utils/colors.js` — Dashboard.jsx/Transactions.jsx импортируют `C` из colors.js, App.jsx нет. Найден реальный дрейф значения: `faint: "#4A5E7A"` (App.jsx) vs `faint: "#8BA1B7"` (colors.js) — один и тот же "приглушённый" цвет рендерится по-разному в разных частях приложения. Не тронуто (12 июля, при аудите CAT_COLORS) — `C` используется в сотнях мест App.jsx, консолидация рискованна и не связана с задачей календаря. `colors.js` также экспортирует `orange: "#F97316"`, которого нет в локальном `C` App.jsx.
- [ ] `computeRecurringSummary`/`groupExpensesByDay` (recurringSummary.js, клиент — бывший `detectRecurringCharges`, удалён 12 июля) требуют ≥2 подтверждённых списаний с консистентным интервалом — не ловят разовый крупный счёт (первый месяц новой подписки, нерегулярный платёж). Используется и в Insights, и в Dashboard Cash Flow Forecast — согласованы между собой (один источник). Deno-сторона (`_shared/recurringDetector.ts`, теперь используется и `get-insights`, и `push-notify`) с 2026-07-17 снова архитектурно синхронна с клиентом — тот же алгоритм, тот же `RECURRING_EXCLUDE`, та же alias-логика; расходится только окно данных (client — полная история, get-insights — ~3 мес+текущий, push-notify — 90 дней), не сам метод детекции.
- [ ] Health Score не имеет balance-floor: формула `calculateHealthScore()` не смотрит на баланс, "Excellent" структурно возможен при дефиците. Пока только косметика (cashPositionLow подпись). Серьёзный фикс — 5-й компонент/множитель в формуле.
- [ ] available vs current семантика при multi-account: суммирование `available ?? current` по нескольким счетам может смешать разные семантики. Для одного checking неважно. Код-комментарий добавлен в get-insights.
- [ ] `scheduled_payments` (запланированные разовые платежи, добавлено 12 июля) не имеет matching engine planned↔actual — если юзер не отметит платёж `completed` вручную после того как реальная Plaid-транзакция придёт, запись остаётся `pending` до `due_date`, но после этой даты просто выпадает из future-выборки календаря без какой-либо связи с реальной транзакцией. Риск: если due_date ещё не наступил, а юзер уже совершил платёж досрочно (или он пришёл раньше ожидаемого), `projectBalanceAt`/Cash Flow Forecast посчитают его ДВАЖДЫ — один раз как pending scheduled payment, второй раз как обычную транзакцию в `avg3mDailySpend`/upcoming bills. Осознанно не решается сейчас — сопоставление "это тот самый платёж" по сумме+датам+описанию имеет реальный риск false positive/negative, отдельная задача.
- [ ] **Риск масштабирования: `FINNHUB_API_KEY` — один общий ключ на всё приложение** (не per-user), free tier = 60 запросов/мин на ключ. `market-data` edge function не батчит котировки — один Finnhub-вызов на тикер. Один заход юзера на Markets home сам по себе даёт 8 вызовов (Trending: AAPL/TSLA/NVDA + Sectors ETF ×5) + N вызовов на watchlist (было 12, стало 20 после поднятия лимита 12 июля) = **28 вызовов на один заход**. При 60/мин это **~2 одновременных захода** до начала 429 от Finnhub на часть запросов (было ~3 при лимите watchlist=12). Не считает открытие StockDetail (+3 вызова на акцию) и поиск при добавлении тикера — реальный потолок ниже при активном использовании, не только "заход на вкладку". Не блокер для одного активного юзера сейчас, станет проблемой при росте одновременной аудитории — нужен либо платный тариф Finnhub с более высоким лимитом, либо кэширование котировок на бэкенде (общий кэш на N секунд вместо запроса на каждый заход каждого юзера).
- [ ] **`computeRecurringSummary`'s `.name` — сырой банковский дескриптор, не вычищен `cleanMerchantName`, кроме одного места.** Найдено при работе над Aha-моментом (12 июля): в отличие от `getUpcomingCharges`/`getUpcomingCardPayments` (уже применяют `cleanMerchantName` к своему `merchant` полю), сами `subscriptions`/`regularPayments` из `computeRecurringSummary` хранят `.name` как есть — на реальных данных это дало голое "Sheviakov" вместо читаемого имени. Исправлено ТОЛЬКО в `AhaMoment.jsx` (плюс контекст категории в скобках) — точечный фикс одного нового вызова, не миграция всех мест. Проверил остальные вызовы `computeRecurringSummary` на риск того же: **Insights.jsx уже безопасен** — применяет `cleanMerchantName(m.name) || m.name` при рендере (строки ~953, ~1000, ~1022-1023 на момент проверки), эту фичу писали раньше и там это уже учтено. **App.jsx — РЕАЛЬНЫЙ живой риск, не исправлен**: `financialContext` для ai-chat (`regularCommitments.subscriptions`/`regularPayments`, ~строка 1370-1371) отправляет `s.name` в AI-промпт СЫРЫМ, без `cleanMerchantName` — модель получает необработанные банковские дескрипторы в контексте и может дословно процитировать их юзеру в чате (например "Sheviakov" вместо "Rent"). Не чинилось сегодня — вне скоупа Aha-момента, отдельная задача: применить `cleanMerchantName` к `s.name` в App.jsx перед отправкой в `ctx.regularCommitments`.
- [ ] **Онбординг-тур, шаг 1 (`OnboardingFlow.jsx:12`, `onboarding.tut_1_desc`) — текст подсказки не подходит для состояния без банка.** Найдено code-reviewer'ом 2026-07-18 при ревью Dashboard-аудита (группа функциональных фиксов, добавление `ConnectBankPrompt` в Account Balance/MonthCalendar/Monthly Cash Flow). Селектор `[data-tutorial="net-balance"]` — общий главный тур, идёт для всех юзеров после онбординга (включая тех, кто нажал "Skip for now" и банк не подключал), текст описывает "see income, expenses and balance at a glance". После этой сессии юзер без банка на этом шаге видит карточку `ConnectBankPrompt` вместо баланса — текст подсказки больше не соответствует содержимому. Готовый более подходящий текст уже есть рядом, в том же файле: `MINI_TOURS["connect-bank"]` (строка 24) — "Once your bank is connected, your real balance... update automatically". Не исправлено — copy-правка, не функциональный баг, вне скоупа сессии.
- [x] **Подтверждено исправленным 2026-07-26: CSP `connect-src` не разрешал `fonts.gstatic.com` — блокировал service worker.** Найдено 2026-07-17 (побочно, при диагностике Sentry frontend-теста), тогда отмечено "не исправлено". Перепроверено вживую 2026-07-26 (`curl -I https://app.arkonomy.com`) при расследовании похожей находки про `icons.duckduckgo.com` ниже — `https://fonts.gstatic.com` реально присутствует в `connect-src` живого CSP-заголовка прямо сейчас. Когда именно и каким коммитом был исправлен — не отслежено (не в рамках этой сессии), но факт исправления подтверждён напрямую, не по памяти.
- [ ] **`Transactions.jsx` — хардкод-слово `" total"` в подзаголовке Income/Expenses breakdown sheet.** Найдено при i18n-проходе группы 7 экрана Transactions (2026-07-19), вне заявленного скоупа (список конкретных строк не включал эту), тот же класс, что onboarding-copy находка выше. Строка `` `${monthLabel} · ${fmtMoney(summary.income)} total` `` (и аналогичная для expense) — `monthLabel` уже осознанно вне скоупа (`toLocaleDateString("en-US", ...)`, см. Coding rules в CLAUDE.md), но слово `"total"` рядом с ним — отдельный, самостоятельный пропуск `t()`, не связанный с этим решением. Не исправлено — мелкий follow-up.
- [ ] **`"Transfer"` (ед.ч.) vs `"Transfers"` (мн.ч.) — непоследовательный фильтр транзакций-переводов.** `groupExpensesByDay` (Dashboard.jsx, влияет на доминирующую категорию/интенсивность цвета клетки календаря) исключает только `category_name === "Transfer"` (единственное число) — реальные Zelle-переводы в БД хранятся как `"Transfers"` (множественное), то есть НЕ исключаются и фактически считаются "тратой" для интенсивности. Найдено 12 июля при добавлении суммы дня под датой (`getDailyNet`) — новая функция сначала исключала оба варианта (более правильно по смыслу), из-за чего число под датой и интенсивность цвета ТОЙ ЖЕ клетки считались от разных сумм (Day 6: $2150.78 в тексте vs $2210.78 в интенсивности; Day 10: $53.99 vs $68.99) — видимая юзеру нестыковка внутри одной клетки. Точечно исправлено — `getDailyNet` подогнана под существующее (не идеальное) поведение `groupExpensesByDay`, оба числа в клетке снова совпадают. Сама непоследовательность фильтра НЕ исправлена — стоит унифицировать на "правильное" поведение (исключать оба варианта) единым заходом в `groupExpensesByDay`, откуда это автоматически подхватит и `getDailyNet`, и всё остальное, что от неё зависит (дальнейшие консьюмеры calendar/breakdown). Не срочно, не сейчас.
- [ ] **Stripe Customer Portal — дать юзерам самим управлять/отменять подписку.** Создан как побочный UX-долг фиксом двойной подписки (2026-07-31, `stripe-checkout` теперь блокирует повторный checkout при уже активной подписке кодом `409`) — юзер, у которого уже есть подписка, при попытке апгрейда получает явное сообщение об ошибке ("You already have an active subscription"), но **нет UI-пути к решению** — ни ссылки на управление подпиской, ни отмены, ни смены карты. Портала (`stripe.billingPortal.sessions.create` + фронтенд-кнопка) сейчас не существует в проекте вообще. Не блокирует сам фикс двойной подписки — отдельная задача.
- [ ] **Заменить "★★★★★ 4.9 from beta users" на реальные, атрибутированные отзывы (имя + фото/аватар), как только появятся первые реальные пользователи после релиза.** Найдено при аудите маркетингового сайта arkonomy.com 2026-08-02 — рейтинг и 5 инициалов-аватаров (JM/SR/AK/DL/TP) в социальной секции сейчас не проверяемы и написаны без реальной основы. Соседняя находка того же аудита — "65+ transactions tracked" в этой же секции — уже удалена (реальное число подключённых банков на тот момент — 2, непрезентабельно для паблика), но рейтинг/аватары оставлены как есть по прямому решению пользователя, не тронуты.
- [ ] **`C.subtext` (`App.jsx:1711`, `1714`) — ссылается на несуществующее поле палитры.** Найдено 2026-08-02 при верификации после консолидации `App.jsx`'s локального `C` на общий `colors.js` (`sharedC` + `trialEndedAccent`) — `subtext` не существует ни в старой локальной версии `C`, ни в `colors.js`, ни в новой. Подтверждено, что предшествует этому рефакторингу (0 упоминаний "subtext" в его диффе), не введено им. Не критично — не крашит, просто тихо рендерится как `undefined`/inherited color вместо ошибки, поэтому визуально мог годами оставаться незамеченным. Оба места — параграфы `savings.alpaca_disclaimer1`/`alpaca_disclaimer2` (13px body-текст) в модалке Alpaca-дисклеймера. Судя по контексту (соседний heading — `C.text`, соседняя граница кнопки — `C.muted`) вероятный кандидат — `C.muted`, а не `C.faint` (который в остальных местах использования — 11-12px подписи, не 13px юридический текст, который юзер должен реально прочитать) — но это только гипотеза по аналогии, не проверено, уточнить при фиксе. Чинить либо добавлением `subtext` в `colors.js`, либо заменой на существующий токен — отдельным заходом, не сейчас.
- [ ] **`investments.status` пишется один раз при создании ордера и никогда не обновляется после исполнения — поле структурно бесполезно для отображения реального состояния позиции.** Найдено 2026-08-02 при расследовании, почему Markets.jsx показывал "No positions yet" после 3 тестовых SPY-ордеров ($1 каждый, 2026-08-01, idempotency-тест) — SQL-проверка `investments` показала все 3 со `status: "accepted"`, без единого обновления с момента вставки. `alpaca-invest/index.ts:201-208` пишет `status: order.status` сразу после `POST /v2/orders` — это статус синхронного ACK от Alpaca (`accepted`/`pending_new`), не финальный результат. Нет webhook от Alpaca (Alpaca поддерживает trade-update WebSocket/webhook, не подключён) и нет periodic-sync джобы, которая бы опрашивала `/v2/orders/{id}` и обновляла `status` на `filled`/`rejected`/`canceled`. Собственное поле `investments.status` вводит в заблуждение при прямом просмотре БД и не даёт истории по конкретному ордеру (когда исполнился, по какой цене) — `alpaca-portfolio` (`/v2/positions`, live на каждый рендер Markets.jsx) не зависит от этого поля, так что сам факт бага независим от того, что показывает Portfolio-блок прямо сейчас. Не критично для релиза при текущем 1 юзере — закрыть до того, как реальные пользователи начнут инвестировать через приложение и полагаться на этот UI/данные для понимания, что происходит с их деньгами. Путь фикса: либо Alpaca trade-updates webhook (аналог `plaid-webhook`), либо periodic-sync cron по открытым ордерам (аналог `plaid-batch-sync`).
- [x] **Закрыто 2026-08-02: Multi-bank агрегация баланса на клиенте брала ОДИН аккаунт вместо суммы по всем банкам — 4 независимых потребителя, все ниже по течению от одного и того же паттерна, продублированного трижды.** Найдено/проверено 2026-08-02 по прямому запросу — сначала подтверждён storage-слой (`plaid_items` живой constraint — `UNIQUE (user_id, item_id)`, не `UNIQUE(user_id)`; `plaid-exchange-token/index.ts:90-102` апсертит на `user_id,item_id` — второй банк создаёт новую строку, не перезаписывает первую), затем полный аудит агрегации. **Backend корректен везде, где проверено**: `plaid-sync-transactions/index.ts:489-517` грузит и синкает ВСЕ Items юзера (цикл, есть даже cross-item дедуп для нескольких Items одного банка); `plaid-get-accounts/index.ts:46-92` тем же паттерном возвращает ВСЕ аккаунты ВСЕХ банков одним массивом; `check-bank-connection/index.ts:35-48` возвращает реальный `count` всех Items; `get-insights/index.ts:244-264`'s `currentBalance` **суммирует** `balance_available` по всем depository-аккаунтам юзера (уже задокументированное отдельное ограничение здесь — про available/current семантику, не про количество банков). **Client — реальный баг, не гипотеза**: `App.jsx:1306-1310` и независимо продублированная копия той же логики `Dashboard.jsx:1230-1232` оба берут ОДИН аккаунт из корректного мультибанковского массива (`accounts.find(a => a.subtype === "checking") ?? accounts.find(a => a.type === "depository") ?? accounts[0]`) вместо суммы — `Dashboard.jsx:1199`'s собственный комментарий прямо признаёт `// primary checking balance from Plaid`. Downstream-потребители, получающие уже испорченное единственное-значение: `App.jsx`'s `plaidBalance` → `Insights.jsx`'s `availableSafe`/"Safe to move"-CTA (962, 1023) и `cashPositionLow` (1085), плюс ai-chat's `currentBalance`/`availableSafeToMove` контекст (App.jsx:1449, 1454); `Dashboard.jsx`'s `accountBalance` → карточка "Account Balance" (1354-1357), весь `CashFlowForecast` (599: `projectedRaw = accountBalance + ...`), `MonthCalendar` day-balance превью, `AddPlannedPaymentModal` превью "останется после" (1140), собственный `cashPositionLow` (1241). **Живая проверка — 0 текущих юзеров затронуты**: SQL по `plaid_items` (group by `user_id`) показал ровно 2 юзера с банком вообще, оба с `item_count = 1` (shevvik88@gmail.com — Bank of America; demo@arkonomy.com — Plaid Sandbox); `camek88@gmail.com` и `mshev1707@gmail.com` существуют в `auth.users`, но 0 строк в `plaid_items` у обоих — банк не подключён вообще ни один. Баг реальный и подтверждённый в коде, но сейчас молчит — ровно тот риск, который BACKLOG #6 ("Подключить все банки") просил проверить первым пунктом до UI-части этой фичи; теперь подтверждено, а не гипотеза. **Фикс применён в тот же день, до появления первого реального юзера с двумя банками.** Новая `sumDepositoryBalance(accounts)` в `src/utils/accountsCache.js` — тот же паттерн, что уже был в `get-insights/index.ts:264` (`.filter(type==='depository').reduce(sum + (balance_available ?? balance_current ?? 0), 0)`), теперь единственная реализация вместо трёх независимых копий. Заменена в `App.jsx:1306-1310` (`plaidBalance`), `Dashboard.jsx:1230-1232` (`accountBalance`) — по ходу фикса найдена **третья**, изначально не учтённая копия того же паттерна в `AhaMoment.jsx:184` (онбординг `cashRisk`-факт) — исправлена тем же заходом. Все downstream-потребители (`CashFlowForecast`, `MonthCalendar`, `AddPlannedPaymentModal`, ai-chat контекст, оба `cashPositionLow`) не требовали правок — читают уже готовое значение пропом/переменной, не пересчитывают сами. **Верифицировано вживую на реальных данных, не только код-ревью**: SQL по `plaid_accounts` показал, что у shevvik88 ровно 1 depository-счёт — старая и новая логика дают идентичный результат (`$87.37 === $87.37`, подтверждено прямым JS-вызовом `plaid-get-accounts` в реальной залогиненной вкладке прод-сайта, сравнение обеих формул на одних и тех же живых данных). **Важная поправка к изначальной оценке "0 impact"**: у `demo@arkonomy.com` (Plaid Sandbox, 1 Item, но 6 depository-подсчётов — checking/savings/HSA/cash management/CD/money market) старая логика показывала только checking ($100), новая — сумму всех шести ($62,569) — то есть баг реально проявлялся не только при 2+ банках, а при 2+ depository-счетах внутри ОДНОГО банка, что было упущено в первой формулировке находки. Изменение подтверждено и принято сознательно (демо-аккаунт не реальные деньги, сумма семантически более корректна и совпадает с уже одобренным `get-insights`-паттерном).
- [ ] **Android Google Play IAP-compliance — нужно решить, ЕСЛИ/КОГДА Android пойдёт в Google Play.** Проверено 2026-08-01: `UpgradeModal.jsx`'s `handleUpgrade()` (Stripe Checkout через `window.location.href = data.url`, полноценный внешний link-out на `checkout.stripe.com`) гейтится только `IS_IOS_NATIVE` (`Capacitor.isNativePlatform() && platform === 'ios'`) — на Android-сборке этот гейт `false`, кнопка "Upgrade now" рендерится, `handleUpgrade()` реально выполнится. Google Play имеет то же требование к in-app billing для digital goods, что Apple Guideline 3.1.3 (Play Billing Library вместо внешнего платёжного линка) — сейчас у Android нет ни `IS_ANDROID_NATIVE`-гейта (как у iOS), ни подтверждения, что `window.location.href` на Android реально уводит в системный браузер, а не остаётся в Capacitor WebView (`@capacitor/browser`/`InAppBrowser` не установлены — `androidScheme: 'https'` в `capacitor.config.ts`, дефолтное поведение не проверялось). `android/` в репозитории — не мёртвый код, но и не активная публикация: единственный коммит (`2026-04-16`, "Add Android platform: icons, splash screens, status bar, back button handler"), с тех пор Android не трогали; ни в BACKLOG.md, ни в CLAUDE.md нет упоминания плана публикации в Google Play. **Не срочно, пока Android не в Google Play** (сейчас — web + iOS App Store). Если публикация решится: либо `IS_ANDROID_NATIVE`-гейт по аналогии с iOS (тот же паттерн, что уже есть), либо явная проверка/принудительный вывод в системный браузер (`@capacitor/browser`'s `Browser.open()`) для Android перед тем как открывать checkout.

**ai-chat промпт tech debt (аудит 11 июля, `buildSystemPrompt()` целиком) — не критично, отложено:**
- [ ] REGULAR PAYMENTS & SUBSCRIPTIONS данные gate'уются условием `STATE is cash_risk/warning, or user asks about spending/subscriptions` — если спайк вызван подпиской, но STATE=positive и вопрос не про подписки, PRIORITY ORDER велит вести со спайком, а gate формально блокирует доступ к этим данным. Убрать STATE-условие из gate, оставить только relevance.
- [ ] WINS MATTER ("acknowledge streaks before pivoting") не имеет явного слота в RESPONSE FORMULA (3 шага, 2-4 предложения) — бюджетная теснота, не логическое противоречие. Уточнить: win = insight (шаг 1), или отдельный необязательный кейс.
- [ ] FINANCIAL STATE TIER positive велит проактивно предлагать investing-идею, но PROJECTION ILLUSTRATION (compound growth formula) разрешена только "if user asks about growth over time" — неясно, можно ли иллюстрировать проактивное предложение цифрами.
- [ ] TIME AWARENESS ("day 1-10 → conservative framing") vs FINANCIAL STATE TIER positive ("speak with confidence") — мягкое тональное напряжение в начале месяца при позитивном STATE, решается TONE-секцией ("confident but not absolute"), фикса не требует.
- [ ] **Credit card debt отсутствует в PRIORITY ORDER** (найдено на том же аудите 11 июля, не исправлено). DEBT PAYOFF RULE существует отдельно как "NEVER VIOLATE", но сам PRIORITY ORDER (6 тиров) не содержит явного тира для credit card debt — только общий debt payoff при `INTEREST CHARGES THIS MONTH > $0` (добавлено 12 июля при хардненинге промпта). Реальный кейс на тесте: баланс ~$408 на Customized Cash Rewards Visa — неясно, закрывает ли текущая формулировка именно credit-card-специфичный случай (дефицит по счетам vs погашение долга под высокий APR) или только проценты этого месяца. Задача: добавить debt payoff как явный, отдельно поименованный тир в PRIORITY ORDER с явным правилом приоритизации credit card debt конкретно, не только "есть проценты в этом месяце".

---

## Pre-release audit (2026-07-30) — закрыто

Критичные находки и фиксы:
- Column-level RLS gap: любой authenticated юзер мог обновить свой
  profiles.plan напрямую (self-upgrade to Pro) и читать чужой
  alpaca_access_token. Фикс: column-level GRANT/REVOKE.
  Подтверждено 4/4 cross-user атак заблокированы (self-upgrade,
  чтение чужого Alpaca token, чтение чужих transactions/savings,
  edge function с чужим user_id).
- Alpaca OAuth: Supabase JWT передавался как OAuth `state` параметр,
  утекал в логи/Referer третьей стороны. Фикс: заменён на
  short-lived nonce.
- GlassCard не прокидывал onClick — любой клик внутри модалки
  Savings закрывал её через backdrop handler. Фикс: {...rest}
  forwarding, подтверждено визуально на проде.
- Service worker блокировал cdn.plaid.com — подключение банка
  зависало на "Loading..." для каждого нового юзера. Фикс: добавлен
  в исключения SW.
- Транзакция на крупную сумму тихо не сохранялась (error из
  Supabase insert не деструктурировался), отрицательная сумма
  ломала расчёт net/surplus в разных компонентах по-разному.
  Фикс: error handling + min/max валидация + унификация расчёта.
- CLAUDE.md заявлял, что Firebase App Check "live" и защищает
  ai-chat/get-insights/etc — фактически отключено с 66ea690
  (04.07). Документация приведена в соответствие с реальностью.
- "+Goal" кнопка была видна только при savings.length === 0 —
  юзер с существующими целями не мог добавить новую через UI.
  Фикс: постоянная кнопка в хедере секции.

Известные, не блокирующие релиз (SHOULD FIX):
- #8-13 из аудита — Dashboard empty-state UX, онбординг reload
  resilience, offline handling, идемпотентность double-click,
  дублирующиеся helpers в App.jsx, необработанный promise rejection
  в useInsights

Известные, отложенные (CAN DEFER):
- supabase/config.toml verify_jwt флаги не задокументированы для
  6 функций — нужна ручная проверка в dashboard
- Деньги считаются через JS Number на фронте (~50 мест) — БД uses
  numeric корректно, но нужно заложить integer cents до добавления
  реальных денежных мутаций (auto-roundup и т.п.)
- Мелочи: сырой console.log в проде, service-role сравнение не
  constant-time, генерик error messages от Supabase/Plaid могут
  давать upstream disclosure

Test coverage gap (найдено, не закрыто):
- 0% e2e-покрытие: отмена Pro-подписки, удаление аккаунта, Plaid
  reconnect, смена пароля, savings CRUD, merchant-alias confirm/reject

---

## Второй раунд pre-release аудита — закрыто

- Двойная подписка через Stripe: email-based lookup + reuse existing
  customer_id + UNIQUE constraint на stripe_customer_id. Подтверждено
  0 затронутых реальных юзеров на момент фикса.
- rate_limits orphan row при удалении аккаунта: ON DELETE CASCADE FK,
  живая сиротская строка от прошлого удаления очищена.
- Alpaca-invest idempotency: первая версия (time-bucket floor(now/60s))
  провалила реальный тест на живых деньгах ($2 потрачено на 2 реальных
  ордера SPY из-за границы бакета). Вторая версия (real elapsed-time
  query против investments table) подтверждена автоматизированным
  скриптом с точным 5-сек таймингом — 200 → 409 как задумано.
- alpaca-invest NaN-валидация суммы — подтверждено live regression-тестом.
- stock-ai-analysis prompt injection: symbol/name allowlist +
  numeric-field guards (включая тонкую toLocaleString-инъекцию, где
  нечисловая строка проходила форматирование без ошибки). Подтверждено
  live, включая edge case BRK.B (тикер с точкой).
- market-data rate limiting (300/hr per user) добавлен — единственный
  AI/API-эндпоинт без него. Подтверждено live.
- failClosed opt-in параметр добавлен в enforceRateLimit — инфраструктура
  на будущее для денежных эндпоинтов, ничего не переключено (текущие
  ai-chat/get-insights/stock-ai-analysis остаются fail-open, это
  осознанное решение — cost-guard, не access-control).
- plaid-webhook iat-freshness check (5 мин) — задеплоено, отклоняет
  webhook старше 5 минут. Replay-защита будет подтверждена живым
  webhook (лог-буфер забивается market-data трафиком, мешая
  верификации через логи).

## Известное, не блокирующее (техдолг)

- Android/Google Play IAP-гейт — не актуально сейчас (Android нигде
  не публикуется), решить если/когда появится план публикации.
- get_logs MCP tool не поддерживает фильтр по имени функции —
  высокочастотные функции (market-data) топят буфер, мешая проверке
  редких (plaid-webhook, alpaca-invest). Стоит найти способ смотреть
  логи по функции напрямую через Supabase dashboard.
- Error Boundary — один глобальный (main.jsx), не per-section.
  Падение любого компонента требует полного Refresh. Не критично,
  но стоит рассмотреть гранулярные boundary вокруг крупных
  секций/роутов при следующей возможности.

---

## ✅ СДЕЛАНО 13 июля (для истории)

### Sentry-мониторинг ошибок (BACKLOG #12) — backend ЗАКРЫТ, frontend ЧАСТИЧНО

**Backend (`ai-chat`, `get-insights`) — полностью подтверждено:**
- [x] Новый `_shared/sentry.ts` (`initSentry`/`captureAndFlush`), `defaultIntegrations: false` + `Sentry.withScope()` per-request — по официальному гайду Supabase против того, что `Deno.serve` не инструментирован для авто-изоляции scope между запросами на переиспользуемом isolate.
- [x] Scope-изоляция подтверждена вживую, не гипотетически: два параллельных запроса (`testA-111`/`testB-222`) дали 2 отдельных, чистых события в Sentry dashboard без пересечений/утечки контекста друг в друга.
- [x] **Честно о часе+ диагностики "события не доходят до Sentry"**: реальный root cause — `SENTRY_DSN` secret изначально содержал DSN с ДРУГИМ project ID (`4511730884083712`) и другим publicKey, не настоящий project ID `arkonomy-edge-functions` (`4511730888474624`) — похоже на ошибку копирования при создании Sentry-проекта. Sentry ingest отвечал `200 OK` даже на неверный/чужой project ID (не палит существование чужих проектов), из-за чего `Sentry.flush() === true` создавало ложное впечатление успешной доставки при полном отсутствии событий в дашборде. **Гипотеза "SDK несовместим с Deno 1.45.2" (заявленная как риск с самого начала плана) НЕ подтвердилась** — после исправления DSN штатный `@sentry/deno` SDK заработал корректно с первой попытки. Самописный fetch-based обход SDK (был спроектирован как запасной план и частично продиагностирован через прямой POST на Sentry Store API) не понадобился и не был внедрён.
- [x] Диагностика по пути: прямой `fetch()` на Sentry Store API в обход SDK подтвердил, что egress/сеть/сами DSN-credentials (публичный ключ, хост) были в порядке в принципе — это сузило гипотезу до конкретно неверного project ID, а не общей несовместимости рантайма.
- [x] Временные диагностические хуки (`__sentryTest`, `__sentryRawFetchTest`, `console.error("Sentry flush result", ...)`) убраны из кода, задеплоен чистый прод-код (сверено `git diff` = пусто относительно коммита `cb2b159`). Тестовые `.ps1`-скрипты (содержали на диске реальный access token) удалены, не коммитились в git.
- [ ] Остальные edge functions (`plaid-sync-transactions`, `delete-account`, `stripe-checkout` и т.д.) — без Sentry. Сознательное решение расширять постепенно по мере необходимости, не техдолг — не все функции одинаково критичны/часто падают.

**Frontend (`@sentry/react`, ErrorBoundary) — код написан, НЕ протестирован вживую:**
- [x] `@sentry/react` интегрирован, DSN через `VITE_SENTRY_DSN`, оборачивает существующий `ErrorBoundary.componentDidCatch` (кастомный UI не тронут). PII: `beforeSend` с denylist (`balance/amount/amounts/description/descriptions/email`) поверх `sendDefaultPii: false`.
- [ ] **Не проверено вживую** — браузерное расширение было недоступно всю сессию. Открытые шаги:
  а) Подтвердить, что `VITE_SENTRY_DSN` реально добавлена в Vercel Environment Variables (Production) — не подтверждено сделано ли.
  б) Явный деплой на Vercel — Vercel НЕ деплоится автоматически на обычный `git push` (задокументированное поведение проекта, см. память), нужна явная команда/действие.
  в) Реальный тест намеренной ошибки в браузере (`throw new Error(...)` в консоли) → подтвердить появление в Sentry dashboard `arkonomy-web`.

### Календарь — сумма дня под датой (BACKLOG #17, полностью закрыт)
- [x] Level 1 grid: под числом дня — вторая строка, сумма дня со знаком. Прошедшие/сегодня — честный net (доход − расход), красный/зелёный по знаку. Будущие дни — сумма доминирующего ожидаемого платежа (не net — `futureByDay` хранит один платёж, не сумму всех ожидаемых, и проекции дохода в приложении нет в принципе), всегда как отток, нейтральный цвет (не красный/не зелёный, чтобы не путать с честным net прошлых дней).
- [x] Крупные суммы (≥$1000) — сокращение до целых тысяч без десятичных: "$2211" → "$2k" (десятичная точка "$2.2k" почти не экономит место — та же длина). Малые суммы — без изменений. Пустые дни — вторая строка не рендерится, тот же принцип, что уже был для цвета/интенсивности.
- [x] Перед кодом — превью на реальном измеренном размере клетки (41.6px/43.7px/49.4px в зависимости от viewport, посчитано из реальных стилей App.jsx/GlassCard/grid-gap, не гипотетически) на реальных данных теста-юзера (Day 6 rent $2210, Day 10 Food $68, Day 2 Bills $12).
- [x] **Найден и точечно исправлен реальный баг до деплоя**: новая `getDailyNet` изначально исключала и `"Transfer"`, и `"Transfers"` из расчёта — более правильно по смыслу, но `groupExpensesByDay` (от которой зависит цвет/интенсивность той же клетки) исключает только `"Transfer"` (ед.ч.), а реальные Zelle-переводы в БД хранятся как `"Transfers"` (мн.ч.) — то есть НЕ исключаются там. Из-за этого текст под датой и интенсивность заливки ТОЙ ЖЕ клетки считались от разных сумм (Day 6: $2150.78 в тексте vs $2210.78 в интенсивности) — видимая юзеру нестыковка внутри одной клетки, тот же класс проблемы "один канал — два источника", что весь день ловился в других местах приложения. Исправлено точечно: `getDailyNet` подогнана под уже существующее (не идеальное) поведение `groupExpensesByDay`, а не наоборот — сама непоследовательность `"Transfer"`/`"Transfers"` осталась в ТЕХДОЛГ отдельным пунктом, унификация — отдельный заход.
- [x] **Контраст текста — три итерации, только третья решила системно**:
  1. Первая попытка — `text-shadow: "0 1px 2px rgba(0,0,0,0.5)"` (лёгкая тень снизу-справа) + увеличенный вертикальный отступ (`marginTop: 1→3`). Недостаточно на насыщенных фонах (красный на синем/фиолетовом — сложное сочетание само по себе, одна тень не спасает).
  2. Дальше отдельно всплыло, что цвет числа даты (не только суммы) на будущих днях (`C.muted`, серый) тоже плохо читается на некоторых фонах — оказалось предсуществующим поведением (не регрессом от фикса тени, проверено по `git log -p`), просто стало заметно, когда внимание переключилось на текст.
  3. **Финальное решение (после сравнения 3 вариантов на полном месяце, не только на отдельных клетках)**: near-full-cell тёмная подложка (`rgba(0,0,0,0.55)`, inset 3px, скруглённые углы) под числом+суммой, поверх существующей цветной заливки клетки — заливка/интенсивность НЕ убраны. Альтернатива "тонкая цветная рамка + тёмный интерior, интенсивность = яркость рамки" была смакетирована и явно отклонена — на полном месяце читалась заметно слабее для исходной цели "видеть активность месяца одним взглядом", ради которой вообще делалась интенсивность. Подложка вместо точечных цветов текста — системное решение независимо от того, что под ней, а не подгонка цвет-к-цвету, которая трижды не сработала.
  4. Подтверждено юзером на реальном устройстве, все клетки сразу (Day 6, 9, 22, 31) — контраст и отступ решены окончательно.

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

### Запланированные разовые платежи (scheduled_payments)
- [x] Новая таблица `scheduled_payments` (user-scoped RLS: select/insert/update/delete), статус `pending`/`completed`/`cancelled`. Кнопка "+ Add planned payment" в Level 2 sheet календаря для future-дня; платёж мёржится в `getUpcomingChargesByDay` наравне с recurring-прогнозами (единый источник, доминант дня выбирается той же сортировкой по сумме) — те же цвет/интенсивность, отдельная параллельная логика не создана.
- [x] `projectBalanceAt` вынесена как чистая функция из `CashFlowForecast` (параметризована датой вместо жёсткого конца месяца) — переиспользована формой добавления платежа для live-превью "останется после". Рефакторинг существующего рабочего компонента, не дублирование — по правилу "не переизобретать" (см. Coding rules в CLAUDE.md).
- [x] Push-напоминание за 3 дня до `due_date` — добавлено в `push-notify` batch-скан (cron), по образцу уже существующего блока `savings_reminders`. iOS-push не трогали (блокирован Apple Developer setup).
- [x] Проверено на реальных данных теста-юзера ($500 платёж на 20 июля): корректно смёржился в grid (доминант дня, alpha ff — новый месячный максимум), `projectBalanceAt` с платежом и без даёт разницу ровно $500.00.
- [ ] **Известное ограничение, не решено**: нет matching engine planned↔actual — см. ТЕХДОЛГ выше (риск задвоения в Cash Flow Forecast, если юзер не отметит платёж `completed` вручную).
- [x] **Пробел из изначального плана закрыт**: кнопка отмены/удаления scheduled payment — юзер мог добавить, но не мог убрать. `getUpcomingChargesByDay` теперь помечает смёрженные scheduled-элементы полем `scheduledPaymentId` (recurring/card-прогнозы его не имеют — их нечего отменять, они derived, не хранятся построчно). В Level 2 sheet рядом с отменяемой записью — красная кнопка "x" (стиль как у `removeFromWatchlist`), тап меняет статус на `cancelled`, платёж пропадает из grid/прогноза автоматически через уже существующий фильтр `status==='pending'`, без изменений в остальной логике.
- [ ] **Побочно найденное ограничение (не решено)**: Level 2 sheet показывает только ОДИН доминантный item на future-день (тот же выбор, что для grid). Если на одном дне пересекутся recurring-прогноз и scheduled payment, а прогноз крупнее по сумме — scheduled payment останется скрыт целиком (не виден и не отменяем) из sheet, пока не станет доминантом. Не встречается в текущих тестовых данных (15 и 20 июля — по одному scheduled payment без пересечений), поэтому не чинилось; полноценный фикс требует показывать список, а не один доминант, для future-дней — то же расширение, что уже сделано для past-дней (`selectedCatEntries`).
- [x] **Диагностика "$100 на 15 число не виден на grid"**: проверено по трём уровням (БД → живой бандл app.arkonomy.com → пересчёт на реальных данных) — запись в БД корректна, задеплоенный код мёржа совпадает с исходником побайтово, пересчитанная alpha для 15 июля = 0xCE (81%, ярко видимый цвет). Баг не подтверждён — та же природа, что и с интенсивностью grid ранее (кэш браузера/бандла, не код).

### Watchlist — звёздочка на экране отдельной акции (StockDetail)
- [x] Перед кодом проверено: полноценный watchlist УЖЕ существовал (`profiles.watchlist` JSONB-массив, миграция `20260415000000`, полный UI на Markets home — поиск, drag-to-reorder, лимит 12/12) — не нужна была ни новая таблица, ни новая секция, только новая точка входа. Кнопка-звёздочка в хедере `StockDetail` переиспользует то же состояние/handlers (`watchlist`/`addToWatchlist`/`removeFromWatchlist`), проброшенные из родителя.
- [x] 12/12-лимит на этом экране не виден (в отличие от search-add списка со счётчиком) — молчаливый no-op заменён явным toast через уже существующий глобальный `showAlert` (тот же, что у Transactions.jsx), а не новым тост-стеком.
- [x] `Icon.jsx` получил опциональный `fill` проп (дефолт `"none"`, ~50 других иконок не затронуты) — нужен для закрашенной звёздочки в активном состоянии.
- [x] Проверено тем же путём записи, что использует сама фича (не отдельная симуляция): применено идентичное `saveProfile`-обновление (`supabase.from("profiles").update({watchlist}).eq("id", user.id)`) — `profiles.watchlist` теста-юзера `["SPY","QQQ","BTC","ETH"]` → `[...,"TTWO"]`. Тестовая запись оставлена намеренно для визуальной проверки юзером в проде.
- [x] **Лимит watchlist поднят с 12 до 20** (`MAX_WATCHLIST` константа, было 3 хардкода "12" + toast-текст — все переведены на константу/актуальное число). Перед решением проверено: 12 было чисто UI-числом, не техническим (Finnhub не поддерживает batch-запрос котировок, `market-data` и так делает один вызов на тикер независимо от размера списка). Формат отображения (не-editMode) переключён с 2-колоночной сетки плиток на row-list — переиспользован уже существующий паттерн Portfolio Holdings (лого слева, тикер+имя, цена+% справа, разделитель сверху), не изобретён новый компонент.

### Aha-момент в онбординге (BACKLOG #5, закрыт)
- [x] Полноэкранный интерстишл "Here's what we found" — гейт после финального шага OnboardingFlow (не отдельный пронумерованный шаг), только если `bankConnected === true` в этой сессии онбординга; "Skip for now" юзеры идут прямо на редирект, как раньше.
- [x] Данные — целиком переиспользованы из `recurringSummary.js` (`findDuplicateSubscriptions`, `computeRecurringSummary`, `getUpcomingCharges`/`getUpcomingCardPayments`), новая детект-логика не написана. Осознанно НЕ использован `cash_risk` из `get-insights` — он опирается на устаревший Deno-детектор (см. техдолг), решили не тиражировать несоответствие в новом коде.
- [x] Приоритет фактов: дубли подписок → крупнейший regular payment (≥30% дохода) → cash risk (списание > баланса) → fallback топ-категория за всю доступную историю (не только текущий месяц — иначе fallback тоже почти всегда пуст на тонких данных).
- [x] Протестировано на 3 реальных сценариях: (1) богатая история теста-юзера (200 дней, 588 транзакций) — сработали largePayment ($2000/mo rent, 31% дохода) и cashRisk ($20 Claude через 2 дня, баланс $27); дублей не нашлось — не баг, легитимный побочный эффект staleness-фильтра (один из двух Claude-вариантов уже устарел); (2) урезанная до 10 дней история (28 транзакций, имитация тонкого Sandbox-коннекта) — (а)/(б)/(в) корректно не сработали (не набралось 2+ месяцев ни для одного мерчанта), fallback сработал чисто, не выглядит пустым; (3) 0 транзакций — интерстишл корректно пропускается, сразу Dashboard. Тестировано прямым импортом реального кода проекта в Node (не ручной копией логики).
- [x] **Найден и исправлен реальный баг на живых данных**: `computeRecurringSummary` хранит СЫРОЙ банковский дескриптор в `.name` (в отличие от `getUpcomingCharges`, который уже чистит через `cleanMerchantName`) — карточка крупнейшего платежа показала голое "Sheviakov" без контекста. `cleanMerchantName` тут не помогает (нечего чистить — не ACH-мусор, а просто более старый вариант дескриптора банка). Исправлено добавлением категории в скобках: "Sheviakov (Housing)" — карточка осмысленна независимо от качества сырого текста. **Исправлено только внутри `AhaMoment.jsx`, не мигрировано в остальные вызовы `computeRecurringSummary`** — см. новый пункт в ТЕХДОЛГ.
- [x] Фикс иконок feature grid на шаге "here's what Pro unlocks" — 4 emoji (🏦🤖📊📈) заменены на `Icon.jsx` (`bank`/`activity`/`award`/`trending-up`), все уже существовали в наборе, `activity` уже использовался как "AI Analysis" в Markets.jsx — прямой прецедент, не выдумано заново. Новых иконок в набор не добавлено.

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
