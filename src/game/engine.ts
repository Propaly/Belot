import type {
    Call,
    Card,
    Contract,
    GameState,
    HighestBid,
    Player,
    Rank,
    Suit,
    TrickCard,
} from "../types.ts";

import { SUITS, createDeck, shuffle } from "./deck.ts";

const CARD_POINTS: Record<string, number> = {
    A: 11,
    10: 10,
    K: 4,
    Q: 3,
    J: 2,
    9: 0,
    8: 0,
    7: 0,
};

const TRUMP_POINTS: Record<string, number> = {
    J: 20,
    9: 14,
    A: 11,
    10: 10,
    K: 4,
    Q: 3,
    8: 0,
    7: 0,
};

const NORMAL_ORDER: Record<string, number> = {
    7: 1,
    8: 2,
    9: 3,
    J: 4,
    Q: 5,
    K: 6,
    10: 7,
    A: 8,
};

const TRUMP_ORDER: Record<string, number> = {
    7: 1,
    8: 2,
    Q: 3,
    K: 4,
    10: 5,
    A: 6,
    9: 7,
    J: 8,
};

const CALL_OPTIONS: Call[] = [
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

const CONTRACT_RANK: Record<Contract, number> = {
    "♣": 1,
    "♦": 2,
    "♥": 3,
    "♠": 4,
    "NO_TRUMP": 5,
    "ALL_TRUMP": 6,
};

export function contractLabel(call: Call): string {
    if (call === "PASS") return "Пас";
    if (call === "CONTRA") return "Контра";
    if (call === "RECONTRA") return "Реконтра";
    if (call === "ALL_TRUMP") return "Всичко коз";
    if (call === "NO_TRUMP") return "Без коз";
    return call;
}

/**
 * Следващият играч по посока на играта. Белот се играе ОБРАТНО на
 * часовниковата стрелка - при подредбата на местата в тази игра
 * (Ти -> Бот 1 -> Партньор -> Бот 2, по часовниковата стрелка),
 * това означава движение назад в списъка с играчи (id - 1).
 */
export function nextPlayer(playerId: number): number {
    return (playerId + 3) % 4;
}

/**
 * Създава играчите за локален режим (срещу ботове). `humanSeat` е
 * мястото, което истинският играч избра да заема (0-3) - това
 * реализира избора на отбор: отбор 0 = места 0 и 2, отбор 1 = места
 * 1 и 3. Партньорът на истинския играч винаги е mясто (humanSeat+2)%4.
 */
export function createPlayers(humanSeat = 0): Player[] {
    const partnerSeat = (humanSeat + 2) % 4;
    let botCount = 0;
    const teamOf = (id: number): 0 | 1 => (id % 2 === 0 ? 0 : 1);

    return [0, 1, 2, 3].map((id) => {
        if (id === humanSeat) {
            return { id, name: "Ти", team: teamOf(id), hand: [] };
        }
        if (id === partnerSeat) {
            return { id, name: "Партньор", team: teamOf(id), hand: [] };
        }
        botCount += 1;
        return { id, name: `Бот ${botCount}`, team: teamOf(id), hand: [] };
    });
}

/**
 * Започва ново раздаване: разбърква тестето и дава по 5 карти
 * на играч. Наддаването тръгва от играча вляво от раздаващия.
 * Останалите 3 карти на играч се раздават след приключване на
 * наддаването (виж finalizeBidding).
 */
export function startRound(
    dealer: number,
    score: [number, number],
    round: number,
    humanSeat = 0
): GameState {
    const deck = shuffle(createDeck());
    const players = createPlayers(humanSeat);

    const order: number[] = [];
    let cursor = dealer;
    for (let i = 0; i < 4; i++) {
        cursor = nextPlayer(cursor);
        order.push(cursor);
    }

    for (const playerId of order) {
        for (let i = 0; i < 5; i++) {
            players[playerId].hand.push(deck.shift() as Card);
        }
    }

    const biddingTurn = nextPlayer(dealer);

    return {
        players,
        deck,
        phase: "bidding",
        humanSeat,
        dealer,
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
        score,
        round,
        message: `${players[biddingTurn].name} наддава пръв.`,
        finished: false,
    };
}

export function deal(humanSeat = 0): GameState {
    return startRound(0, [0, 0], 1, humanSeat);
}

function finalizeBidding(state: GameState): GameState {
    const highestBid = state.highestBid as HighestBid;

    const players = state.players.map((p) => ({
        ...p,
        hand: [...p.hand],
    }));

    const deck = [...state.deck];
    const order: number[] = [];
    let cursor = state.dealer;
    for (let i = 0; i < 4; i++) {
        cursor = nextPlayer(cursor);
        order.push(cursor);
    }

    for (const playerId of order) {
        for (let i = 0; i < 3; i++) {
            players[playerId].hand.push(deck.shift() as Card);
        }
    }

    const openingLeader = nextPlayer(state.dealer);

    const initialHands = players.map((p) => [...p.hand]);

    return {
        ...state,
        players,
        deck,
        phase: "playing",
        contract: highestBid.contract,
        declarer: highestBid.playerId,
        initialHands,
        currentPlayer: openingLeader,
        trick: [],
        trickComplete: false,
        tricksWon: [0, 0],
        tricksCount: [0, 0],
        lastTrickWinnerTeam: null,
        message: `${players[highestBid.playerId].name} обяви ${contractLabel(
            highestBid.contract
        )}. Ход на ${players[openingLeader].name}.`,
    };
}

export function placeCall(state: GameState, call: Call, actingPlayerId?: number): GameState {
    if (state.phase !== "bidding") return state;

    const playerId = actingPlayerId ?? state.biddingTurn;
    if (playerId !== state.biddingTurn) return state;

    const player = state.players[playerId];

    // КОНТРА: позволена само ако в момента има обява в сила,
    // направена от ПРОТИВНИКА, и все още няма обявена контра
    // (multiplier===1). Не е отделна "опашка" - просто обикновена
    // обява на реда на играча. След нея останалите играчи по ред
    // (вкл. декларантът) СИ МОГАТ да наддадат по-силна обява вместо
    // контра/пас - точно както е по правилата.
    if (call === "CONTRA") {
        if (
            !state.highestBid ||
            state.multiplier !== 1 ||
            state.players[state.highestBid.playerId].team === player.team
        ) {
            return {
                ...state,
                message: "Контра не е възможна в момента.",
            };
        }

        const bidHistory = [...state.bidHistory, { playerId, call }];

        return {
            ...state,
            bidHistory,
            multiplier: 2,
            passStreak: 0,
            biddingTurn: nextPlayer(playerId),
            message: `${player.name} обявява контра (×2)!`,
        };
    }

    // РЕКОНТРА: позволена само на отбора, чиято обява е била
    // контрирана (multiplier===2), докато все още не е обявена
    // реконтра. Реконтрата приключва наддаването веднага.
    if (call === "RECONTRA") {
        if (
            !state.highestBid ||
            state.multiplier !== 2 ||
            state.players[state.highestBid.playerId].team !== player.team
        ) {
            return {
                ...state,
                message: "Реконтра не е възможна в момента.",
            };
        }

        const bidHistory = [...state.bidHistory, { playerId, call }];

        return finalizeBidding({
            ...state,
            bidHistory,
            multiplier: 4,
            message: `${player.name} обявява реконтра (×4)! Резултатът се умножава по 4.`,
        });
    }

    // Обикновена обява трябва да е по-висока от текущата. Разрешена
    // е по всяко време на реда на играча - дори след контра, точно
    // както е по правилата ("останалите играчи могат да направят
    // друга значеща обява, по-силна от контрираната"). Нова обява
    // анулира текущата контра (multiplier се връща на 1).
    if (
        call !== "PASS" &&
        state.highestBid &&
        !(
            call === "NO_TRUMP" &&
            state.highestBid.contract === "NO_TRUMP"
        ) &&
        CONTRACT_RANK[call as Contract] <=
        CONTRACT_RANK[state.highestBid.contract]
    ) {
        return {
            ...state,
            message: `${contractLabel(call)} е по-ниско или равно на текущата обява.`,
        };
    }

    const bidHistory = [
        ...state.bidHistory,
        { playerId, call },
    ];

    let highestBid = state.highestBid;
    let passStreak = state.passStreak;
    let multiplier = state.multiplier;

    if (call === "PASS") {
        passStreak += 1;
    } else {
        highestBid = { contract: call, playerId };
        passStreak = 0;
        multiplier = 1; // нова обява анулира текуща контра
    }

    // Всички четирима са пасували: ново раздаване отначало.
    // Раздаващият се мести обратно на часовниковата стрелка.
    if (!highestBid && passStreak === 4) {
        const nextDealer = nextPlayer(state.dealer);
        const next = startRound(
            nextDealer,
            state.score,
            state.round + 1,
            state.humanSeat
        );
        return {
            ...next,
            message: "4 паса. Ново раздаване.",
        };
    }

    const next: GameState = {
        ...state,
        bidHistory,
        highestBid,
        passStreak,
        multiplier,
        biddingTurn: nextPlayer(playerId),
        message:
            call === "PASS"
                ? `${player.name}: пас.`
                : `${player.name} обявява ${contractLabel(call)}.`,
    };

    // Наддаването приключва, когато всички играчи СЛЕД този, направил
    // последната значеща обява (обикновена, контра или реконтра),
    // подред пасуват - т.е. 3 последователни паса след обява в сила.
    if (highestBid && passStreak === 3) {
        return finalizeBidding(next);
    }

    return next;
}

function contractScore(hand: Card[], call: Call): number {
    if (call === "PASS") return -1;

    if (call === "NO_TRUMP") {
        return hand.reduce(
            (sum, c) => sum + CARD_POINTS[c.rank],
            0
        );
    }

    if (call === "ALL_TRUMP") {
        return hand.reduce(
            (sum, c) => sum + TRUMP_POINTS[c.rank] * 0.6,
            0
        );
    }

    const suitCards = hand.filter((c) => c.suit === call);
    let score = suitCards.reduce(
        (sum, c) => sum + TRUMP_POINTS[c.rank],
        0
    );

    if (suitCards.length >= 4) score += 8;
    if (suitCards.length >= 5) score += 6;

    return score;
}

export function botBid(state: GameState): GameState {
    if (state.phase !== "bidding") return state;

    const playerId = state.biddingTurn;

    if (playerId === state.humanSeat) return state;

    const player = state.players[playerId];
    const hand = player.hand;

    // Реконтра: отборът на текущата обява може да реконтрира,
    // ако смята, че пак ще изкара повече от 25 точки в ръката.
    if (
        state.highestBid &&
        state.multiplier === 2 &&
        state.players[state.highestBid.playerId].team === player.team
    ) {
        const ownScore = contractScore(hand, state.highestBid.contract);
        if (ownScore >= 25) {
            return placeCall(state, "RECONTRA");
        }
    }

    // Контра: противникът на текущата обява може да контрира,
    // ако смята, че декларантът няма да я покрие (собствена му
    // сила в тази обява е ниска).
    if (
        state.highestBid &&
        state.multiplier === 1 &&
        state.players[state.highestBid.playerId].team !== player.team
    ) {
        const opponentContractScore = contractScore(hand, state.highestBid.contract);
        if (opponentContractScore >= 25) {
            return placeCall(state, "CONTRA");
        }
    }

    let best: Call = "PASS";
    let bestScore = -1;

    for (const option of CALL_OPTIONS) {
        if (
            option === "PASS" ||
            option === "CONTRA" ||
            option === "RECONTRA"
        ) {
            continue;
        }

        // прескачаме обяви, които не са по-високи от текущата -
        // те биха били невалидни и биха блокирали наддаването
        if (
            state.highestBid &&
            !(
                option === "NO_TRUMP" &&
                state.highestBid.contract === "NO_TRUMP"
            ) &&
            CONTRACT_RANK[option as Contract] <= CONTRACT_RANK[state.highestBid.contract]
        ) {
            continue;
        }

        const score = contractScore(hand, option);

        if (score > bestScore) {
            bestScore = score;
            best = option;
        }
    }

    const PASS_THRESHOLD = 17;

    const alreadyThisContract = state.highestBid?.contract === best;

    const call: Call =
        bestScore >= PASS_THRESHOLD && !alreadyThisContract
            ? best
            : "PASS";

    return placeCall(state, call);
}

export function cardPoints(card: Card, contract: Contract): number {
    const trump = contract === "ALL_TRUMP" || contract === card.suit;

    if (trump) {
        return TRUMP_POINTS[card.rank];
    }

    return CARD_POINTS[card.rank];
}

function isTrump(card: Card, contract: Contract): boolean {
    return contract === "ALL_TRUMP" || card.suit === contract;
}

function cardStrength(card: Card, contract: Contract): number {
    const trump = isTrump(card, contract);

    if (trump) {
        return TRUMP_ORDER[card.rank];
    }

    return NORMAL_ORDER[card.rank];
}

// Ред на показване на цветовете в ръката: спатия -> каро -> пика -> купа
// (черно, червено, черно, червено - за по-лесна визуална различимост).
const SUIT_DISPLAY_ORDER: Record<Suit, number> = {
    "♣": 0,
    "♦": 1,
    "♠": 2,
    "♥": 3,
};

/**
 * Подрежда карти за визуализация: първо по цвят (спатия, каро, пика,
 * купа), а вътре във всеки цвят - по сила, от най-силна към най-слаба,
 * съобразена с текущия договор (напр. при "Всичко коз" всеки цвят се
 * подрежда по козовия ред J,9,A,10,K,Q,8,7). Ако договорът все още не
 * е определен (по време на наддаването), се използва обикновеният ред
 * A,10,K,Q,J,9,8,7.
 */
export function sortHand(hand: Card[], contract: Contract | null): Card[] {
    return [...hand].sort((a, b) => {
        const suitDiff =
            SUIT_DISPLAY_ORDER[a.suit] - SUIT_DISPLAY_ORDER[b.suit];

        if (suitDiff !== 0) return suitDiff;

        const strengthA = contract
            ? cardStrength(a, contract)
            : NORMAL_ORDER[a.rank];
        const strengthB = contract
            ? cardStrength(b, contract)
            : NORMAL_ORDER[b.rank];

        return strengthB - strengthA;
    });
}

function trickWinner(trick: TrickCard[], contract: Contract): TrickCard {
    const leadingSuit = trick[0].card.suit;

    let winner = trick[0];

    for (const current of trick.slice(1)) {
        const currentTrump = isTrump(current.card, contract);
        const winnerTrump = isTrump(winner.card, contract);

        if (currentTrump && !winnerTrump) {
            winner = current;
            continue;
        }

        if (!currentTrump && winnerTrump) {
            continue;
        }

        if (
            current.card.suit !== leadingSuit &&
            winner.card.suit === leadingSuit
        ) {
            continue;
        }

        if (
            current.card.suit === leadingSuit &&
            winner.card.suit !== leadingSuit
        ) {
            winner = current;
            continue;
        }

        if (
            cardStrength(current.card, contract) >
            cardStrength(winner.card, contract)
        ) {
            winner = current;
        }
    }

    return winner;
}

/**
 * Проверява дали дадена карта е разрешена за игра според:
 * - задължително отговаряне на исканата боя;
 * - задължително качване, ако исканата боя е коз (само при игра с конкретен коз);
 * - задължително цакане/надцакване, ако играчът няма исканата боя
 *   и взятката до момента е на противника (при единичен коз).
 */
export function canPlayCard(state: GameState, card: Card): boolean {
    if (!state.contract) return true;

    const player = state.players[state.currentPlayer];
    const contract = state.contract;

    if (state.trick.length === 0) return true;

    const leadingSuit = state.trick[0].card.suit;
    const inLeadingSuit = player.hand.filter(
        (c) => c.suit === leadingSuit
    );
    const hasLeadingSuit = inLeadingSuit.length > 0;

    const leadIsTrump = isTrump(
        { id: "", suit: leadingSuit, rank: "7" },
        contract
    );

    if (hasLeadingSuit) {
        if (card.suit !== leadingSuit) return false;

        // При "Без коз" няма задължително качване. Ако например е
        // изигран K от исканата боя, играчът може да даде всяка по-ниска
        // карта от същата боя, стига да я има. При "Всичко коз" и при
        // конкретен коз качването остава задължително.
        if (leadIsTrump && contract !== "NO_TRUMP") {
            const bestSoFar = Math.max(
                ...state.trick
                    .filter((t) => t.card.suit === leadingSuit)
                    .map((t) => cardStrength(t.card, contract))
            );

            const canBeat = inLeadingSuit.some(
                (c) => cardStrength(c, contract) > bestSoFar
            );

            if (canBeat) {
                return cardStrength(card, contract) > bestSoFar;
            }
        }

        return true;
    }

    // Играчът няма исканата боя.
    if (contract === "NO_TRUMP" || contract === "ALL_TRUMP") {
        return true;
    }

    const trumpSuit = contract;
    const trumpCards = player.hand.filter((c) => c.suit === trumpSuit);

    if (trumpCards.length === 0) return true;

    const winnerSoFar = trickWinner(state.trick, contract);
    const winnerIsOpponent =
        state.players[winnerSoFar.playerId].team !== player.team;

    if (!winnerIsOpponent) return true;

    const trumpsInTrick = state.trick.filter(
        (t) => t.card.suit === trumpSuit
    );

    if (trumpsInTrick.length > 0) {
        const bestTrump = Math.max(
            ...trumpsInTrick.map((t) => cardStrength(t.card, contract))
        );

        const canOvertrump = trumpCards.some(
            (c) => cardStrength(c, contract) > bestTrump
        );

        if (canOvertrump) {
            return (
                card.suit === trumpSuit &&
                cardStrength(card, contract) > bestTrump
            );
        }

        return card.suit === trumpSuit;
    }

    return card.suit === trumpSuit;
}

function scoreTrick(trick: TrickCard[], contract: Contract): number {
    return trick.reduce(
        (sum, played) => sum + cardPoints(played.card, contract),
        0
    );
}

/**
 * Разделя точките от раздаването на 10, със закръгляне до цяло число.
 * Изключение при "Всичко коз": ако точките на отбор завършват на "4"
 * (остатък 4 при деление на 10), закръгля се НАГОРЕ вместо надолу, но
 * само за отбора с по-малкото точки от двата (правило на belot.bg).
 */
function roundRoundPoints(
    points: [number, number],
    contract: Contract
): [number, number] {
    const lowerTeam: 0 | 1 = points[0] <= points[1] ? 0 : 1;

    return points.map((value, team) => {
        const remainder = ((value % 10) + 10) % 10;

        if (contract === "ALL_TRUMP" && remainder === 4 && team === lowerTeam) {
            return Math.ceil(value / 10);
        }

        return Math.round(value / 10);
    }) as [number, number];
}

function computeBelotBonus(
    initialHands: Card[][],
    players: Player[],
    contract: Contract
): [number, number] {
    const bonus: [number, number] = [0, 0];

    const suitsToCheck: Suit[] =
        contract === "ALL_TRUMP"
            ? SUITS
            : contract === "NO_TRUMP"
                ? []
                : [contract];

    suitsToCheck.forEach((suit) => {
        initialHands.forEach((hand, playerId) => {
            const hasK = hand.some(
                (c) => c.suit === suit && c.rank === "K"
            );
            const hasQ = hand.some(
                (c) => c.suit === suit && c.rank === "Q"
            );

            if (hasK && hasQ) {
                bonus[players[playerId].team] += 2;
            }
        });
    });

    return bonus;
}

// Ред на картите при анонси (независимо от коз): 7;8;9;10;J;Q;K;A.
const ANNOUNCE_RANK_ORDER: Record<string, number> = {
    7: 1,
    8: 2,
    9: 3,
    10: 4,
    J: 5,
    Q: 6,
    K: 7,
    A: 8,
};

// Точки за каре според ранга (само тези рангове носят премия).
const KARE_VALUES: Record<string, number> = {
    "10": 100,
    J: 200,
    Q: 100,
    K: 100,
    A: 100,
    9: 150,
};

type SequenceAnnounce = {
    playerId: number;
    team: 0 | 1;
    suit: Suit;
    length: number;
    highOrder: number;
    value: number;
};

type KareAnnounce = {
    playerId: number;
    team: 0 | 1;
    rank: Rank;
    value: number;
};

function sequenceValue(length: number): number {
    if (length >= 5) return 100;
    if (length === 4) return 50;
    return 20; // length === 3
}

/**
 * Намира всички поредици (терца/кварта/квинта, дължина >= 3) в дадена
 * ръка, по цветове. В рамките на един цвят се вземат само МАКСИМАЛНИТЕ
 * поредици (напр. 7-8-9-10 се брои като една кварта, не и вложена терца).
 */
function findSequences(
    hand: Card[],
    playerId: number,
    team: 0 | 1
): SequenceAnnounce[] {
    const result: SequenceAnnounce[] = [];

    SUITS.forEach((suit) => {
        const orders = hand
            .filter((c) => c.suit === suit)
            .map((c) => ANNOUNCE_RANK_ORDER[c.rank])
            .sort((a, b) => a - b);

        let runStart = 0;

        for (let i = 1; i <= orders.length; i++) {
            const brokeRun =
                i === orders.length || orders[i] !== orders[i - 1] + 1;

            if (brokeRun) {
                const runLength = i - runStart;

                if (runLength >= 3) {
                    const highOrder = orders[i - 1];

                    result.push({
                        playerId,
                        team,
                        suit,
                        length: runLength,
                        highOrder,
                        value: sequenceValue(runLength),
                    });
                }

                runStart = i;
            }
        }
    });

    return result;
}

/** Намира каре (4 еднакви карти) в дадена ръка за рангове, които носят премия. */
function findKares(
    hand: Card[],
    playerId: number,
    team: 0 | 1
): KareAnnounce[] {
    const result: KareAnnounce[] = [];

    (Object.keys(KARE_VALUES) as Rank[]).forEach((rank) => {
        const count = hand.filter((c) => c.rank === rank).length;

        if (count === 4) {
            result.push({
                playerId,
                team,
                rank,
                value: KARE_VALUES[rank],
            });
        }
    });

    return result;
}

export function getPlayerAnnouncements(
    state: GameState,
    playerId: number
): string[] {
    if (state.phase === "bidding" || !state.contract) return [];

    const player = state.players[playerId];
    const hand = state.initialHands[playerId] ?? player.hand;

    // Без коз: само 4 аса = 400.
    if (state.contract === "NO_TRUMP") {
        const aces = hand.filter((c) => c.rank === "A").length;
        return aces === 4 ? ["4× A = 400"] : [];
    }

    type DisplayCandidate = { strength: number; label: string };
    const candidates: DisplayCandidate[] = [];

    findSequences(hand, playerId, player.team).forEach((seq) => {
        candidates.push({
            strength: announcementStrength("sequence", seq.length, seq.highOrder),
            label: seq.length === 3 ? "Терца" : seq.length === 4 ? "Кварта" : "Квинта",
        });
    });

    findKares(hand, playerId, player.team).forEach((kare) => {
        candidates.push({
            strength: announcementStrength("kare", kare.value),
            label: kare.rank === "J" && state.contract === "ALL_TRUMP" ? "4× J = 200" : "Каре",
        });
    });

    if (!candidates.length) return [];
    candidates.sort((a, b) => b.strength - a.strength);
    return [candidates[0].label];
}

/**
 * Изчислява бонуса от анонси (терца/кварта/квинта и каре) в началото
 * на раздаването. При игра "Без коз" анонси не се обявяват изобщо.
 * При равни по дължина поредици (или изобщо не по-висока поредица от
 * противника), само отборът с по-високия анонс записва премиите си -
 * другият отбор губи своите; при пълно равенство премиите отпадат за
 * всички. Същото важи поотделно и за каретата.
 */
function announcementStrength(kind: "sequence" | "kare", lengthOrValue: number, highOrder = 0): number {
    // По договорка за тази версия на играта се зачита само един,
    // най-силен анонс от всички налични в ръката/отбора.
    if (kind === "kare") return 1000 + lengthOrValue;
    // Карето е по-силно от всяка поредица. При поредиците: квинта >
    // кварта > терца, а при еднаква дължина по-високата карта е по-силна.
    return lengthOrValue * 100 + highOrder;
}

function computeAnnounceBonus(
    initialHands: Card[][],
    players: Player[],
    contract: Contract
): [number, number] {
    const bonus: [number, number] = [0, 0];

    if (contract === "NO_TRUMP") {
        initialHands.forEach((hand, playerId) => {
            if (hand.filter((c) => c.rank === "A").length === 4) {
                bonus[players[playerId].team] += 40;
            }
        });
        return bonus;
    }

    type Candidate = {
        team: 0 | 1;
        value: number;
        strength: number;
    };
    const candidates: Candidate[] = [];

    initialHands.forEach((hand, playerId) => {
        const team = players[playerId].team;
        const options: Candidate[] = [];

        findSequences(hand, playerId, team).forEach((seq) => {
            options.push({
                team,
                value: seq.value,
                strength: announcementStrength("sequence", seq.length, seq.highOrder),
            });
        });

        findKares(hand, playerId, team).forEach((kare) => {
            options.push({
                team,
                value: kare.value,
                strength: announcementStrength("kare", kare.value),
            });
        });

        // От една ръка може да се запише само най-силният анонс.
        if (options.length) {
            options.sort((a, b) => b.strength - a.strength);
            candidates.push(options[0]);
        }
    });

    if (!candidates.length) return bonus;

    // Ако и двата отбора имат анонси, по-силният определя кой тип
    // анонс печели. При равенство най-силните отпадат.
    const bestStrength = Math.max(...candidates.map((c) => c.strength));
    const strongest = candidates.filter((c) => c.strength === bestStrength);
    if (strongest.length !== 1) return bonus;

    const winningTeam = strongest[0].team;
    const winningStrength = strongest[0].strength;

    // Записват се само анонсите на победилия тип/сила от този отбор;
    // така една ръка никога не дава едновременно каре и терца/кварта/квинта.
    for (const candidate of candidates) {
        if (candidate.team === winningTeam && candidate.strength === winningStrength) {
            // Анонсите са в реални точки (20/50/100/150/200/400),
            // но резултатът се записва в бройки (2/5/10/15/20/40).
            bonus[winningTeam] += candidate.value / 10;
        }
    }

    return bonus;
}

/**
 * Общият брой точки в едно раздаване (без анонси), закръглен по
 * скàла /10: 16 при боя, 26 при всичко коз, 28 при без коз.
 * Използва се, когато декларантът не покрие договора — цялата
 * тази стойност отива у противника.
 */
function contractTotalPoints(contract: Contract): number {
    if (contract === "NO_TRUMP") return 26; // Без коз = 26 бройки след удвояването
    if (contract === "ALL_TRUMP") return 26; // 248 + 10, /10
    return 16; // боя: 152 + 10, /10
}

/**
 * Бонус "Капо" - отборът, който не взе НИТО ЕДНА взятка цялото
 * раздаване (противникът взе всичките 8), плаща допълнителна
 * "глоба", която отива у другия отбор върху обичайните му точки.
 * При "Без коз" всички стойности в раздаването се удвояват, затова
 * и бонусът е двоен: 18 бройки (180 т.) вместо 9 бройки (90 т.).
 * Резултат: 26 (пълния ход) + 18 = 44 бр. при "Без коз",
 * 26 + 9 = 35 бр. при "Всичко коз". Бонусът НЕ се умножава от
 * контра/реконтра.
 */
function capoBonus(contract: Contract): number {
    return contract === "NO_TRUMP" ? 18 : 9;
}

export function playCard(state: GameState, cardId: string, actingPlayerId?: number): GameState {
    if (state.finished || state.phase !== "playing" || state.trickComplete) {
        return state;
    }
    if (actingPlayerId !== undefined && state.currentPlayer !== actingPlayerId) {
        return state;
    }

    const player = state.players[state.currentPlayer];
    const cardIndex = player.hand.findIndex((c) => c.id === cardId);

    if (cardIndex === -1) return state;

    const card = player.hand[cardIndex];

    if (!canPlayCard(state, card)) {
        return {
            ...state,
            message: "Трябва да отговориш на боята (или да качиш в коз).",
        };
    }

    const players = state.players.map((p) => ({
        ...p,
        hand: [...p.hand],
    }));

    players[state.currentPlayer].hand.splice(cardIndex, 1);

    const trick = [
        ...state.trick,
        { playerId: state.currentPlayer, card },
    ];

    if (trick.length < 4) {
        return {
            ...state,
            players,
            trick,
            currentPlayer: nextPlayer(state.currentPlayer),
            message: "Ход на следващия играч.",
        };
    }

    const contract = state.contract as Contract;
    const winner = trickWinner(trick, contract);
    const winningTeam = players[winner.playerId].team;
    const trickPoints = scoreTrick(trick, contract);

    const tricksWon: [number, number] = [...state.tricksWon] as [
        number,
        number
    ];
    tricksWon[winningTeam] += trickPoints;

    const tricksCount: [number, number] = [...state.tricksCount] as [
        number,
        number
    ];
    tricksCount[winningTeam] += 1;

    return {
        ...state,
        players,
        trick,
        trickComplete: true,
        tricksWon,
        tricksCount,
        lastTrickWinnerTeam: winningTeam,
        currentPlayer: winner.playerId,
        message: `${players[winner.playerId].name} печели взятката (+${trickPoints}).`,
    };
}

/**
 * След 2-секундната пауза за показване на завършената взятка,
 * продължаваме към следващата взятка или приключваме раздаването.
 */
export function resolveTrick(state: GameState): GameState {
    if (!state.trickComplete || state.trick.length !== 4) return state;

    const players = state.players;
    const winningTeam = state.lastTrickWinnerTeam as 0 | 1;
    const winnerId = state.currentPlayer;
    const allCardsPlayed = players.every((p) => p.hand.length === 0);

    if (!allCardsPlayed) {
        return {
            ...state,
            trick: [],
            trickComplete: false,
            message: `${players[winnerId].name} започва следващата взятка.`,
        };
    }

    const contract = state.contract as Contract;
    const declarerTeam = players[state.declarer as number].team;
    const opponentTeam: 0 | 1 = declarerTeam === 0 ? 1 : 0;
    const multiplier = state.multiplier;

    // Раздаването приключи - смятаме точките и бонусите.
    const lastTrickBonus: [number, number] = [0, 0];
    lastTrickBonus[winningTeam] += 10;

    const belot = computeBelotBonus(state.initialHands, players, contract);
    const announceBonus = computeAnnounceBonus(
        state.initialHands,
        players,
        contract
    );

    // Бройките от самата игра са в скала /10. При без коз картите се
    // удвояват, но общият сбор на играта остава точно 26 бройки.
    let trickRoundPoints: [number, number];
    if (contract === "NO_TRUMP") {
        const rawNoTrump: [number, number] = [
            state.tricksWon[0] * 2 + lastTrickBonus[0],
            state.tricksWon[1] * 2 + lastTrickBonus[1],
        ];
        const rounded: [number, number] = [
            Math.round(rawNoTrump[0] / 10),
            Math.round(rawNoTrump[1] / 10),
        ];
        // Без коз винаги е 26 бройки общо. Коригираме закръглянето
        // към отбора с по-големия суров резултат.
        const diff = 26 - (rounded[0] + rounded[1]);
        if (diff !== 0) {
            const adjustTeam: 0 | 1 = rawNoTrump[0] >= rawNoTrump[1] ? 0 : 1;
            rounded[adjustTeam] += diff;
        }
        trickRoundPoints = rounded;
    } else {
        const noTrumpFactor = 1;
        const trickRawPoints: [number, number] = [
            (state.tricksWon[0] + lastTrickBonus[0]) * noTrumpFactor,
            (state.tricksWon[1] + lastTrickBonus[1]) * noTrumpFactor,
        ];
        trickRoundPoints = roundRoundPoints(trickRawPoints, contract);
    }
    const roundPoints: [number, number] = [
        trickRoundPoints[0] + belot[0] + announceBonus[0],
        trickRoundPoints[1] + belot[1] + announceBonus[1],
    ];

    const bonus: [number, number] = [
        belot[0] + announceBonus[0],
        belot[1] + announceBonus[1],
    ];

    const notCovered = roundPoints[declarerTeam] <= roundPoints[opponentTeam];
    const multiplierNote = multiplier > 1 ? ` (×${multiplier})` : "";

    // "Капо": единият отбор не взе нито една взятка (другият взе
    // всичките 8). Печелившият получава допълнителен бонус върху
    // обичайните си точки - виж capoBonus() по-горе - независимо от
    // контра/реконтра. Собствените анонси на "капо" отбора продължават
    // да се броят за него (виж belot/announceBonus по-долу).
    const capoTeam: 0 | 1 | null =
        state.tricksCount[0] === 8 ? 0 :
        state.tricksCount[1] === 8 ? 1 : null;

    let roundTotal: [number, number];
    let message: string;

    if (multiplier > 1) {
        // Контра/Реконтра: играе се на "всичко или нищо" - целият
        // рунд отива у отбора с ПОВЕЧЕ точки в тази ръка (без
        // значение кой е бил декларант), умножен ×2 (контра) или
        // ×4 (реконтра). Губещият взима фиксирана кертица — -20 при
        // контра, -40 при реконтра — вместо дела си от точките.
        const winningTeam: 0 | 1 =
            roundPoints[0] > roundPoints[1] ? 0 :
            roundPoints[1] > roundPoints[0] ? 1 :
            opponentTeam;
        const losingTeam: 0 | 1 = winningTeam === 0 ? 1 : 0;

        const kertitsaPenalty = multiplier === 4 ? 40 : 20;
        const handTotal = contractTotalPoints(contract) * multiplier;

        roundTotal = [0, 0];
        roundTotal[winningTeam] = handTotal + belot[winningTeam] + announceBonus[winningTeam];
        roundTotal[losingTeam] = -kertitsaPenalty + belot[losingTeam] + announceBonus[losingTeam];

        if (capoTeam !== null) {
            roundTotal[capoTeam] += capoBonus(contract);
        }

        const winnerAnnounceNote =
            belot[winningTeam] + announceBonus[winningTeam] > 0
                ? ` (+${belot[winningTeam] + announceBonus[winningTeam]} анонси)`
                : "";
        const capoNote =
            capoTeam !== null
                ? ` Капо: ${players.find((p) => p.team === capoTeam)?.name ?? "отборът"} +${capoBonus(contract)} т.`
                : "";

        message =
            `${players.find((p) => p.team === winningTeam)?.name ?? "Отборът"} взема всичко` +
            `${multiplierNote} — ${handTotal} т.${winnerAnnounceNote}, ` +
            `другият отбор губи ${kertitsaPenalty} т.${capoNote}`;
    } else if (notCovered) {
        // Непокрит договор: противникът взема ЦЕЛИЯ ход (16 т. при
        // боя, 26 т. при всичко коз, 28 т. при без коз) плюс собствените си
        // анонси. Декларантът губи фиксирана санкция — 10 т. при
        // боя/всичко коз, 20 т. при без коз — и това вече му се
        // ИЗВАЖДА от резултата (може да стане отрицателно), плюс
        // запазва собствените си анонси (терца/белот/кварта и т.н.,
        // те се броят независимо от изхода на раздаването).
        const basePenalty = contract === "NO_TRUMP" ? 20 : 10;
        const penalty = basePenalty;
        const handTotal = contractTotalPoints(contract);

        roundTotal = [0, 0];
        // При "вътре" анонсите на деклариралия отбор се прехвърлят към противника.
        // Например: Всичко коз 26 + 4×A (40) -> противникът получава 66.
        roundTotal[declarerTeam] = -penalty;
        roundTotal[opponentTeam] =
            handTotal +
            belot[opponentTeam] +
            announceBonus[opponentTeam] +
            belot[declarerTeam] +
            announceBonus[declarerTeam];

        // Декларантът не взе НИТО ЕДНА взятка -> "Капо": противникът
        // получава допълнителния бонус върху пълните точки на хода.
        // Резултат: 44 т. при Без коз (26+18), 35 т. при Всичко коз (26+9).
        if (capoTeam !== null) {
            roundTotal[capoTeam] += capoBonus(contract);
        }

        const opponentAnnounceNote =
            belot[opponentTeam] + announceBonus[opponentTeam] > 0
                ? ` (+${belot[opponentTeam] + announceBonus[opponentTeam]} анонси)`
                : "";
        const capoNote =
            capoTeam !== null
                ? ` Капо: +${capoBonus(contract)} т. отгоре (общо ${handTotal + capoBonus(contract)} т.).`
                : "";

        message =
            `${players[state.declarer as number].name} не покри договора — ` +
            `противникът взема ${handTotal} т.${opponentAnnounceNote}` +
            `${belot[declarerTeam] + announceBonus[declarerTeam] > 0 ? ` + анонсите на декларанта ${belot[declarerTeam] + announceBonus[declarerTeam]} т.` : ""}, ` +
            `декларантът губи ${penalty} т.${capoNote}`;
    } else {
        roundTotal = [...roundPoints] as [number, number];

        if (capoTeam !== null) {
            roundTotal[capoTeam] += capoBonus(contract);
        }

        const bonusNote =
            bonus[0] + bonus[1] > 0
                ? ` (вкл. бонуси ${bonus[0]}:${bonus[1]})`
                : "";

        const capoNote =
            capoTeam !== null
                ? ` Капо: ${players.find((p) => p.team === capoTeam)?.name ?? "отборът"} +${capoBonus(contract)} т.`
                : "";

        message =
            `Раздаването приключи: ${roundPoints[0]} : ${roundPoints[1]} т. → ` +
            `${roundTotal[0]} : ${roundTotal[1]}${bonusNote}.${capoNote}`;
    }

    const score: [number, number] = [
        state.score[0] + roundTotal[0],
        state.score[1] + roundTotal[1],
    ];

    const finished = score[0] >= 151 || score[1] >= 151;

    if (finished) {
        return {
            ...state,
            phase: "finished",
            trickComplete: false,
            score,
            finished: true,
            message: `Край! ${score[0]} : ${score[1]}`,
        };
    }

    const nextDealer = nextPlayer(state.dealer);
    const next = startRound(nextDealer, score, state.round + 1, state.humanSeat);

    return {
        ...next,
        message,
    };
}

export function botMove(state: GameState): GameState {
    if (state.finished || state.phase !== "playing") {
        return state;
    }

    const player = state.players[state.currentPlayer];

    if (player.id === state.humanSeat) return state;

    const legalCards = player.hand.filter((card) =>
        canPlayCard(state, card)
    );

    if (legalCards.length === 0) return state;

    const card = legalCards[0];

    return playCard(state, card.id);
}
