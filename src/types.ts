export type Suit = "♠" | "♥" | "♦" | "♣";
export type Rank = "7" | "8" | "9" | "10" | "J" | "Q" | "K" | "A";

export type Card = {
    id: string;
    suit: Suit;
    rank: Rank;
};

export type Player = {
    id: number;
    name: string;
    team: 0 | 1;
    hand: Card[];
};

export type Contract = Suit | "NO_TRUMP" | "ALL_TRUMP";
export type Call =
    | Suit
    | "NO_TRUMP"
    | "ALL_TRUMP"
    | "CONTRA"
    | "RECONTRA"
    | "PASS";

export type TrickCard = {
    playerId: number;
    card: Card;
};

export type BidEntry = {
    playerId: number;
    call: Call;
};

export type Phase = "bidding" | "playing" | "finished";

export type HighestBid = {
    contract: Contract;
    playerId: number;
};

export type GameState = {
    players: Player[];
    deck: Card[];
    phase: Phase;

    // Мястото (0-3), което се управлява от истинския локален играч
    // (само за режим "Сам с ботове" - позволява избор на отбор).
    // В онлайн режим не се ползва (всеки клиент е истински играч).
    humanSeat: number;

    dealer: number;

    biddingTurn: number;
    bidHistory: BidEntry[];
    highestBid: HighestBid | null;
    passStreak: number;

    contract: Contract | null;
    declarer: number | null;
    initialHands: Card[][];

    // Контра / Реконтра: множител на резултата от раздаването.
    // 1 = без контра, 2 = контра, 4 = реконтра.
    // Контра/Реконтра вече са обикновени обяви в нормалната
    // ротация на наддаване (не отделна "опашка") - вижте
    // isContraAllowed/isRecontraAllowed в placeCall. Контра може
    // да обяви противник на highestBid, докато multiplier===1;
    // реконтра може да обяви отборът на highestBid, докато
    // multiplier===2. След контра другите играчи по ред СИ МОГАТ
    // да наддадат по-силна обява вместо да чакат - точно както е
    // по правилата.
    multiplier: 1 | 2 | 4;

    currentPlayer: number;
    trick: TrickCard[];
    trickComplete: boolean;
    tricksWon: [number, number];
    tricksCount: [number, number];
    lastTrickWinnerTeam: 0 | 1 | null;

    score: [number, number];
    round: number;
    message: string;
    finished: boolean;
};
