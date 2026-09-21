import type {
    Call,
    Card,
    Contract,
    GameState,
    Player,
    Rank,
    Suit,
} from "../types.ts";
import { getPlayerAnnouncements } from "./engine.ts";

/**
 * ================== Replay / история на игри ==================
 *
 * Един "seed" в тази система е КОНКРЕТНАТА РАЗДАДЕНА РЪКА - т.е. картите,
 * които играчите имат - а не число за RNG. Затова един ReplayLog пази
 * изрично началните 5 карти на всеки играч и останалите 12 в тестето
 * (в реда, в който са били раздадени). Така replay-ът НЕ зависи от
 * реализацията на shuffle и може да се пусне както върху новия, така и
 * върху стария двигател, за да се види дали даден бъг още се случва.
 *
 * Картите се пазят като id-та (напр. "♠-10"), което е компактно и четимо.
 */

export type ReplayAction =
    | { t: "bid"; seat: number; call: Call }
    | { t: "play"; seat: number; cardId: string };

export type DealLog = {
    round: number;
    dealer: number;
    scoreBefore: [number, number];
    humanSeat: number;
    /** Началните 5 карти на всеки от 4-мата играчи (индекси 0..3). */
    hands: string[][];
    /** Останалите 12 карти в тестето, в реда на раздаване. */
    deck: string[];
    /** Наддаване: обяви в реда, в който са направени. */
    bidding: { seat: number; call: Call }[];
    /** Изиграни карти за раздаването, в реда на игра. */
    plays: { seat: number; cardId: string }[];
    /** Попълва се при преминаване към игра - само за четимост. */
    contract?: Contract;
    declarer?: number;
    multiplier?: 1 | 2 | 4;
    result?: ReplayDealResult;
};

export type ReplayDealResult = {
    scoreAfter: [number, number];
    roundTotal: [number, number];
};

export type GameLog = {
    version: 1;
    /** Първоначалният RNG seed (само метаданни - replay-ът не го ползва). */
    seed: number;
    humanSeat: number;
    createdAt: string;
    note?: string;
    deals: DealLog[];
    result?: {
        score: [number, number];
        rounds: number;
        finished: boolean;
        winner: 0 | 1 | null;
    };
};

/** Минималният интерфейс на двигател, нужен за replay на една ръка. */
export type ReplayEngine = {
    placeCall(state: GameState, call: Call, seat?: number): GameState;
    playCard(state: GameState, cardId: string, seat?: number): GameState;
    resolveTrick(state: GameState): GameState;
};

// ---------- Помощни ----------

const SUIT_SET = new Set<string>(["♠", "♥", "♦", "♣"]);

export function cardFromId(id: string): Card {
    const dash = id.indexOf("-");
    const suit = id.slice(0, dash) as Suit;
    const rank = id.slice(dash + 1) as Rank;

    if (!SUIT_SET.has(suit) || !rank) {
        throw new Error(`Невалидно id на карта: "${id}"`);
    }

    return { id, suit, rank };
}

/** FNV-1a 32-bit - стабилен, бърз и независим от платформата. */
function fnv1a(text: string): string {
    let h = 0x811c9dc5;

    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }

    return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Каноничен подпис на едно състояние БЕЗ резултата (score) и съобщението -
 * така сравняваме чисто развитието на играта между два двигателя.
 */
export function stateSignature(state: GameState): string {
    return JSON.stringify({
        phase: state.phase,
        round: state.round,
        dealer: state.dealer,
        biddingTurn: state.biddingTurn,
        passStreak: state.passStreak,
        currentPlayer: state.currentPlayer,
        contract: state.contract,
        declarer: state.declarer,
        multiplier: state.multiplier,
        trickComplete: state.trickComplete,
        trick: state.trick.map((t) => `${t.playerId}:${t.card.id}`),
        tricksWon: state.tricksWon,
        tricksCount: state.tricksCount,
        lastTrickWinnerTeam: state.lastTrickWinnerTeam,
        highestBid: state.highestBid,
        bidHistory: state.bidHistory.map((e) => `${e.playerId}:${e.call}`),
        hands: state.players.map((p) => p.hand.map((c) => c.id).join("|")),
        deck: state.deck.map((c) => c.id),
    });
}

function hashSignatures(hashes: string[]): string {
    return fnv1a(hashes.join("\n"));
}

