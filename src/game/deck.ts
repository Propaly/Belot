import type { Card, Rank, Suit } from "../types.ts";

export const SUITS: Suit[] = ["♠", "♥", "♦", "♣"];

export const RANKS: Rank[] = [
    "7",
    "8",
    "9",
    "10",
    "J",
    "Q",
    "K",
    "A",
];

export function createDeck(): Card[] {
    return SUITS.flatMap((suit) =>
        RANKS.map((rank) => ({
            id: `${suit}-${rank}`,
            suit,
            rank,
        }))
    );
}

export function shuffle<T>(items: T[]): T[] {
    const result = [...items];

    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));

        [result[i], result[j]] = [
            result[j],
            result[i],
        ];
    }

    return result;
}