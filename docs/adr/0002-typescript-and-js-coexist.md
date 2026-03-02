# ADR-0002: TypeScript и JavaScript в одном репозитории

**Status:** Superseded (миграция завершена)  
**Date:** 2025-03  
**Deciders:** Команда проекта

## Context

Проект изначально на JavaScript. Полный переход на TypeScript за один шаг рискован и трудоёмок. Нужна типизация для портов, use cases и адаптеров, при этом сохранить работоспособность существующего кода в `src/lib/` и `src/commands/` без массового переписывания.

## Decision (историческое)

Допускалось **сосуществование TypeScript и JavaScript** в `src/`: порты, application и адаптеры — на TypeScript; CLI, lib — на JavaScript. Запуск из `src` через tsx.

## Текущее состояние (обновление)

Миграция завершена: **весь `src/` и тесты на TypeScript**. Импорты без расширений, `moduleResolution: "Bundler"`. Запуск: `npm start` и `npm run dev` выполняют `tsx src/index.ts`. Реэкспорты и дублирующие `.js` в `src/` удалены. VFS и все команды работают при запуске через tsx из src.
