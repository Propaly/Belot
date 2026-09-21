import type {
    BidEntry,
    Call,
    Card,
    Contract,
    GameState,
    Player,
    Rank,
    Suit,
    TrickCard,
} from "../types.ts";
import {
    buildBiddingState,
    cardFromId,
    type DealLog,
    type GameLog,
} from "./replay.ts";

/**
 * ================== Белот нотация ("език") ==================
 *
 * Идеята е като FEN/PGN в шаха:
 *
 *  - ПОЗИЦИЯ (FEN-подобна): един ред, който описва ПЪЛНОТО състояние -
 *    ръцете на четиримата, тестето (в ред!), чий ред е, взятката на
 *    масата, козът/договорът, контрата, точките, раздаването и т.н.
 *    От нея състоянието се възстановява 1:1, без никаква случайност.
 *
 *  - ИГРА (PGN-подобна): заглавен ред с резултата + по един ред за всяко
 *    раздаване: "<позиция>|<ходове>". Ходовете са в игрален запис:
 *    'b<seat><call>' за обяви и 'p<seat><card>' за изиграни карти.
 *
 * Карти: ранг + буква за боя -> 7,8,9,T(10),J,Q,K,A + S(♠) H(♥) D(♦) C(♣).
 * Обяви: S H D C N(без коз) A(всичко коз) X(контра) R(реконтра) P(пас).
 */

// ---------- Кодове ----------

const RANK_TO_CODE: Record<Rank, string> = {
    "7": "7",
    "8": "8",
    "9": "9",
    "10": "T",
    J: "J",
    Q: "Q",
    K: "K",
    A: "A",
};

const CODE_TO_RANK: Record<string, Rank> = {
    "7": "7",
    "8": "8",
    "9": "9",
    T: "10",
    J: "J",
    Q: "Q",
    K: "K",
    A: "A",
};

const SUIT_TO_CODE: Record<Suit, string> = {
    "♠": "S",
    "♥": "H",
    "♦": "D",
    "♣": "C",
};

const CODE_TO_SUIT: Record<string, Suit> = {
    S: "♠",
    H: "♥",
    D: "♦",
    C: "♣",
};

const CALL_TO_CODE: Record<Call, string> = {
    "♠": "S",
    "♥": "H",
    "♦": "D",
    "♣": "C",
    NO_TRUMP: "N",
    ALL_TRUMP: "A",
    CONTRA: "X",
    RECONTRA: "R",
    PASS: "P",
};

const CODE_TO_CALL: Record<string, Call> = Object.fromEntries(
    (Object.keys(CALL_TO_CODE) as Call[]).map((call) => [CALL_TO_CODE[call], call])
) as Record<string, Call>;

// Ред за канонично подреждане на ръка (за стабилна нотация).
const SUIT_ORDER: Record<Suit, number> = { "♠": 0, "♥": 1, "♦": 2, "♣": 3 };
const RANK_ORDER: Record<Rank, number> = {
    "7": 0,
    "8": 1,
    "9": 2,
    "10": 3,
    J: 4,
    Q: 5,
    K: 6,
    A: 7,
};

export function sortCards(cards: Card[]): Card[] {
    return [...cards].sort((a, b) => {
        const suit = SUIT_ORDER[a.suit] - SUIT_ORDER[b.suit];
        if (suit !== 0) return suit;
        return RANK_ORDER[a.rank] - RANK_ORDER[b.rank];
    });
}

// ---------- Карти ----------

export function encodeCard(card: Card): string {
    return `${RANK_TO_CODE[card.rank]}${SUIT_TO_CODE[card.suit]}`;
}

export function decodeCard(token: string): Card {
    if (token.length !== 2) throw new Error(`Невалидна карта: "${token}"`);

    const rank = CODE_TO_RANK[token[0]];
    const suit = CODE_TO_SUIT[token[1]];

    if (!rank || !suit) throw new Error(`Невалидна карта: "${token}"`);

    return { id: `${suit}-${rank}`, suit, rank };
}

export function encodeCardId(cardId: string): string {
    return encodeCard(cardFromId(cardId));
}

export function decodeCardId(token: string): string {
    return decodeCard(token).id;
}

function encodeCards(cards: Card[]): string {
    if (!cards.length) return "-";
    // НЕ подреждаме - редът на картите в ръката влияе на решенията на
    // ботовете (те взимат първата легална), затова се запазва 1:1.
    return cards.map(encodeCard).join("");
}

function decodeCards(text: string): Card[] {
    if (text === "-" || text === "") return [];
    if (text.length % 2 !== 0) throw new Error(`Невалиден списък карти: "${text}"`);

    const cards: Card[] = [];
    for (let i = 0; i < text.length; i += 2) {
        cards.push(decodeCard(text.slice(i, i + 2)));
    }
    return cards;
}

// ---------- Обяви ----------

