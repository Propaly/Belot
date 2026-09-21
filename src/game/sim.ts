import type { Call, GameState } from "../types.ts";
import { mulberry32, resetRandom, setRandom } from "./deck.ts";
import {
    canPlayCard,
    chooseBid,
    chooseCard,
    deal,
    legalCalls,
    placeCall,
    playCard,
    resolveTrick,
} from "./engine.ts";
import { findInvariantViolation } from "./invariants.ts";
import { encodeGameLog } from "./notation.ts";
import { summarizeGameLog, type DealLog, type GameLog } from "./replay.ts";

/**
 * Агент, който може да играе на едно място (seat) - дава обява по време
 * на наддаването и избира карта по време на игра. Агентите трябва да
 * връщат само легални действия; симулацията проверява това и го
 * докладва като бъг, ако не е така.
 */
export type Agent = {
    name: string;
    bid(state: GameState, seat: number): Call;
    play(state: GameState, seat: number): string | null;
};

export type AgentFactory = (rng: () => number, seat: number) => Agent;

/** Описание на открит проблем по време на симулация. */
export type SimBug = {
    seed: number;
    gameIndex: number;
    round: number;
    step: number;
    kind: string;
    detail: string;
    state: GameState;
    log: string[];
    /** Пълна история на играта до момента - за възпроизвеждане. */
    replay: GameLog;
};

export type SimOptions = {
    games?: number;
    seed?: number;
    maxStepsPerGame?: number;
    agentFactory?: AgentFactory;
    stopOnBug?: boolean;
    captureReplays?: boolean;
    onBug?: (bug: SimBug) => void;
};

export type SimResult = {
    games: number;
    completed: number;
    wins: [number, number];
    rounds: number;
    bugs: SimBug[];
    replays: GameLog[];
    startedAt: number;
    durationMs: number;
};

type GameOutcome = {
    finished: boolean;
    winner: 0 | 1 | null;
    rounds: number;
    bugs: SimBug[];
    replay: GameLog;
};

/** Ботът по подразбиране, който играе разумно (същият като в локален режим). */
export const heuristicAgentFactory: AgentFactory = () => ({
    name: "heuristic",
    bid: (state, seat) => chooseBid(state, seat),
    play: (state, seat) => chooseCard(state, seat),
});

/**
 * Напълно случаен, но ВИНАГИ легален агент. Полезен за fuzzing - играе
 * неочаквани комбинации, при които често изскачат бъгове.
 */
export const randomAgentFactory: AgentFactory = (rng) => ({
    name: "random",
    bid: (state, seat) => {
        const options = legalCalls(state, seat);
        if (!options.length) return "PASS";
        return options[Math.floor(rng() * options.length)] ?? "PASS";
    },
    play: (state, seat) => {
        const legal = state.players[seat].hand.filter((card) =>
            canPlayCard(state, card)
        );
        if (!legal.length) return null;
        return legal[Math.floor(rng() * legal.length)].id;
    },
});

/** Смесен агент: на моменти играе разумно, на моменти случайно. */
export const mixedAgentFactory: AgentFactory = (rng, seat) => {
    const heuristic = heuristicAgentFactory(rng, seat);
    const random = randomAgentFactory(rng, seat);
    const pick = <T,>(a: T, b: T): T => (rng() < 0.5 ? a : b);

    return {
        name: "mixed",
        bid: (state, s) => pick(heuristic.bid(state, s), random.bid(state, s)),
        play: (state, s) => pick(heuristic.play(state, s), random.play(state, s)),
    };
};

function snapshot(state: GameState): GameState {
    return structuredClone(state) as GameState;
}

function dealFromState(state: GameState): DealLog {
    return {
        round: state.round,
        dealer: state.dealer,
        scoreBefore: [...state.score] as [number, number],
        humanSeat: state.humanSeat,
        hands: state.players.map((p) => p.hand.map((c) => c.id)),
        deck: state.deck.map((c) => c.id),
        bidding: [],
        plays: [],
    };
}

function makeGameLog(
    seed: number,
    humanSeat: number,
    deals: DealLog[],
    finished: boolean,
    winner: 0 | 1 | null,
    score: [number, number],
    rounds: number,
    note?: string
): GameLog {
    const log: GameLog = {
        version: 1,
        seed,
        humanSeat,
        createdAt: new Date().toISOString(),
        note,
        deals: structuredClone(deals),
    };

    if (finished) {
        log.result = { score: [...score] as [number, number], rounds, finished, winner };
    }

    return log;
}

