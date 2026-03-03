# Сравнение проектов VFS Global на GitHub

Обзор открытых репозиториев, которые работают с порталом VFS Global (поиск слотов, проверка статуса, букинг). Изучение кода и README проведено для сравнения подходов.

Связано: [VFS_GLOBAL.md](VFS_GLOBAL.md) (наш провайдер VFS), [REQUIREMENTS.md](REQUIREMENTS.md).

---

## Ссылки на репозитории

| Проект | Ссылка |
|--------|--------|
| ranjan-mohanty / vfs-appointment-bot | https://github.com/ranjan-mohanty/vfs-appointment-bot |
| vlaim / vfs-check | https://github.com/vlaim/vfs-check |
| doxoz / vfsglobalapi | https://github.com/DOXOZ/VFSGlobalAPI |
| minhalawais / visa-appointment-automation-vfs-global- | https://github.com/minhalawais/Visa-Appointment-Automation-VFS-GLOBAL- |
| Hit2theMo / vfs-visa-appointment-scraper | https://github.com/Hit2theMo/vfs-visa-appointment-scraper |
| berkay-digital / VFS-BOT | https://github.com/berkay-digital/VFS-BOT |
| securitsa / vfs-global-appointment-system | https://github.com/securitsa/vfs-global-appointment-system |
| IndiaTransform / VFS-VISA-APPOINTMENT-BOT-AUTOMATION-POLAND | https://github.com/IndiaTransform/VFS-VISA-APPOINTMENT-BOT-AUTOMATION-POLAND |
| barrriwa / vfsauto | https://github.com/barrriwa/vfsauto |
| mominurr / visa.vfsglobal.com | https://github.com/mominurr/visa.vfsglobal.com |
| kosiakMD / vfs-bot-free-slots-notify | https://github.com/kosiakMD/vfs-bot-free-slots-notify |
| jimiljojo / visa-slot-bot | https://github.com/jimiljojo/visa-slot-bot |

---

## Активные issues (на момент обзора)

Данные по открытым issues получены через GitHub API. У самых популярных проектов накапливаются запросы на поддержку новых стран, капча-сервисов и исправления после изменений на сайте VFS.

