import { createPlayers, resolveTrick } from "../src/game/engine.ts";
import type { Card, Contract, GameState, Rank, Suit, TrickCard } from "../src/types.ts";

/**
 * Малък, dependency-free тест на точкуването. Пуска се с
 * `npm run test:rules`. Проверява точно новите правила:
 *  - отбор с 0 точки в раздаването получава -10;
 *  - загубил на контра получава -(10 × 2), а при "Без коз" -(20 × 2);
 *  - загубил на реконтра получава -(10 × 4), а при "Без коз" -(20 × 4).
 */

let failures = 0;

function check(name: string, actual: number, expected: number): void {
    const ok = actual === expected;
    if (!ok) failures += 1;
    console.log(`${ok ? "✓" : "✗"} ${name}: ${actual} (очаквано ${expected})`);
}

const DUMMY_TRICK: TrickCard[] = [0, 1, 2, 3].map((playerId) => ({
    playerId,
    card: { id: `dummy-${playerId}`, suit: "♠", rank: "7" },
}));

const c = (suit: Suit, rank: Rank): Card => ({ id: `${suit}-${rank}`, suit, rank });

function finishedRound(options: {
    contract: Contract;
    declarer: number;
    multiplier: 1 | 2 | 4;
    tricksWon: [number, number];
    tricksCount: [number, number];
    lastWinnerTeam: 0 | 1;
    initialHands?: Card[][];
}): GameState {
    const players = createPlayers(0).map((p) => ({ ...p, hand: [] }));

    return {
        players,
        deck: [],
        phase: "playing",
        humanSeat: 0,
        dealer: 3,
        biddingTurn: 0,
        bidHistory: [],
        highestBid: { contract: options.contract, playerId: options.declarer },
        passStreak: 0,
        contract: options.contract,
        declarer: options.declarer,
        initialHands: options.initialHands ?? [[], [], [], []],
        multiplier: options.multiplier,
        currentPlayer: options.lastWinnerTeam,
        trick: DUMMY_TRICK,
        trickComplete: true,
        tricksWon: options.tricksWon,
        tricksCount: options.tricksCount,
        lastTrickWinnerTeam: options.lastWinnerTeam,
        score: [0, 0],
        round: 1,
        message: "",
        finished: false,
    };
}

function delta(state: GameState): [number, number] {
    const next = resolveTrick(state);
    return [next.score[0] - state.score[0], next.score[1] - state.score[1]];
}

console.log("Правила за контра / реконтра");
{
    const d = delta(
        finishedRound({
            contract: "♣",
            declarer: 0,
            multiplier: 2,
            tricksWon: [40, 112],
            tricksCount: [3, 5],
            lastWinnerTeam: 1,
        })
    );
    check("контра, губещ отбор = -20", d[0], -20);
    check("контра, печеливш отбор = 32", d[1], 32);
}
{
    const d = delta(
        finishedRound({
            contract: "NO_TRUMP",
            declarer: 0,
            multiplier: 2,
            tricksWon: [40, 80],
            tricksCount: [3, 5],
            lastWinnerTeam: 1,
        })
    );
    check("контра без коз, губещ отбор = -40", d[0], -40);
}
{
    const d = delta(
        finishedRound({
            contract: "♥",
            declarer: 0,
            multiplier: 4,
            tricksWon: [40, 112],
            tricksCount: [3, 5],
            lastWinnerTeam: 1,
        })
    );
    check("реконтра, губещ отбор = -40", d[0], -40);
}
{
    const d = delta(
        finishedRound({
            contract: "NO_TRUMP",
            declarer: 0,
            multiplier: 4,
            tricksWon: [40, 80],
            tricksCount: [3, 5],
            lastWinnerTeam: 1,
        })
    );
    check("реконтра без коз, губещ отбор = -80", d[0], -80);
}

console.log("");
console.log("Правило за 0 точки в раздаването");
{
    // Отбор 0 взема всичките 8 взятки (152 т.), отбор 1 остава с 0.
    const d = delta(
        finishedRound({
            contract: "♣",
            declarer: 0,
            multiplier: 1,
            tricksWon: [152, 0],
            tricksCount: [8, 0],
            lastWinnerTeam: 0,
        })
    );
    check("капо: печелившият отбор = 16 + 9 (капо)", d[0], 25);
    check("капо: отборът с 0 точки = -10", d[1], -10);
}

console.log("");
console.log("Непокрит договор");
{
    const d = delta(
        finishedRound({
            contract: "♣",
            declarer: 0,
            multiplier: 1,
            tricksWon: [60, 92],
            tricksCount: [3, 5],
            lastWinnerTeam: 1,
        })
    );
    check("декларантът губи 10", d[0], -10);
    check("противникът взема целия ход (16)", d[1], 16);
}

console.log("");
console.log("Стакиращи се анонси");
{
    // Отбор 1 (седалки 1) има белот + 2 терци = 2 + 2 + 2 = 6 бонус.
    // Избираме раздаване, в което декларантът покрива договора.
    const initialHands: Card[][] = [
        [],
        [c("♣", "K"), c("♣", "Q"), c("♠", "7"), c("♠", "8"), c("♠", "9"), c("♥", "7"), c("♥", "8"), c("♥", "9")],
        [],
        [],
    ];
    const d = delta(
        finishedRound({
            contract: "♣",
            declarer: 0,
            multiplier: 1,
            tricksWon: [120, 32],
            tricksCount: [5, 3],
            lastWinnerTeam: 0,
            initialHands,
        })
    );
    // Взятки 13:3 (130:32 след бонус за последна взятка) + 6 анонса за отбор 1.
    check("белот + 2 терци = +6 за отбор 1", d[1], 3 + 6);
}
{
    // Белот + кварта = 2 + 5 = 7.
    const initialHands: Card[][] = [
        [],
        [c("♣", "K"), c("♣", "Q"), c("♠", "7"), c("♠", "8"), c("♠", "9"), c("♠", "10")],
        [],
        [],
    ];
    const d = delta(
        finishedRound({
            contract: "♣",
            declarer: 0,
            multiplier: 1,
            tricksWon: [120, 32],
            tricksCount: [5, 3],
            lastWinnerTeam: 0,
            initialHands,
        })
    );
    check("белот + кварта = +7 за отбор 1", d[1], 3 + 7);
}

console.log("");
console.log("Капо при 'Без коз'");
{
    const d = delta(
        finishedRound({
            contract: "NO_TRUMP",
            declarer: 0,
            multiplier: 1,
            tricksWon: [120, 0],
            tricksCount: [8, 0],
            lastWinnerTeam: 0,
        })
    );
    check("капо без коз: отборът с 0 точки = -20", d[1], -20);
    check("капо без коз: печелившият = 26 + 18", d[0], 44);
}

if (failures > 0) {
    console.error(`\n${failures} проверки се провалиха.`);
    process.exit(1);
}

console.log("\nВсички проверки минаха.");