/**
 * Сглобява началното ("bidding") състояние директно от запазената ръка,
 * без да пипа shuffle-а. Точно съвпада по форма с това на startRound,
 * затова finalizeBidding после раздава останалите 3 карти правилно.
 */
export function buildBiddingState(deal: DealLog): GameState {
    if (deal.hands.length !== 4 || deal.hands.some((h) => h.length !== 5)) {
        throw new Error(`Раздаване ${deal.round}: очаквани 4 ръце по 5 карти`);
    }
    if (deal.deck.length !== 12) {
        throw new Error(`Раздаване ${deal.round}: очаквани 12 карти в тестето`);
    }

    const players: Player[] = deal.hands.map((hand, id) => ({
        id,
        name: `Играч ${id + 1}`,
        team: (id % 2) as 0 | 1,
        hand: hand.map(cardFromId),
    }));

    const biddingTurn = (deal.dealer + 3) % 4;

    return {
        players,
        deck: deal.deck.map(cardFromId),
        phase: "bidding",
        humanSeat: deal.humanSeat,
        dealer: deal.dealer,
        biddingTurn,
        bidHistory: [],
        highestBid: null,
        passStreak: 0,
        contract: null,
        declarer: null,
        initialHands: [],
        multiplier: 1,
        currentPlayer: biddingTurn,
        trick: [],
        trickComplete: false,
        tricksWon: [0, 0],
        tricksCount: [0, 0],
        lastTrickWinnerTeam: null,
        score: [...deal.scoreBefore] as [number, number],
        round: deal.round,
        message: "",
        finished: false,
    };
}

export type DealOutcome = {
    ok: boolean;
    noContract: boolean;
    error?: string;
    scoreBefore: [number, number];
    scoreAfter: [number, number];
    roundTotal: [number, number];
    /** Данни за преглед: договор, анонси (терца/кварта/квинта, каре) и точки. */
    review: DealReview;
    /** Хеш на развитието на играта (без точки) - за сравнение старо/ново. */
    checksum: string;
    steps: number;
};

export type DealReview = {
    contract: Contract | null;
    declarer: number | null;
    multiplier: 1 | 2 | 4;
    /** Етикети на анонсите на всеки играч (напр. "Терца", "Квинта", "Каре"). */
    announcements: string[][];
    /** Точки от взятки (сурови, преди закръгляне) по отбори. */
    tricksWon: [number, number];
    tricksCount: [number, number];
};

const emptyReview: DealReview = {
    contract: null,
    declarer: null,
    multiplier: 1,
    announcements: [[], [], [], []],
    tricksWon: [0, 0],
    tricksCount: [0, 0],
};

const zero: [number, number] = [0, 0];

/** Изиграва една запазена ръка върху подадения двигател. */
export function replayDeal(deal: DealLog, engine: ReplayEngine): DealOutcome {
    let state = buildBiddingState(deal);
    const hashes: string[] = [stateSignature(state)];

    const fail = (error: string): DealOutcome => ({
        ok: false,
        noContract: false,
        error,
        scoreBefore: deal.scoreBefore,
        scoreAfter: [...state.score] as [number, number],
        roundTotal: [...zero] as [number, number],
        review: emptyReview,
        checksum: hashSignatures(hashes),
        steps: hashes.length,
    });

    for (const b of deal.bidding) {
        // Предпазване от 4 паса: при тях двигателят създава нова случайна
        // ръка, което би развалило детерминизма. Спираме преди това.
        if (!state.highestBid && state.passStreak === 3 && b.call === "PASS") {
            return {
                ok: true,
                noContract: true,
                scoreBefore: deal.scoreBefore,
                scoreAfter: [...state.score] as [number, number],
                roundTotal: [...zero] as [number, number],
                review: emptyReview,
                checksum: hashSignatures(hashes),
                steps: hashes.length,
            };
        }

        const next = engine.placeCall(state, b.call, b.seat);
        if (next === state) {
            return fail(`неуспешна обява: седалка ${b.seat}, ${b.call}`);
        }
        state = next;
        hashes.push(stateSignature(state));
    }

    if (state.phase !== "playing") {
        return fail("наддаването не доведе до договор");
    }

    for (const play of deal.plays) {
        if (state.trickComplete) {
            state = engine.resolveTrick(state);
            hashes.push(stateSignature(state));
        }

        if (state.phase !== "playing") {
            return fail("играта приключи преди изиграването на всички карти");
        }

        const next = engine.playCard(state, play.cardId, play.seat);
        if (next === state) {
            return fail(`нелегален ход: седалка ${play.seat}, ${play.cardId}`);
        }
        state = next;
        hashes.push(stateSignature(state));
    }

    // Данните за преглед (анонси/точки) се взимат преди последния resolve,
    // защото след него състоянието вече е ново (случайно) раздаване.
    const review: DealReview = {
        contract: state.contract,
        declarer: state.declarer,
        multiplier: state.multiplier,
        announcements: state.players.map((_, i) => getPlayerAnnouncements(state, i)),
        tricksWon: [...state.tricksWon] as [number, number],
        tricksCount: [...state.tricksCount] as [number, number],
    };

    if (state.trickComplete) {
        // НЕ хешираме състоянието след последния resolve - то вече е нова
        // (случайна) ръка; точките обаче са това, което ни трябва.
        state = engine.resolveTrick(state);
    }

    const scoreAfter = [...state.score] as [number, number];

    return {
        ok: true,
        noContract: false,
        scoreBefore: deal.scoreBefore,
        scoreAfter,
        roundTotal: [
            scoreAfter[0] - deal.scoreBefore[0],
            scoreAfter[1] - deal.scoreBefore[1],
        ],
        review,
        checksum: hashSignatures(hashes),
        steps: hashes.length,
    };
}