| Репозиторий | Открыто issues | Примечательные открытые issues |
|-------------|----------------|---------------------------------|
| [ranjan-mohanty/vfs-appointment-bot](https://github.com/ranjan-mohanty/vfs-appointment-bot/issues) | **19** | [#125](https://github.com/ranjan-mohanty/vfs-appointment-bot/issues/125) Please Add CaptchaAI Support; [#121](https://github.com/ranjan-mohanty/vfs-appointment-bot/issues/121) Suporte para Portugal; запросы на новые страны и солверы капчи |
| [vlaim/vfs-check](https://github.com/vlaim/vfs-check/issues) | 0 | — |
| [DOXOZ/VFSGlobalAPI](https://github.com/DOXOZ/VFSGlobalAPI/issues) | 0 | — |
| [minhalawais/Visa-Appointment-Automation-VFS-GLOBAL-](https://github.com/minhalawais/Visa-Appointment-Automation-VFS-GLOBAL-/issues) | **1** | [#1](https://github.com/minhalawais/Visa-Appointment-Automation-VFS-GLOBAL-/issues/1) Preenchemento (заполнение формы) |
| [Hit2theMo/vfs-visa-appointment-scraper](https://github.com/Hit2theMo/vfs-visa-appointment-scraper/issues) | 0 | — |
| [berkay-digital/VFS-BOT](https://github.com/berkay-digital/VFS-BOT/issues) | **3** (архив) | [#1](https://github.com/berkay-digital/VFS-BOT/issues/1) The new cloudflare system not working (Turnstile); [#2](https://github.com/berkay-digital/VFS-BOT/issues/2) get error message when try to login («Mandatory field cannot be left empty» после reCAPTCHA); [#3](https://github.com/berkay-digital/VFS-BOT/issues/3) Can you help? (запрос платного бота) |
| [securitsa/vfs-global-appointment-system](https://github.com/securitsa/vfs-global-appointment-system/issues) | 0 | — |
| [IndiaTransform/VFS-VISA-APPOINTMENT-BOT-AUTOMATION-POLAND](https://github.com/IndiaTransform/VFS-VISA-APPOINTMENT-BOT-AUTOMATION-POLAND/issues) | 0 | — |
| [barrriwa/vfsauto](https://github.com/barrriwa/vfsauto/issues) | 1 | проект не обновляется (VFS ввёл баны аккаунтов) |
| [mominurr/visa.vfsglobal.com](https://github.com/mominurr/visa.vfsglobal.com/issues) | 0 | — |
| [kosiakMD/vfs-bot-free-slots-notify](https://github.com/kosiakMD/vfs-bot-free-slots-notify/issues) | 2 | — |
| [jimiljojo/visa-slot-bot](https://github.com/jimiljojo/visa-slot-bot/issues) | 0 | не скрапит VFS, только мониторинг Telegram-канала |

**Выводы по issues:** У ranjan-mohanty — постоянные запросы на интеграцию солверов капчи (CaptchaAI и др.) и поддержку новых стран (Португалия и т.д.). У berkay-digital (архив) типичные проблемы: Cloudflare Turnstile и ошибка «Mandatory field cannot be left empty» после прохождения reCAPTCHA при логине — полезно учитывать при доработке нашего VFS-логина и капчи.

---

## Сводная таблица

| Критерий | ranjan-mohanty / vfs-appointment-bot | vlaim / vfs-check | doxoz / vfsglobalapi | minhalawais / visa-appointment-automation-vfs-global- | Hit2theMo / vfs-visa-appointment-scraper | berkay-digital / VFS-BOT | securitsa / vfs-global-appointment-system | IndiaTransform / VFS-VISA-APPOINTMENT-BOT-AUTOMATION-POLAND |
|----------|--------------------------------------|-------------------|----------------------|--------------------------------------------------------|------------------------------------------|--------------------------|-------------------------------------------|-------------------------------------------------------------|
| **Язык** | Python 3.9+ | Node.js | Python 3.8+ | Python | Python | Python | Python | — (коммерческий) |
| **Автоматизация** | Playwright + playwright-stealth | Puppeteer | DrissionPage (Chromium) | Selenium WebDriver | Selenium | Selenium | — (по описанию похоже на ranjan) | Selenium + прокси, Excel |
| **Назначение** | Поиск слотов, уведомление (без букинга) | Только проверка статуса заявки (не слотов) | Скрап календаря, REST API | Поиск слотов + букинг | Проверка «earliest slot», уведомление по email | Заполнение формы до выбора слота, алерт | Проверка слотов каждые 2 мин, SMS/звонок | Поиск слотов + подача заявки, платный |
| **Конфиг** | config.ini, env VFS_BOT_CONFIG_PATH | .env (URL, APPLICATION_NUMBER, BIRTHDATE) | Креды в коде / env | Словарь в main.py (ref, gmail, city, date) | config.ini / config.py (email, пароль, SMTP) | creds.txt (имя, фамилия, паспорт, тел, mail) | config/config.ini, Twilio | Excel + настройки |
| **Уведомления** | Email (Gmail), Twilio (SMS/звонок), Telegram | Нет (вывод в консоль) | Нет (JSON API) | Заявлено: email, SMS, мессенджеры; в коде — нет | Gmail (schedule каждые 15 мин) | Звуковой алерт (VLC) | Twilio SMS + звонок | — |
| **Cloudflare / капча** | Нет встроенного солвера; совет: подождать, сменить browser_type (Firefox/Chromium) | Не решает (страница track-application, не логин) | Ожидание iframe Cloudflare + time.sleep(15) + click по .mark | Не описано | time.sleep(20) после загрузки страницы | Ручной ввод кредов после загрузки (input) | Не описано | «Auto Captcha Resolver», прокси |
| **Мультипользователь** | Один запуск — один маршрут (страна); интервал между проверками | Один номер заявки в .env | Один пользователь в скрапере | Да: список data[], потоки (threading) по пользователям | Один пользователь | Один пользователь | Один пользователь | Мульти: Excel, прокси, центры |
| **Страны/маршруты** | IN→DE, IQ→DE, MA→IT, AZ→IT; фабрика ботов по коду страны | Польша, СПб (track-application) | Аргентина→Дания (arg/en/dnk) | Пакистан→UK (pak/en/gbr) | Индия→Германия (ind/en/deu) | Турция→Польша (tur/pl/pol) | По конфигу | Польша (национальная занятость и др.) |
| **Архитектура** | CLI, фабрика VfsBot по стране (vfs_bot_de, vfs_bot_it…), конфиг, нотификации отдельно | Один index.js: запуск браузера → форма → iframe со статусом | Один vfsAPI.py: scrape() + Flask /scrape | Один main.py: логин, XPath, календарь, букинг по времени, потоки | Один скрипт: логин → форма → «Earliest Available Slot» → email | Один main.py: логин вручную → search() в цикле с паузой 3–7 мин | Папка vfs_appointment_bot, config, интервал 2 мин | Коммерческий, детали закрыты |
| **Лицензия** | MIT | MIT | — | — | — | MIT (архив) | — | — |
| **Звёзды / активность** | ~361, активен | ~3 | ~3 | ~13 | ~2 | ~17, архив | ~5 | ~2, продажа бота |

---

## Детали по проектам

### 1. [ranjan-mohanty/vfs-appointment-bot](https://github.com/ranjan-mohanty/vfs-appointment-bot)

- **Стек:** Python, Playwright, playwright-stealth, Twilio, tqdm. Конфиг: config.ini (email, пароль, интервал, каналы уведомлений).
- **Подход:** Фабрика `get_vfs_bot(source_country, destination_country)` возвращает класс (VfsBotDe, VfsBotIt и т.д.). Каждый бот: pre_login_steps (cookies), login, check_for_appointment (выбор центра/категории/подкатегории, парсинг дат). Бесконечный цикл: запуск бота → при нахождении слота выход; иначе countdown(interval).
- **Капча:** В README указано, что встроенного солвера нет; при появлении капчи — подождать или сменить browser_type.
- **Плюсы:** Поддержка нескольких стран, несколько каналов уведомлений, PyPI, хорошая структура (utils, notification, vfs_bot по странам).

### 2. [vlaim/vfs-check](https://github.com/vlaim/vfs-check)

- **Стек:** Node.js, Puppeteer, dotenv. Один файл index.js.
- **Подход:** Открывает страницу отслеживания (track-application), вводит номер заявки и дату рождения по полям (Tab), читает статус из iframe (.fnstatus). Не логинится в личный кабинет и не ищет слоты.
- **Отличие:** Не про запись на приём, а про проверку статуса уже поданной заявки.

### 3. [DOXOZ/vfsglobalapi](https://github.com/DOXOZ/VFSGlobalAPI)

- **Стек:** Python, DrissionPage (Chromium), BeautifulSoup, Flask.
- **Подход:** Один скрипт: загрузка страницы → ожидание Cloudflare (get_frame, sleep 15, click .mark) → логин → «Start New Booking» → выбор подкатегории → заполнение формы (имя, фамилия, паспорт и т.д.) → обход календаря на 3 месяца, парсинг fc-daygrid-event, возврат словаря месяц → список дней. Flask endpoint GET /scrape возвращает JSON.
- **Минусы:** Креды и данные захардкожены в коде; Cloudflare обходится примитивно (фиксированная задержка).

### 4. [minhalawais/visa-appointment-automation-vfs-global-](https://github.com/minhalawais/Visa-Appointment-Automation-VFS-GLOBAL-)

- **Стек:** Python, Selenium, WebDriverWait. Один main.py, данные в списке словарей в коде.
- **Подход:** Пакистан→UK. Логин по ref + gmail, выбор города (Islamabad/Karachi/Lahore/Mirpur), переход к календарю. Парсинг календаря по классам fc-daygrid-day-top / fc-daygrid-day-number, сравнение с желаемыми датами (data["date"]). При совпадении — клик по слоту, выбор времени (STRadio), продолжение до страницы оплаты. Запуск по одному потоку на пользователя (threading).
- **Минусы:** Жёсткие XPath, креды в коде, нет явной обработки капчи.

### 5. [Hit2theMo/vfs-visa-appointment-scraper](https://github.com/Hit2theMo/vfs-visa-appointment-scraper)

- **Стек:** Python, Selenium, schedule, smtplib. config.ini / config.py для email и VFS.
- **Подход:** Индия→Германия. Логин, «New Booking», выбор центра/категории/подкатегории (жёсткие XPath). Читает текст «Earliest Available Slot : dd/mm/yyyy», сравнивает с диапазоном from_date–to_date. Результат отправляется по email. schedule.every(15).minutes.
- **Минусы:** Один маршрут, хрупкие селекторы, долгий time.sleep(20) при загрузке.

### 6. [berkay-digital/VFS-BOT](https://github.com/berkay-digital/VFS-BOT)

- **Стек:** Python, Selenium, VLC (звук). creds.txt — построчно имя, фамилия, паспорт, код страны, телефон, mail.
- **Подход:** Турция→Польша. После загрузки страницы — input() для ручного ввода кредов/капчи. Далее автоматически: чекбоксы, «Start New Booking», половая/национальность, персональные данные, выбор категории визы. При появлении селектора mat-select-18 (слот?) — проигрывание Alarm.mp4 и выход. Цикл search() с паузой random 3–7 минут.
- **Особенность:** Полуавтомат: капча/логин вручную, дальше — автоматическое заполнение до алерта.

### 7. [securitsa/vfs-global-appointment-system](https://github.com/securitsa/vfs-global-appointment-system)

- **Описание:** Проверка слотов каждые 2 минуты, уведомление по SMS и звонку (Twilio). Конфиг config.ini. Структура похожа на ranjan (vfs_appointment_bot, config). Код не просматривался детально.

### 8. [IndiaTransform/VFS-VISA-APPOINTMENT-BOT-AUTOMATION-POLAND](https://github.com/IndiaTransform/VFS-VISA-APPOINTMENT-BOT-AUTOMATION-POLAND)

- **Коммерческий:** Оплата по WhatsApp/телефону. Заявлено: ротация прокси, мультицентры, Excel с данными, автологин, «Auto Captcha Resolver», чтение OTP из почты, доведение до оплаты. Детали реализации закрыты.

---

## Дополнительные репозитории (найдены при повторном поиске)

| Проект | Стек / назначение | Звёзды |
|--------|--------------------|--------|
| [barrriwa/vfsauto](https://github.com/barrriwa/vfsauto) | Browser Automation Studio (BAS), .xml-скрипт: мониторинг и букинг слотов, Cloudflare, прокси, Fingerprint Switcher, Telegram. **Не поддерживается** — VFS ввёл баны аккаунтов. | 5 |
| [mominurr/visa.vfsglobal.com](https://github.com/mominurr/visa.vfsglobal.com) | Python: обход Cloudflare, reCAPTCHA-солвер, ротация прокси, уведомления по email. Скрипты по странам: Италия (`vfsglobal_italy.py`), Нидерланды (`vfsglobal_nld.py`). | 7 |
| [kosiakMD/vfs-bot-free-slots-notify](https://github.com/kosiakMD/vfs-bot-free-slots-notify) | **Расширение для браузера** (JavaScript, manifest.json): уведомления в Telegram и на рабочий стол о появлении свободных слотов на VFS. MIT. | 10 |
| [jimiljojo/visa-slot-bot](https://github.com/jimiljojo/visa-slot-bot) | Python + Telegram API: **не скрапит VFS напрямую** — следит за Telegram-каналом (например, с дропбокс-слотами), при появлении скриншотов слотов шлёт уведомление на macOS. | 14 |

### 9. [barrriwa/vfsauto](https://github.com/barrriwa/vfsauto)

- **Стек:** Browser Automation Studio (BAS), один .xml-файл. Платформа Bablosoft (платная), Fingerprint Switcher, PerfectCanvas.
- **Подход:** Импорт vfsauto.xml в BAS → настройка прокси, Telegram, отпечатков → запуск; автоматическая проверка календаря и букинг при появлении слота. Виртуальная клавиатура, «человекоподобные» движения мыши, обработка капчи.
- **Ограничение:** Автор объявил проект устаревшим из‑за банов VFS и больше не обновляет.

### 10. [mominurr/visa.vfsglobal.com](https://github.com/mominurr/visa.vfsglobal.com)

- **Стек:** Python, отдельные скрипты по странам (Italy, NLD).
- **Подход:** Обход Cloudflare, решение reCAPTCHA, ротация IP/прокси, проверка доступных слотов, уведомление по email. Близко по идее к нашему сценарию (капча + уведомления).

### 11. [kosiakMD/vfs-bot-free-slots-notify](https://github.com/kosiakMD/vfs-bot-free-slots-notify)

- **Стек:** Расширение для браузера (JS, popup, manifest).
- **Подход:** Пользователь открывает страницу VFS в браузере с установленным расширением; расширение отслеживает появление свободных слотов и шлёт уведомления в Telegram и на рабочий стол. Не headless — нужен открытый браузер.

### 12. [jimiljojo/visa-slot-bot](https://github.com/jimiljojo/visa-slot-bot)

- **Назначение:** Не работа с сайтом VFS, а мониторинг **Telegram-канала** (например, канала с скриншотами слотов Dropbox). При появлении контента со слотами скрипт отправляет десктоп-уведомление. Полезен как доп. канал оповещения, если кто-то публикует слоты в канале.

---

## Выводы для нашего проекта (us-visa-bot)

| Аспект | Что взять из репозиториев |
|--------|---------------------------|
| **Страны** | Идея фабрики ботов по маршруту (как ranjan) уже близка к нашему VisaProvider по провайдеру (AIS/VFS). Для VFS можно завести отдельные «страновые» сценарии при необходимости. |
| **Cloudflare** | doxoz: только ожидание и клик; ranjan: без солвера. У нас уже есть Puppeteer + stealth и опция 2Captcha для Turnstile — это сильнее. |
| **Уведомления** | ranjan: Email, Twilio, Telegram — у нас уже Telegram; при необходимости можно добавить другие каналы по образцу config.ini. |
| **Конфиг** | Не хранить креды в коде (doxoz, minhalawais) — у нас .env и опционально Settings в Sheets. |
| **Проверка слотов** | ranjan: парсинг дат из div.alert / календаря; Hit2theMo: «Earliest Available Slot» текстом. Для нашего VFS стоит вынести парсинг календаря в отдельные селекторы/стратегии по странице. |
| **Мультипользователь** | minhalawais: потоки по пользователям; у нас — пул из Sheets, ротация, один процесс. Для VFS мультипользователь уже заложен через общий контур monitor. |
| **Статус заявки** | vlaim/vfs-check напоминает, что VFS также даёт страницу «track application» (по номеру заявки и дате рождения) — отдельный сценарий, не букинг. |

Файл можно дополнять по мере появления новых репозиториев или углублённого разбора кода.
