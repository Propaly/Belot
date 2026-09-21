import type { Call, Card, GameState } from "../types.ts";
import { stateSignature, type ReplayEngine } from "./replay.ts";

/**
 * Пълен интерфейс на двигател, нужен за да пуснем агенти върху ПРОИЗВОЛНА
 * позиция (не само от началото на раздаване). Изпълнимият replay (вж.
 * replay.ts) дава placeCall/playCard/resolveTrick; тук добавяме и
 * решенията на ботовете + проверки за легалност.
 */
export type EngineApi = ReplayEngine & {
    chooseBid(state: GameState, seat: number): Call;
    chooseCard(state: GameState, seat: number): string | null;
    legalCalls(state: GameState, seat: number): Call[];
    canPlayCard(state: GameState, card: Card): boolean;
};

export type PositionAgent = {
    name: string;
    bid(state: GameState, seat: number): Call;
    play(state: GameState, seat: number): string | null;
};

export type PlayoutOptions = {
    maxSteps?: number;
    /**
     * Спиране в края на текущото раздаване (по подразбиране true) - така
     * позицията се изиграва детерминирано, без ново случайно раздаване,
     * което е нужно за сравнение старо/ново.
     */
    stopAfterDeal?: boolean;
};

export type PlayoutResult = {
    state: GameState;
    steps: number;
    /** true, ако раздаването е завършило (всички карти изиграни). */
    dealComplete: boolean;
    /** Хеш на развитието на играта (без точки) - за сравнение старо/ново. */
    checksum: string;
};

/** Агент от типа "умен" (двигателният бот) или "случаен, но легален". */
export function makeAgent(
    api: EngineApi,
    kind: "smart" | "random",
    rng: () => number = Math.random
): PositionAgent {
    if (kind === "smart") {
        return {
            name: "smart",
            bid: (state, seat) => api.chooseBid(state, seat),
            play: (state, seat) => api.chooseCard(state, seat),
        };
    }

    return {
        name: "random",
        bid: (state, seat) => {
            const options = api.legalCalls(state, seat);
            if (!options.length) return "PASS";
            return options[Math.floor(rng() * options.length)] ?? "PASS";
        },
        play: (state, seat) => {
            const legal = state.players[seat].hand.filter((card) =>
                api.canPlayCard(state, card)
            );
            if (!legal.length) return null;
            return legal[Math.floor(rng() * legal.length)].id;
        },
    };
}

/**
 * Изиграва позицията до края на текущото раздаване (или до края на играта,
 * ако stopAfterDeal=false) с подадените агенти. Започва от ПРОИЗВОЛНА
 * позиция - може да е средата на наддаване, средата на взятка и т.н.
 */
export function playOut(
    start: GameState,
    api: EngineApi,
    agents: PositionAgent[],
    options: PlayoutOptions = {}
): PlayoutResult {
    const maxSteps = options.maxSteps ?? 20000;
    const stopAfterDeal = options.stopAfterDeal ?? true;

    let state = start;
    let steps = 0;
    const startRound = start.round;
    let dealComplete = false;
    const hashes: string[] = [];

    while (!state.finished) {
        hashes.push(stateSignature(state));

        if (++steps > maxSteps) {
            throw new Error(`playOut: надхвърлени ${maxSteps} стъпки`);
        }

        // Край на раздаването: всички ръце са празни и последната взятка
        // е завършена. Резолвваме я и (по подразбиране) спираме.
        if (
            state.phase === "playing" &&
            state.trickComplete &&
            state.players.every((p) => p.hand.length === 0)
        ) {
            state = api.resolveTrick(state);
            dealComplete = true;
            if (stopAfterDeal) break;
            continue;
        }

        if (state.phase === "bidding") {
            const seat = state.biddingTurn;
            const call = agents[seat].bid(state, seat);

            if (!api.legalCalls(state, seat).includes(call)) {
                throw new Error(`playOut: нелегална обява seat ${seat}: ${call}`);
            }

            state = api.placeCall(state, call, seat);

            // 4 паса водят до ново (случайно) раздаване - спираме, за да
            // запазим детерминизма на изиграването на позицията.
            if (state.round !== startRound) break;
            continue;
        }

        if (state.phase === "playing") {
            if (state.trickComplete) {
                state = api.resolveTrick(state);
                continue;
            }

            const seat = state.currentPlayer;
            const cardId = agents[seat].play(state, seat);

            if (!cardId) {
                throw new Error(`playOut: агентът на seat ${seat} не върна карта`);
            }

            const card = state.players[seat].hand.find((c) => c.id === cardId);
            if (!card || !api.canPlayCard(state, card)) {
                throw new Error(
                    `playOut: нелегален ход seat ${seat}: ${cardId}`
                );
            }

            state = api.playCard(state, cardId, seat);
            continue;
        }

        break;
    }

    // Ако раздаването е приключило, последният resolve вече е създал нова
    // (случайна) ръка - не я хешираме, за да остане сравнението детерминирано.
    if (!dealComplete) hashes.push(stateSignature(state));

    return { state, steps, dealComplete, checksum: hash(hashes) };
}

function hash(parts: string[]): string {
    let h = 0x811c9dc5;
    const text = parts.join("\n");
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return (h >>> 0).toString(16).padStart(8, "0");
}