export function encodeCall(call: Call): string {
    return CALL_TO_CODE[call];
}

export function decodeCall(token: string): Call {
    const call = CODE_TO_CALL[token];
    if (!call) throw new Error(`Невалидна обява: "${token}"`);
    return call;
}

// ---------- Позиция (FEN-подобна) ----------

const POSITION_VERSION = "belot1";

const PHASE_TO_CODE = { bidding: "B", playing: "P", finished: "F" } as const;
const CODE_TO_PHASE = { B: "bidding", P: "playing", F: "finished" } as const;

function encodeHands(hands: Card[][]): string {
    return hands.map((hand) => encodeCards(hand)).join(",");
}

function decodeHands(text: string): Card[][] {
    return text.split(",").map((hand) => decodeCards(hand));
}

function encodeBidHistory(history: BidEntry[]): string {
    if (!history.length) return "-";
    return history.map((e) => `${e.playerId}${encodeCall(e.call)}`).join(",");
}

function decodeBidHistory(text: string): BidEntry[] {
    if (text === "-") return [];
    return text.split(",").map((entry) => ({
        playerId: Number(entry[0]),
        call: decodeCall(entry.slice(1)),
    }));
}

function encodeTrick(trick: TrickCard[]): string {
    if (!trick.length) return "-";
    return trick.map((t) => `${t.playerId}${encodeCard(t.card)}`).join(",");
}

function decodeTrick(text: string): TrickCard[] {
    if (text === "-") return [];
    return text.split(",").map((entry) => ({
        playerId: Number(entry[0]),
        card: decodeCard(entry.slice(1)),
    }));
}

/**
 * Пълна позиция, разделена с интервали:
 * version phase dealer round humanSeat score biddingTurn currentPlayer
 * highestBid multiplier passStreak contract declarer tricksWon tricksCount
 * lastWinner trickComplete bidHistory trick hands deck initialHands
 */
export function encodePosition(state: GameState): string {
    const highestBid = state.highestBid
        ? `${encodeCall(state.highestBid.contract)}@${state.highestBid.playerId}`
        : "-";

    return [
        POSITION_VERSION,
        PHASE_TO_CODE[state.phase],
        state.dealer,
        state.round,
        state.humanSeat,
        `${state.score[0]}:${state.score[1]}`,
        state.biddingTurn,
        state.currentPlayer,
        highestBid,
        state.multiplier,
        state.passStreak,
        state.contract ? encodeCall(state.contract) : "-",
        state.declarer ?? "-",
        `${state.tricksWon[0]}:${state.tricksWon[1]}`,
        `${state.tricksCount[0]}:${state.tricksCount[1]}`,
        state.lastTrickWinnerTeam ?? "-",
        state.trickComplete ? "1" : "0",
        encodeBidHistory(state.bidHistory),
        encodeTrick(state.trick),
        encodeHands(state.players.map((p) => p.hand)),
        state.deck.length ? state.deck.map(encodeCard).join("") : "-",
        state.initialHands.length ? encodeHands(state.initialHands) : "-",
    ].join(" ");
}

export function decodePosition(text: string): GameState {
    const f = text.trim().split(/\s+/);

    if (f[0] !== POSITION_VERSION) {
        throw new Error(
            `Невалидна позиция: очакван "${POSITION_VERSION}", получен "${f[0]}"`
        );
    }
    if (f.length !== 22) {
        throw new Error(`Невалидна позиция: ${f.length} полета, очаквани 22`);
    }

    const [
        ,
        phaseCode,
        dealer,
        round,
        humanSeat,
        score,
        biddingTurn,
        currentPlayer,
        highestBid,
        multiplier,
        passStreak,
        contract,
        declarer,
        tricksWon,
        tricksCount,
        lastWinner,
        trickComplete,
        bidHistory,
        trick,
        hands,
        deck,
        initialHands,
    ] = f;

    const pair = (value: string): [number, number] => {
        const [a, b] = value.split(":");
        return [Number(a), Number(b)];
    };

    const handCards = decodeHands(hands);
    if (handCards.length !== 4) {
        throw new Error(`Очаквани 4 ръце, получени ${handCards.length}`);
    }

    const players: Player[] = handCards.map((cards, id) => ({
        id,
        name: `Играч ${id + 1}`,
        team: (id % 2) as 0 | 1,
        hand: cards,
    }));

    let highest: GameState["highestBid"] = null;
    if (highestBid !== "-") {
        const [callCode, seat] = highestBid.split("@");
        highest = {
            contract: decodeCall(callCode) as Contract,
            playerId: Number(seat),
        };
    }

    return {
        players,
        deck: decodeCards(deck),
        phase: CODE_TO_PHASE[phaseCode as keyof typeof CODE_TO_PHASE],
        humanSeat: Number(humanSeat),
        dealer: Number(dealer),
        biddingTurn: Number(biddingTurn),
        bidHistory: decodeBidHistory(bidHistory),
        highestBid: highest,
        passStreak: Number(passStreak),
        contract: contract === "-" ? null : (decodeCall(contract) as Contract),
        declarer: declarer === "-" ? null : Number(declarer),
        initialHands: initialHands === "-" ? [] : decodeHands(initialHands),
        multiplier: Number(multiplier) as 1 | 2 | 4,
        currentPlayer: Number(currentPlayer),
        trick: decodeTrick(trick),
        trickComplete: trickComplete === "1",
        tricksWon: pair(tricksWon),
        tricksCount: pair(tricksCount),
        lastTrickWinnerTeam:
            lastWinner === "-" ? null : (Number(lastWinner) as 0 | 1),
        score: pair(score),
        round: Number(round),
        message: "",
        finished: phaseCode === "F",
    };
}

