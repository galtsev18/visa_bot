# Планы на будущее

Текущее состояние и техдолг — в [ARCHITECTURE.md](ARCHITECTURE.md) и [TECH_DEBT.md](TECH_DEBT.md). Требования при изменениях — в [REQUIREMENTS.md](REQUIREMENTS.md).

---

## Выполнено (план по целевой архитектуре)

- **Типизация:** typecheck без подавлений, порты и адаптеры типизированы ([CODE_QUALITY.md](CODE_QUALITY.md) § 3, [CONTRACTS.md](CONTRACTS.md)).
- **Тесты:** контрактные тесты в `test/contracts/` (UserRepository, NotificationSender, DateCache); интеграционный один цикл в `test/integration/monitor-one-cycle.test.ts`.
- **Слой domain:** `src/domain/` (dateUtils, User, userRotation), фабрика createUser в lib/user.ts, [ADR 0003](adr/0003-domain-layer.md), обновлён ARCHITECTURE.md.
- **lib/sheets:** разбиение на зоны (блок Structure, секции 1–8), низкоуровневый API в `lib/sheetsClientCore.ts`. CI (lint, typecheck, test) проходит перед merge.
- **Покрытие:** c8, `npm run coverage`, шаг в CI, см. [TESTING.md](TESTING.md) § 6.
- **createMonitorContext:** опциональные `repo` и `notifications` для подмены адаптеров; интеграционный тест «один цикл с моком repo + notifications» в `test/integration/monitor-one-cycle.test.ts`.

---

## Возможные следующие шаги

- Задать минимальный порог покрытия в CI (флаг `--check-coverage` в c8).
