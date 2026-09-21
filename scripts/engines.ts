import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import * as newEngine from "../src/game/engine.ts";
import type { Call, Card, GameState } from "../src/types.ts";
import type { ReplayEngine } from "../src/game/replay.ts";
import type { EngineApi } from "../src/game/playout.ts";

/**
 * Адаптер към ТЕКУЩИЯ двигател, който replay системата разбира.
 * Replay-ът работи върху изрично запазени ръце, затова не му трябва RNG.
 */
export function currentReplayEngine(): ReplayEngine {
    return {
        placeCall: (state, call, seat) => newEngine.placeCall(state, call, seat),
        playCard: (state, cardId, seat) => newEngine.playCard(state, cardId, seat),
        resolveTrick: (state) => newEngine.resolveTrick(state),
    };
}

/** Пълният API на текущия двигател - за playout на произволни позиции. */
export function currentEngineApi(): EngineApi {
    return {
        ...currentReplayEngine(),
        chooseBid: (state, seat) => newEngine.chooseBid(state, seat),
        chooseCard: (state, seat) => newEngine.chooseCard(state, seat),
        legalCalls: (state, seat) => newEngine.legalCalls(state, seat),
        canPlayCard: (state, card) => newEngine.canPlayCard(state, card),
    };
}

/**
 * Изтегля стария (commit-нат) вариант на двигателя от git в .legacy/ и го
 * зарежда. Така може да се пусне същата запазена игра върху "предишния"
 * код и да се види дали даден бъг още се случва.
 */
export async function loadLegacyModule(base = "HEAD"): Promise<any> {
    const root = resolve(".legacy/src");
    mkdirSync(resolve(root, "game"), { recursive: true });

    for (const file of ["types.ts", "game/engine.ts", "game/deck.ts"]) {
        const content = execFileSync("git", ["show", `${base}:src/${file}`], {
            encoding: "utf8",
        });
        writeFileSync(resolve(root, file), content, "utf8");
    }

    return import(pathToFileURL(resolve(".legacy/src/game/engine.ts")).href);
}

export function legacyReplayEngine(mod: any): ReplayEngine {
    return {
        placeCall: (state, call, seat) => mod.placeCall(state, call, seat),
        playCard: (state, cardId, seat) => mod.playCard(state, cardId, seat),
        resolveTrick: (state) => mod.resolveTrick(state),
    };
}

/**
 * Пълният API на стария двигател. Той няма чисти chooseBid/chooseCard/
 * legalCalls, затова ги извличаме от botBid/botMove/placeCall. При
 * probe-ването слагаме humanSeat = -1, за да играе ботът на всяка седалка.
 */
export function legacyEngineApi(mod: any): EngineApi {
    const didProgress = (a: GameState, b: GameState): boolean =>
        a.biddingTurn !== b.biddingTurn ||
        a.bidHistory.length !== b.bidHistory.length ||
        a.multiplier !== b.multiplier ||
        a.passStreak !== b.passStreak ||
        a.round !== b.round ||
        a.highestBid?.contract !== b.highestBid?.contract ||
        a.highestBid?.playerId !== b.highestBid?.playerId;

    // Същият ред като CALL_OPTIONS в двигателя - за да избират случайните
    // агенти една и съща опция при еднакъв seed (иначе сравнението е безсмислено).
    const candidates: Call[] = [
        "♣",
        "♦",
        "♥",
        "♠",
        "NO_TRUMP",
        "ALL_TRUMP",
        "CONTRA",
        "RECONTRA",
        "PASS",
    ];

    return {
        ...legacyReplayEngine(mod),
        canPlayCard: (state: GameState, card: Card) => mod.canPlayCard(state, card),
        legalCalls: (state: GameState, seat: number) =>
            candidates.filter((call) =>
                didProgress(
                    state,
                    mod.placeCall({ ...state, biddingTurn: seat }, call, seat)
                )
            ),
        chooseBid: (state: GameState, seat: number): Call => {
            const probe = { ...state, biddingTurn: seat, humanSeat: -1 };
            const next = mod.botBid(probe);
            const history = next.bidHistory;
            if (history.length > probe.bidHistory.length) {
                return history[history.length - 1].call;
            }
            return "PASS";
        },
        chooseCard: (state: GameState, seat: number): string | null => {
            const probe = { ...state, currentPlayer: seat, humanSeat: -1 };
            const next = mod.botMove(probe);
            const before = state.players[seat].hand;
            const after = next.players[seat].hand;
            const played = before.find(
                (c) => !after.some((a: { id: string }) => a.id === c.id)
            );
            return played ? played.id : null;
        },
    };
}
