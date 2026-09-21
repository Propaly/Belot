import { existsSync, rmSync } from "node:fs";
import type { ReplayEngine } from "../src/game/replay.ts";

// Отделен тестов DB файл (не пипаме реалната история).
const TEST_DB = "/tmp/opencode/belot-test-history.db";
for (const f of [TEST_DB, `${TEST_DB}-wal`, `${TEST_DB}-shm`]) {
    if (existsSync(f)) rmSync(f);
}
process.env.DB_PATH = TEST_DB;

const { mulberry32, setRandom } = await import("../src/game/deck.ts");
const { chooseBid, chooseCard, deal, placeCall, playCard, resolveTrick } = await import("../src/game/engine.ts");
const { GameRecorder } = await import("../src/game/history.ts");
const { decodeGameLog, encodeGameLog } = await import("../src/game/notation.ts");
const { replayGame, replayStates } = await import("../src/game/replay.ts");
const { getGame, listGames, saveGame } = await import("../server/db.ts");

let failures = 0;
function check(ok: boolean, name: string): void {
    if (!ok) failures += 1;
    console.log(`${ok ? "✓" : "✗"} ${name}`);
}

const engine: ReplayEngine = {
    placeCall: (s, c, seat) => placeCall(s, c, seat),
    playCard: (s, id, seat) => playCard(s, id, seat),
    resolveTrick: (s) => resolveTrick(s),
};

// ---- 1. Записваме пълна игра чрез GameRecorder ----
setRandom(mulberry32(4242));
let state = deal(4);
const recorder = new GameRecorder(4242, 4);
recorder.observe(state);

let guard = 0;
while (!state.finished && guard++ < 20000) {
    if (state.phase === "bidding") {
        const seat = state.biddingTurn;
        const call = chooseBid(state, seat);
        recorder.observe(state);
        recorder.bid(seat, call);
        state = placeCall(state, call, seat);
        recorder.observe(state);
    } else if (state.phase === "playing") {
        if (state.trickComplete) {
            const over = state.players.every((p) => p.hand.length === 0);
            state = resolveTrick(state);
            if (over) recorder.endDeal(state);
        } else {
            const seat = state.currentPlayer;
            const id = chooseCard(state, seat);
            if (!id) break;
            recorder.observe(state);
            recorder.play(seat, id);
            state = playCard(state, id, seat);
            recorder.observe(state);
        }
    } else break;
}

const log = recorder.log("test");
console.log("Записана игра:", log.deals.length, "раздавания, точки", state.score.join(":"));

// ---- 2. Нотация + replay ----
const notation = encodeGameLog(log);
const back = decodeGameLog(notation);
const outcome = replayGame(back, engine);
check(encodeGameLog(back) === notation, "нотацията е стабилна");
check(outcome.ok, "replay-ът на записа минава без грешка");
check(
    outcome.score[0] === state.score[0] && outcome.score[1] === state.score[1],
    `точките съвпадат (${outcome.score.join(":")})`
);

const steps = replayStates(back, engine);
check(steps.length > 0, `replay viewer има ${steps.length} стъпки`);

// ---- 3. Преглед: точки и анонси (терца/кварта/квинта/каре) ----
console.log("");
console.log("Преглед по раздавания:");
let withAnnounce = 0;
for (const [i, dealOutcome] of outcome.deals.entries()) {
    const r = dealOutcome.review;
    const ann = r.announcements
        .map((labels, seat) => (labels.length ? `сед ${seat}: ${labels.join(", ")}` : null))
        .filter(Boolean)
        .join(" | ");
    if (ann) withAnnounce += 1;
    console.log(
        `  #${i + 1} ${r.contract ?? "—"} x${r.multiplier} · взятки ${r.tricksWon.join(":")} · ` +
            `резултат ${dealOutcome.roundTotal.join(":")} ${ann ? "· " + ann : ""}`
    );
}
check(outcome.deals.every((d) => d.review.announcements.length === 4), "всяко раздаване има данни за анонси по играчи");
void withAnnounce;

// ---- 4. SQLite: запис и четене ----
const id = saveGame({
    roomCode: "TEST",
    rounds: log.deals.length,
    score: [state.score[0], state.score[1]],
    winner: state.score[0] >= state.score[1] ? 0 : 1,
    finished: true,
    players: [{ seat: 0, name: "А" }, { seat: 1, name: "Б" }, { seat: 2, name: "В" }, { seat: 3, name: "Г" }],
    notation,
});

const list = listGames(10);
const detail = getGame(id);
check(list.length === 1 && list[0].id === id, "SQLite: играта се появява в списъка");
check(!!detail && detail.notation === notation, "SQLite: нотацията се чете обратно 1:1");

if (failures > 0) {
    console.error(`\n${failures} проверки се провалиха.`);
    process.exit(1);
}
console.log("\nИсторията, нотацията и прегледът работят.");
