import { createDeck } from "../src/game/deck.ts";
import {
    decodeCard,
    decodeGameLog,
    decodePosition,
    encodeCard,
    encodeGameLog,
    encodePosition,
} from "../src/game/notation.ts";
import {
    buildBiddingState,
    replayGame,
    stateSignature,
} from "../src/game/replay.ts";
import { simulateGame } from "../src/game/sim.ts";
import { currentEngineApi } from "./engines.ts";

/**
 * Тестове на нотацията ("езика") за позиции и игри:
 *  - всяка карта се кодира/декодира 1:1;
 *  - позиция -> нотация -> позиция е идентична (вкл. начални ръце, deck ред);
 *  - игра -> нотация -> игра се replay-ва със същото развитие и точки.
 */

let failures = 0;

function check(ok: boolean, name: string): void {
    if (!ok) failures += 1;
    console.log(`${ok ? "✓" : "✗"} ${name}`);
}

console.log("Кодиране на карти");
{
    let ok = true;
    for (const card of createDeck()) {
        const back = decodeCard(encodeCard(card));
        if (back.id !== card.id || back.suit !== card.suit || back.rank !== card.rank) {
            ok = false;
        }
    }
    check(ok, "всичките 32 карти се кодират/декодират 1:1");
}

const api = currentEngineApi();

// Генерираме истинска игра и проверяваме нотацията върху нея.
const game = simulateGame(20240921, 0, {}).replay;

console.log("");
console.log("Позиция -> нотация -> позиция");
{
    let ok = true;
    let scoreOk = true;
    let initialOk = true;
    let count = 0;

    const verifyState = (state: ReturnType<typeof buildBiddingState>) => {
        const decoded = decodePosition(encodePosition(state));
        count += 1;

        if (stateSignature(decoded) !== stateSignature(state)) ok = false;
        if (decoded.score[0] !== state.score[0] || decoded.score[1] !== state.score[1]) {
            scoreOk = false;
        }
        if (
            JSON.stringify(decoded.initialHands.map((h) => h.map((c) => c.id))) !==
            JSON.stringify(state.initialHands.map((h) => h.map((c) => c.id)))
        ) {
            initialOk = false;
        }
    };

    for (const deal of game.deals) {
        let state = buildBiddingState(deal);
        verifyState(state);

        for (const bid of deal.bidding) {
            state = api.placeCall(state, bid.call, bid.seat);
            verifyState(state);
        }

        for (const play of deal.plays) {
            if (state.trickComplete) {
                state = api.resolveTrick(state);
                verifyState(state);
            }
            state = api.playCard(state, play.cardId, play.seat);
            verifyState(state);
        }
    }

    check(ok, `подписът на ${count} междинни позиции съвпада след кодиране`);
    check(scoreOk, "точките се запазват във всяка позиция");
    check(initialOk, "началните ръце (за анонси) се запазват");
}

console.log("");
console.log("Игра -> нотация -> игра");
{
    const notation = encodeGameLog(game);
    const back = decodeGameLog(notation);
    const stable = encodeGameLog(back) === notation;
    check(stable, "нотацията е стабилна след декодиране");

    const a = replayGame(game, api);
    const b = replayGame(back, api);
    check(a.ok && b.ok, "и двата replay-а минават без грешка");
    check(
        a.checksum === b.checksum,
        "развитието от нотацията съвпада с това от JSON лога"
    );
    check(
        a.score[0] === b.score[0] && a.score[1] === b.score[1],
        `точките съвпадат (${a.score[0]}:${a.score[1]})`
    );
}

if (failures > 0) {
    console.error(`\n${failures} проверки се провалиха.`);
    process.exit(1);
}

console.log("\nВсички проверки на нотацията минаха.");
