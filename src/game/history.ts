import type { Call, GameState } from "../types.ts";
import type { DealLog, GameLog } from "./replay.ts";

/**
 * Записва жива игра (от сървъра) във формат GameLog, който после може да се
 * сериализира в нотация, да се запише в SQLite и да се replay-не.
 *
 * Употреба от сървъра:
 *   recorder.observe(state)      // преди всяко действие и след промяна
 *   recorder.bid(seat, call)     // при обява
 *   recorder.play(seat, cardId)  // при изиграна карта
 *   recorder.endDeal(state)      // след resolveTrick, ако раздаването свърши
 */
export class GameRecorder {
    private deals: DealLog[] = [];
    private current: DealLog | null = null;
    private seed: number;
    private humanSeat: number;

    constructor(seed: number, humanSeat = 0) {
        this.seed = seed;
        this.humanSeat = humanSeat;
    }

    /** Синхронизира записа с текущото състояние (начало на ново раздаване/договор). */
    observe(state: GameState): void {
        if (state.phase === "bidding") {
            if (!this.current || this.current.round !== state.round) {
                this.current = {
                    round: state.round,
                    dealer: state.dealer,
                    scoreBefore: [...state.score] as [number, number],
                    humanSeat: this.humanSeat,
                    hands: state.players.map((p) => p.hand.map((c) => c.id)),
                    deck: state.deck.map((c) => c.id),
                    bidding: [],
                    plays: [],
                };
                this.deals.push(this.current);
            }
            return;
        }

        if (state.phase === "playing" && this.current && !this.current.contract) {
            this.current.contract = state.contract ?? undefined;
            this.current.declarer = state.declarer ?? undefined;
            this.current.multiplier = state.multiplier;
        }
    }

    bid(seat: number, call: Call): void {
        this.current?.bidding.push({ seat, call });
    }

    play(seat: number, cardId: string): void {
        this.current?.plays.push({ seat, cardId });
    }

    /** Раздаването е приключило - записва резултата и затваря текущото. */
    endDeal(state: GameState): void {
        if (!this.current) return;
        const before = this.current.scoreBefore;
        this.current.result = {
            scoreAfter: [...state.score] as [number, number],
            roundTotal: [
                state.score[0] - before[0],
                state.score[1] - before[1],
            ],
        };
        this.current = null;
    }

    reset(): void {
        this.deals = [];
        this.current = null;
    }

    log(note?: string): GameLog {
        return {
            version: 1,
            seed: this.seed,
            humanSeat: this.humanSeat,
            createdAt: new Date().toISOString(),
            note,
            deals: structuredClone(this.deals),
        };
    }

    get dealCount(): number {
        return this.deals.length;
    }
}