// ---------- Игра (PGN-подобна) ----------

/**
 * Едно раздаване: позицията в началото (фаза наддаване) + ходовете.
 * Формат: "<позиция>|<b... b... p... p...>"
 */
function encodeDealRound(deal: DealLog): string {
    const position = encodePosition(buildBiddingState(deal));

    const moves = [
        ...deal.bidding.map((b) => `b${b.seat}${encodeCall(b.call)}`),
        ...deal.plays.map((p) => `p${p.seat}${encodeCardId(p.cardId)}`),
    ].join(" ");

    return `${position}|${moves}`;
}

function decodeDealRound(line: string): DealLog {
    const sep = line.indexOf("|");
    if (sep === -1) throw new Error("Липсва разделител '|' в реда на раздаването");

    const position = decodePosition(line.slice(0, sep));
    const moves = line
        .slice(sep + 1)
        .trim()
        .split(/\s+/)
        .filter(Boolean);

    const bidding: DealLog["bidding"] = [];
    const plays: DealLog["plays"] = [];

    for (const move of moves) {
        const kind = move[0];
        const seat = Number(move[1]);

        if (kind === "b") {
            bidding.push({ seat, call: decodeCall(move.slice(2)) });
        } else if (kind === "p") {
            plays.push({ seat, cardId: decodeCardId(move.slice(2)) });
        } else {
            throw new Error(`Невалиден ход: "${move}"`);
        }
    }

    return {
        round: position.round,
        dealer: position.dealer,
        scoreBefore: [...position.score] as [number, number],
        humanSeat: position.humanSeat,
        hands: position.players.map((p) => p.hand.map((c) => c.id)),
        deck: position.deck.map((c) => c.id),
        bidding,
        plays,
    };
}

/** Цяла игра: заглавен ред "belot1|s0-s1" + по един ред на раздаване. */
export function encodeGameLog(log: GameLog): string {
    const result = log.result
        ? `${log.result.score[0]}:${log.result.score[1]}`
        : "?";
    const lines = [`${POSITION_VERSION}|${result}`];

    for (const deal of log.deals) {
        lines.push(encodeDealRound(deal));
    }

    return lines.join("\n");
}

export function decodeGameLog(text: string): GameLog {
    const lines = text
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);

    if (!lines.length || !lines[0].startsWith(POSITION_VERSION)) {
        throw new Error("Невалидна игра: липсва заглавен ред");
    }

    const headerParts = lines[0].split("|");
    const resultScore = headerParts[1];

    const deals = lines.slice(1).map(decodeDealRound);

    let result: GameLog["result"];
    if (resultScore && resultScore !== "?") {
        const [a, b] = resultScore.split(":").map(Number);
        result = {
            score: [a, b],
            rounds: deals.length,
            finished: true,
            winner: a >= b ? 0 : 1,
        };
    }

    return {
        version: 1,
        seed: 0,
        humanSeat: deals[0]?.humanSeat ?? 0,
        createdAt: "",
        deals,
        result,
    };
}

/** Четимо резюме на позиция - за човешка проверка/конзолата. */
export function describePosition(state: GameState): string {
    const hands = state.players
        .map((p, i) => `  ${i}: ${encodeCards(p.hand)}`)
        .join("\n");
    const contract = state.contract ?? "—";
    const highest = state.highestBid
        ? `${state.highestBid.contract}@${state.highestBid.playerId}`
        : "—";

    return [
        `Фаза: ${state.phase} | коз/договор: ${contract} | ×${state.multiplier}`,
        `На ход: ${state.currentPlayer} | най-висока: ${highest}`,
        `Точки: ${state.score[0]}:${state.score[1]} | раздаване ${state.round}`,
        `Взятка: ${
            state.trick.length
                ? state.trick.map((t) => `${t.playerId}:${encodeCard(t.card)}`).join(" ")
                : "—"
        }`,
        "Ръце:",
        hands,
    ].join("\n");
}
