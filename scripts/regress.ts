import * as newEngine from "../src/game/engine.ts";
import * as newDeck from "../src/game/deck.ts";
import { stateSignature } from "../src/game/replay.ts";
import { loadLegacyModule } from "./engines.ts";

/**
 * Диференциална регресия: възпроизвежда СТАРИЯ (commit-нат) вариант на
 * двигателя и новия (текущ) с еднакъв seed, чрез детерминирани ботове.
 *
 * Ако рефакторингът е променил поведението (наддаване, ход, взятки,
 * анонси, договор), подписите на състоянията ще се разминат. Единствената
 * позволена разлика е крайният резултат (точки) - заради умишлените
 * промени в точкуването (контра/реконтра и "0 точки").
 *
 * Пускане: npm run regress [-- --games 2000 --base HEAD]
 */

function readArg(name: string, fallback: string): string {
    const prefix = `--${name}=`;
    const inline = process.argv.find((a) => a.startsWith(prefix));
    if (inline) return inline.slice(prefix.length);
    const index = process.argv.indexOf(`--${name}`);
    if (index !== -1 && process.argv[index + 1]) return process.argv[index + 1];
    return fallback;
}

const games = Number(readArg("games", "2000"));
const seed = Number(readArg("seed", "1"));
const base = readArg("base", "HEAD");

const oldEngine = await loadLegacyModule(base);

type Trace = { steps: string[]; score: [number, number] };

/**
 * Изиграва една игра с даден двигател. Ботовете са детерминирани, а
 * разбъркването е seeded, затова при еднакъв seed двата двигателя трябва
 * да дадат еднаква последователност от състояния (с изключение на точките).
 */
function play(engine: any, dealt: any): Trace {
    let state = dealt;
    const steps: string[] = [];
    let guard = 0;

    while (!state.finished && guard++ < 200000) {
        steps.push(stateSignature(state));

        if (state.phase === "bidding") {
            state = engine.botBid(state);
        } else if (state.phase === "playing") {
            state = state.trickComplete
                ? engine.resolveTrick(state)
                : engine.botMove(state);
        } else {
            break;
        }
    }

    return { steps, score: state.score };
}

let identical = 0;
let lengthDiffs = 0;
let scoreDiffs = 0;
let maxAbsDelta = 0;
let regressions = 0;
const details: string[] = [];

const originalMathRandom = Math.random;

for (let i = 0; i < games; i++) {
    const gameSeed = (seed + i) >>> 0;

    // Стар двигател: разбърква през глобалния Math.random.
    Math.random = newDeck.mulberry32(gameSeed);
    const oldTrace = play(oldEngine, oldEngine.deal(4));

    // Нов двигател: разбърква през seeded RNG на собствения си модул.
    newDeck.setRandom(newDeck.mulberry32(gameSeed));
    const newTrace = play(newEngine, newEngine.deal(4));
    newDeck.resetRandom();

    Math.random = originalMathRandom;

    const common = Math.min(oldTrace.steps.length, newTrace.steps.length);
    let mismatch = -1;
    for (let k = 0; k < common; k++) {
        if (oldTrace.steps[k] !== newTrace.steps[k]) {
            mismatch = k;
            break;
        }
    }

    if (mismatch === -1) {
        // Общият префикс съвпада. Различната дължина е ОЧАКВАНА: новото
        // точкуване променя кога отбор достига 151 т., затова едната игра
        // може да свърши по-рано.
        identical += 1;
        if (oldTrace.steps.length !== newTrace.steps.length) lengthDiffs += 1;
    } else {
        regressions += 1;
        if (details.length < 5) {
            details.push(
                `seed=${gameSeed}: първа разлика на стъпка ${mismatch}\n` +
                    `  стар: ${oldTrace.steps[mismatch]}\n` +
                    `  нов:  ${newTrace.steps[mismatch]}`
            );
        }
    }

    const delta0 = newTrace.score[0] - oldTrace.score[0];
    const delta1 = newTrace.score[1] - oldTrace.score[1];

    if (delta0 !== 0 || delta1 !== 0) {
        scoreDiffs += 1;
        maxAbsDelta = Math.max(maxAbsDelta, Math.abs(delta0), Math.abs(delta1));
    }
}

const pct = ((identical / games) * 100).toFixed(2);

console.log("Белот диференциална регресия");
console.log(`  база (стар код): ${base}`);
console.log(`  игри:            ${games}, seed: ${seed}`);
console.log("");
console.log(`  еднакво развитие на играта: ${identical}/${games} (${pct}%)`);
console.log(`  игри с различен край:       ${lengthDiffs} (заради новото точкуване)`);
console.log(`  игри с различен резултат:   ${scoreDiffs} (очаквано - ново точкуване)`);
console.log(`  макс. разлика в точки:      ${maxAbsDelta}`);
console.log(`  РЕГРЕСИИ (разминало се поведение): ${regressions}`);

if (regressions > 0) {
    console.log("");
    console.log("Примери за разминаване:");
    console.log(details.join("\n"));
    console.error(
        "\nВНИМАНИЕ: новият код променя развитието на играта спрямо стария!"
    );
    process.exit(1);
}

console.log("");
console.log("Развитието на играта е идентично; разлики има само в точкуването.");