export type GameOutcome = {
    ok: boolean;
    error?: string;
    deals: DealOutcome[];
    score: [number, number];
    checksum: string;
};

/** Изиграва цяла запазена игра, ръка по ръка. */
export function replayGame(log: GameLog, engine: ReplayEngine): GameOutcome {
    const deals: DealOutcome[] = [];
    let score: [number, number] = [0, 0];
    let ok = true;
    let error: string | undefined;

    for (const deal of log.deals) {
        const outcome = replayDeal(deal, engine);
        deals.push(outcome);

        if (!outcome.ok) {
            ok = false;
            error = outcome.error;
            break;
        }

        score = outcome.scoreAfter;
    }

    return {
        ok,
        error,
        deals,
        score,
        checksum: hashSignatures(deals.map((d) => d.checksum)),
    };
}

/** Четим JSON за запис във файл (fixtures/history). */
export function formatGameLog(log: GameLog): string {
    return JSON.stringify(log, null, 2);
}

/** Кратко резюме за конзолата. */
export function summarizeGameLog(log: GameLog): string {
    const deals = log.deals.length;
    const plays = log.deals.reduce((s, d) => s + d.plays.length, 0);
    const hand = log.deals[0]?.hands[0]?.join(" ") ?? "—";
    return `${deals} раздавания, ${plays} хода, seed=${log.seed}, първа ръка: ${hand}`;
}

export type ReplayStep = {
    state: GameState;
    label: string;
    dealIndex: number;
};

/**
 * Разгъва цялата игра в списък от състояния (по едно след всяко действие) -
 * за UI replay viewer със стъпване напред/назад.
 */
export function replayStates(log: GameLog, engine: ReplayEngine): ReplayStep[] {
    const steps: ReplayStep[] = [];
    const push = (state: GameState, label: string, dealIndex: number) => {
        steps.push({ state: structuredClone(state), label, dealIndex });
    };

    for (let d = 0; d < log.deals.length; d++) {
        const deal = log.deals[d];
        let state = buildBiddingState(deal);
        push(state, `Раздаване ${deal.round} — начало`, d);

        for (const b of deal.bidding) {
            if (!state.highestBid && state.passStreak === 3 && b.call === "PASS") break;
            state = engine.placeCall(state, b.call, b.seat);
            push(state, `Обява: играч ${b.seat + 1} — ${b.call}`, d);
        }

        if (state.phase !== "playing") continue;

        for (const p of deal.plays) {
            if (state.trickComplete) {
                state = engine.resolveTrick(state);
                push(state, "Край на взятка", d);
            }
            state = engine.playCard(state, p.cardId, p.seat);
            push(state, `Ход: играч ${p.seat + 1} — ${p.cardId}`, d);
        }

        push(
            state,
            deal.result
                ? `Край на раздаване (${deal.result.roundTotal[0]}:${deal.result.roundTotal[1]})`
                : "Край на раздаване",
            d
        );
    }

    return steps;
}

