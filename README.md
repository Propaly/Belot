# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is enabled on this template. See [this documentation](https://react.dev/learn/react-compiler) for more information.

Note: This will impact Vite dev & build performances.
You can also try [the experimental native React Compiler support in plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react/README.md#rust-react-compiler) by using `compiler: true` in the plugin options instead of using the Babel plugin.

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.


## Точки по зададените правила

- Провален договор: **10 т.** при боя / „Всичко коз“.
- Провален договор „Без коз“: **20 т.**
- **Контра** удвоява санкцията на губещия: **-20 т.** при боя / **-40 т.** при „Без коз“ (загубилият не получава своите анонси).
- **Реконтра** учетворява санкцията: **-40 т.** при боя / **-80 т.** при „Без коз“.
- Отбор, който завърши раздаването с **0 точки** (взятки + белот + анонси), получава **-10 т.** вместо 0.
- **Капо**: отборът, взел всичките 8 взятки, получава обичайния премиен бонус **+9 т.** (+18 т. при „Без коз“), а отборът без нито една взятка получава **-10 т.** (правилото за 0 точки).
- При успешен договор нормалното точкуване на взятките, белотът и анонсите се запазват.

> Забележка: текущият MVP е локална игра срещу ботове. Онлайн играта с приятели изисква отделен сървър/room система; тази промяна подготвя точкуването, но не добавя мрежова инфраструктура.

## Тестване на играта с агенти

`npm run sim` пуска headless симулации - 4 агента изиграват цели игри без UI и проверяват инварианти (брой/уникалност на карти, запазване на точките, легални ходове, край на играта). При проблем се записва възпроизводим отчет в `sim-reports/` (seed + пълна история).

```bash
npm run sim                                   # 200 игри с разумни ботове
npm run sim -- --games 2000 --agents random   # fuzzing със случайни агенти
npm run sim -- --agents mixed --seed 42       # смесени ботове, конкретен seed
npm run sim:fuzz                              # 500 случайни игри
npm run test:rules                            # проверки на точкуването (контра/реконтра/0 точки)
```

Всеки докладван бъг може да се възпроизведе:

```bash
npm run sim -- --agents random --games 1 --seed <seed> --stop-on-bug
```

Освен headless симулацията, в самото приложение има **Тестов режим (агенти)** (началният екран). Четири агента играят сами на всички места; може да се превключва между „Разумни“ и „Хаос“ агенти и скорост, а след край автоматично започва нова игра. Така се ловят бъгове в реалния UI (аватар, обяви, бои, анонси, взятки).

## Нотация и replay („език“ за позиции и игри)

Има пълна нотация, подобна на FEN/PGN в шаха. „Seed“ тук означава **конкретната ръка** - картите на играчите, чий ред е, взятката, козът и т.н. - така че всяко състояние може да се запише, сподели и възстанови 1:1, без да зависи от случайността.

- **Позиция** (един ред): `belot1 <фаза> <dealer> <раздаване> <humanSeat> <точки> <biddingTurn> <currentPlayer> <най-висока обява> <множител> <пас> <договор> <декларант> <взятки точки> <взятки брой> <последен> <взятка завършена> <обяви> <взятка> <ръце> <тесте> <начални ръце>`
- **Игра**: заглавен ред `belot1|<резултат>` + по един ред на раздаване: `<позиция>|<ходове>`, където ходовете са `b<seat><обява>` и `p<seat><карта>`.
- **Карти**: ранг + боя -> `7 8 9 T J Q K A` + `S H D C` (напр. `AS`, `TD`, `7C`); **обяви**: `S H D C N A X R P`.

Пример за начало на игра:

```
belot1|152:82
belot1 B 0 1 0 0:0 3 3 - 1 0 - - 0:0 0:0 - 0 - - JSKSJC8HAH,9D9S8CTD7H,8DTHTC9CKC,ADASKDACQD TS7C7DQHQSJH9HKHJDQC8S7S -|b3N b2P b1A b0X b3P b2P b1P p3AD p28D ...
```

Редът на картите в ръцете се пази точно (ботовете взимат първата легална карта), затова replay-ът е детерминиран.

```bash
# записване на replay-и (в replays/) при симулация
npm run sim -- --games 4 --seed 7 --save-replays

# пускане на запазени игри върху ТЕКУЩИЯ код
npm run replay -- --file replays/game-s7-i0.bel

# същото, но и върху СТАРИЯ (commit-нат) код -> вижда се дали бъг още се случва
npm run replay -- --all --old

# произволна позиция: показване и изиграване с агенти (старо/ново сравнение)
npm run replay -- --position "belot1 B 0 1 0 0:0 3 3 - 1 0 - - 0:0 0:0 - 0 - - JSKSJC8HAH,9D9S8CTD7H,8DTHTC9CKC,ADASKDACQD TS7C7DQHQSJH9HKHJDQC8S7S -" \
  --playout --agents random --games 50 --old

npm run test:notation   # тестове на нотацията (кодиране/декодиране/replay)
npm run verify          # typecheck + правила + нотация + replay на всички fixtures
```

Докладваните бъгове съдържат готов низ в нотацията (`sim-reports/bug-*.bel`), който може директно да се подаде на `npm run replay --file ... --old`, за да се провери дали още се възпроизвежда. Така агентната симулация служи и като основа да се изиграят произволни позиции („всеки възможен“ сценарий) и да се сравни старото с новото поведение.

