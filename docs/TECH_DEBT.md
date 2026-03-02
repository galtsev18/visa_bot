# Техдолг

Выявленные проблемы архитектуры и неиспользуемый код. Структура и слои — в [ARCHITECTURE.md](ARCHITECTURE.md). Планы по улучшению (в т.ч. по ревью архитектуры) — в [ROADMAP.md](ROADMAP.md).

---

## 1. Проблемы архитектуры


| Проблема                  | Где                                | Статус                                                                                                      |
| ------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Дублирование AIS-пути     | client vs providers/ais            | Частично решено: при composition root используется провайдер.                                               |
| Единый провайдер          | Bot, UserBotManager                | Решено: фабрика и ProviderBackedClient.                                                                     |
| Глобальное состояние      | sheets, dateCache, telegram        | Частично решено: dateCache — createDateCache() + экземпляр в composition root; sheets/telegram — актуально. |
| Смешение слоёв            | UserBotManager при отсутствии deps | Решено: один путь через composition root; deps обязательны.                                                 |
| Конфиг из двух источников | config + Settings                  | Решено: MergedConfigProvider, getConfig(): Promise.                                                         |
| Типизация                 | lib, commands                      | Решено: весь src на TypeScript.                                                                             |
| Дублирование в Sheets     | sheets                             | Частично решено: порт UserRepository есть.                                                                  |
| Жёсткая связь с Sheets    | UserBotManager                     | Решено на уровне порта.                                                                                     |
| Один процесс              | monitor                            | Актуально: масштабирование только вертикальное.                                                             |


---

## 2. Неиспользуемый код

- **lib/dateCache** — функции `_isDateCached`, `_getAvailableTimes`, `_getStaleDates` не экспортируются (внутренние, префикс _ для линта).