/** Изиграва една пълна игра (до 151 т.) с подадените агенти. */
export function simulateGame(
    seed: number,
    gameIndex: number,
    options: SimOptions = {}
): GameOutcome {
    const maxStepsPerGame = options.maxStepsPerGame ?? 20000;
    const agentFactory = options.agentFactory ?? heuristicAgentFactory;
    const onBug = options.onBug;

    // Детерминирано разбръкване за този seed.
    const rng = mulberry32(seed);
    setRandom(rng);

    const agents = [0, 1, 2, 3].map((seat) => agentFactory(rng, seat));

    let state = deal(0);
    let step = 0;
    let currentDeal: DealLog | null = null;
    const deals: DealLog[] = [];
    const bugs: SimBug[] = [];
    const log: string[] = [];

    const report = (kind: string, detail: string): void => {
        const bug: SimBug = {
            seed,
            gameIndex,
            round: state.round,
            step,
            kind,
            detail,
            state: snapshot(state),
            log: [...log],
            replay: makeGameLog(
                seed,
                0,
                deals,
                state.finished,
                null,
                state.score,
                state.round
            ),
        };
        bugs.push(bug);
        onBug?.(bug);
    };

    const invariant = findInvariantViolation(state);
    if (invariant) report("invariant", invariant);

    while (!state.finished && bugs.length === 0) {
        step += 1;

        if (step > maxStepsPerGame) {
            report("max-steps", `надхвърлени ${maxStepsPerGame} стъпки`);
            break;
        }

        const violation = findInvariantViolation(state);
        if (violation) {
            report("invariant", violation);
            break;
        }

        if (state.phase === "bidding") {
            // Ново раздаване (първото или след 4 паса).
            if (!currentDeal || currentDeal.round !== state.round) {
                currentDeal = dealFromState(state);
                deals.push(currentDeal);
            }

            const seat = state.biddingTurn;
            const call = agents[seat].bid(state, seat);

            if (!legalCalls(state, seat).includes(call)) {
                report(
                    "illegal-agent-bid",
                    `${agents[seat].name} (seat ${seat}) дава нелегална обява ${call}`
                );
                break;
            }

            log.push(`r${state.round} наддаване seat ${seat}: ${call}`);
            currentDeal.bidding.push({ seat, call });
            state = placeCall(state, call, seat);
            continue;
        }

        if (state.phase === "playing") {
            if (currentDeal && !currentDeal.contract) {
                currentDeal.contract = state.contract ?? undefined;
                currentDeal.declarer = state.declarer ?? undefined;
                currentDeal.multiplier = state.multiplier;
            }

            if (state.trickComplete) {
                const dealOver = state.players.every((p) => p.hand.length === 0);
                const before = currentDeal?.scoreBefore;
                state = resolveTrick(state);

                if (dealOver && currentDeal && before) {
                    currentDeal.result = {
                        scoreAfter: [...state.score] as [number, number],
                        roundTotal: [
                            state.score[0] - before[0],
                            state.score[1] - before[1],
                        ],
                    };
                    currentDeal = null;
                }
                continue;
            }

            const seat = state.currentPlayer;
            const cardId = agents[seat].play(state, seat);

            if (!cardId) {
                report(
                    "illegal-agent-play",
                    `${agents[seat].name} (seat ${seat}) не върна карта`
                );
                break;
            }

            const card = state.players[seat].hand.find((c) => c.id === cardId);
            if (!card) {
                report(
                    "illegal-agent-play",
                    `${agents[seat].name} (seat ${seat}) върна непозната карта ${cardId}`
                );
                break;
            }

            if (!canPlayCard(state, card)) {
                report(
                    "illegal-agent-play",
                    `${agents[seat].name} (seat ${seat}) изигра нелегална карта ${cardId}`
                );
                break;
            }

            log.push(`r${state.round} игра seat ${seat}: ${cardId}`);
            currentDeal?.plays.push({ seat, cardId });
            state = playCard(state, cardId, seat);
            continue;
        }

        report("unknown-phase", `неочаквана фаза ${state.phase}`);
        break;
    }

    const finished = state.finished && state.phase === "finished";
    const winner: 0 | 1 | null = finished
        ? state.score[0] >= state.score[1]
            ? 0
            : 1
        : null;

    return {
        finished,
        winner,
        rounds: state.round,
        bugs,
        replay: makeGameLog(
            seed,
            0,
            deals,
            finished,
            winner,
            state.score,
            state.round
        ),
    };
}

/** Пуска много игри и агрегира резултатите. */
export function runSimulation(options: SimOptions = {}): SimResult {
    const games = options.games ?? 100;
    const seed = options.seed ?? 1;
    const startedAt = Date.now();

    let completed = 0;
    let rounds = 0;
    const wins: [number, number] = [0, 0];
    const bugs: SimBug[] = [];
    const replays: GameLog[] = [];

    for (let i = 0; i < games; i++) {
        const gameSeed = (seed + i) >>> 0;
        const outcome = simulateGame(gameSeed, i, options);

        rounds += outcome.rounds;
        bugs.push(...outcome.bugs);

        if (options.captureReplays) replays.push(outcome.replay);

        if (outcome.finished) {
            completed += 1;
            if (outcome.winner !== null) wins[outcome.winner] += 1;
        }

        if (options.stopOnBug && bugs.length) break;
    }

    resetRandom();

    return {
        games,
        completed,
        wins,
        rounds,
        bugs,
        replays,
        startedAt,
        durationMs: Date.now() - startedAt,
    };
}

/** Четим текстов отчет за един бъг - за запис във файл / конзолата. */
export function formatBug(bug: SimBug): string {
    const lines = [
        `=== БЪГ: ${bug.kind} ===`,
        `seed=${bug.seed} game=${bug.gameIndex} round=${bug.round} step=${bug.step}`,
        `детайл: ${bug.detail}`,
        `replay: ${summarizeGameLog(bug.replay)}`,
        "",
        "нотация (за replay/споделяне):",
        encodeGameLog(bug.replay),
        "",
        "последни действия:",
        ...bug.log.slice(-40),
        "",
        "финално състояние:",
        JSON.stringify(
            {
                phase: bug.state.phase,
                round: bug.state.round,
                dealer: bug.state.dealer,
                biddingTurn: bug.state.biddingTurn,
                currentPlayer: bug.state.currentPlayer,
                contract: bug.state.contract,
                declarer: bug.state.declarer,
                multiplier: bug.state.multiplier,
                trick: bug.state.trick,
                tricksCount: bug.state.tricksCount,
                tricksWon: bug.state.tricksWon,
                score: bug.state.score,
                message: bug.state.message,
                hands: bug.state.players.map((p) => ({
                    id: p.id,
                    name: p.name,
                    cards: p.hand.map((c) => c.id),
                })),
                deck: bug.state.deck.map((c) => c.id),
            },
            null,
            2
        ),
        "",
    ];

    return lines.join("\n");
}
