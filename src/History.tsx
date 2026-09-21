import { useEffect, useMemo, useState } from "react";
import type { Card, GameState } from "./types";
import { placeCall, playCard, resolveTrick } from "./game/engine";
import { decodeGameLog } from "./game/notation";
import {
    replayGame,
    replayStates,
    type GameLog,
    type GameOutcome,
    type ReplayEngine,
    type ReplayStep,
} from "./game/replay";

type HistoryItem = {
    id: number;
    roomCode: string;
    createdAt: string;
    finishedAt: string | null;
    rounds: number;
    score0: number;
    score1: number;
    winner: number | null;
    players: { seat: number; name: string }[];
};

type HistoryDetail = HistoryItem & { notation: string };

const engine: ReplayEngine = {
    placeCall: (s, c, seat) => placeCall(s, c, seat),
    playCard: (s, id, seat) => playCard(s, id, seat),
    resolveTrick: (s) => resolveTrick(s),
};

function apiBase(): string {
    const ws = import.meta.env.VITE_WS_URL as string | undefined;
    if (ws) return ws.replace(/^ws/, "http");
    if (location.protocol === "https:") return location.origin;
    return `http://${location.hostname}:8787`;
}

function cardChip(card: Card, key: string) {
    const red = card.suit === "♥" || card.suit === "♦";
    return (
        <span key={key} className={`rv-card ${red ? "red" : ""}`}>
            {card.rank}
            {card.suit}
        </span>
    );
}

function SeatHand({ state, seat, name, active, declarer }: {
    state: GameState;
    seat: number;
    name: string;
    active: boolean;
    declarer: boolean;
}) {
    return (
        <div className={`rv-seat ${active ? "active" : ""}`}>
            <div className="rv-name">
                {active ? "▶ " : ""}
                {declarer ? "★ " : ""}
                {name}
            </div>
            <div className="rv-hand">
                {state.players[seat].hand.map((c) => cardChip(c, `${seat}-${c.id}`))}
            </div>
        </div>
    );
}

function DealReview({ outcome, index, names }: {
    outcome: GameOutcome["deals"][number];
    index: number;
    names: string[];
}) {
    const r = outcome.review;
    const ann = r.announcements
        .map((labels, seat) => (labels.length ? `${names[seat]}: ${labels.join(", ")}` : null))
        .filter(Boolean);

    return (
        <div className="rv-deal">
            <div className="rv-deal-head">
                #{index + 1} · {r.contract ?? "—"} ×{r.multiplier}
                {r.declarer !== null ? ` · декларатор ${names[r.declarer]}` : ""}
            </div>
            <div className="rv-deal-pts">
                взятки: {r.tricksWon[0]}:{r.tricksWon[1]} ·{" "}
                {outcome.scoreBefore[0]}:{outcome.scoreBefore[1]} → {outcome.scoreAfter[0]}:{outcome.scoreAfter[1]}{" "}
                (<b>{outcome.roundTotal[0] >= 0 ? "+" : ""}{outcome.roundTotal[0]}:{outcome.roundTotal[1] >= 0 ? "+" : ""}{outcome.roundTotal[1]}</b>)
            </div>
            <div className="rv-deal-ann">
                {ann.length ? ann.join(" | ") : "без анонси"}
            </div>
        </div>
    );
}

export default function History({ onClose }: { onClose: () => void }) {
    const [list, setList] = useState<HistoryItem[] | null>(null);
    const [selected, setSelected] = useState<HistoryDetail | null>(null);
    const [error, setError] = useState("");
    const [stepIndex, setStepIndex] = useState(0);
    const [playing, setPlaying] = useState(false);

    useEffect(() => {
        fetch(`${apiBase()}/api/history`)
            .then((r) => r.json())
            .then((data) => setList(Array.isArray(data) ? data : []))
            .catch(() => setError("Не мога да заредя историята."));
    }, []);

    function open(item: HistoryItem) {
        setError("");
        fetch(`${apiBase()}/api/history/${item.id}`)
            .then((r) => r.json())
            .then((data: HistoryDetail) => {
                if (!data || !data.notation) return setError("Играта не е намерена.");
                setSelected(data);
                setStepIndex(0);
                setPlaying(false);
            })
            .catch(() => setError("Не мога да заредя играта."));
    }

    const { log, outcome, steps } = useMemo(() => {
        if (!selected) {
            return { log: null as GameLog | null, outcome: null as GameOutcome | null, steps: [] as ReplayStep[] };
        }
        try {
            const decoded = decodeGameLog(selected.notation);
            return {
                log: decoded,
                outcome: replayGame(decoded, engine),
                steps: replayStates(decoded, engine),
            };
        } catch {
            return { log: null, outcome: null, steps: [] as ReplayStep[] };
        }
    }, [selected]);

    // Автоматично преминаване между стъпките.
    useEffect(() => {
        if (!playing || !steps.length) return;
        const timer = setInterval(() => {
            setStepIndex((i) => {
                if (i >= steps.length - 1) {
                    setPlaying(false);
                    return i;
                }
                return i + 1;
            });
        }, 700);
        return () => clearInterval(timer);
    }, [playing, steps.length]);

    const names = selected
        ? [0, 1, 2, 3].map((s) => selected.players.find((p) => p.seat === s)?.name ?? `Играч ${s + 1}`)
        : ["1", "2", "3", "4"];

    const current = steps[stepIndex]?.state;

    return (
        <div className="modal">
            <div className="history-box">
                <div className="history-head">
                    <h2>История на игрите</h2>
                    <button className="score" style={{ background: "transparent", border: 0, color: "#fff", cursor: "pointer", fontSize: 20 }} onClick={onClose}>✕</button>
                </div>

                {error && <p className="error">{error}</p>}

                {!selected && (
                    <>
                        {!list && !error && <p>Зареждане…</p>}
                        {list && list.length === 0 && <p>Още няма записани игри.</p>}
                        <div className="history-list">
                            {list?.map((g) => (
                                <button key={g.id} className="history-row" onClick={() => open(g)}>
                                    <span className="history-score">{g.score0}:{g.score1}</span>
                                    <span className="history-players">
                                        {g.players.map((p) => p.name).join(", ")}
                                    </span>
                                    <span className="history-meta">
                                        {g.rounds} разд. · {new Date(g.createdAt).toLocaleString("bg-BG")}
                                        {g.finishedAt ? "" : " · незавършена"}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </>
                )}

                {selected && !log && <p className="error">Не мога да декодирам играта.</p>}

                {selected && log && current && (
                    <div className="replay-viewer">
                        <div className="rv-top">
                            <button className="team-button" onClick={() => { setSelected(null); setPlaying(false); }}>← Назад</button>
                            <span className="rv-step-label">{steps[stepIndex]?.label}</span>
                            <span className="rv-step-count">стъпка {stepIndex + 1}/{steps.length}</span>
                        </div>

                        <div className="rv-layout">
                            <div className="rv-board">
                                <div className="rv-grid">
                                    {[2, 1, 3, 0].map((seat) => (
                                        <SeatHand
                                            key={seat}
                                            state={current}
                                            seat={seat}
                                            name={names[seat]}
                                            active={current.currentPlayer === seat && current.phase === "playing"}
                                            declarer={current.declarer === seat}
                                        />
                                    ))}
                                </div>
                                <div className="rv-center">
                                    <div className="rv-contract">
                                        Коз: <b>{current.contract ?? "—"}</b>
                                        {current.multiplier > 1 ? ` ×${current.multiplier}` : ""} · точки{" "}
                                        {current.score[0]}:{current.score[1]}
                                    </div>
                                    <div className="rv-trick">
                                        {current.trick.length
                                            ? current.trick.map((t) => cardChip(t.card, `t-${t.card.id}`))
                                            : <em>няма карти на масата</em>}
                                    </div>
                                </div>
                            </div>

                            <div className="rv-side">
                                <h3>Раздавания · точки и анонси</h3>
                                {outcome?.deals.map((d, i) => (
                                    <DealReview key={i} outcome={d} index={i} names={names} />
                                ))}
                                {outcome && !outcome.ok && <p className="error">Replay грешка: {outcome.error}</p>}
                            </div>
                        </div>

                        <div className="rv-controls">
                            <button className="team-button" onClick={() => { setStepIndex(0); setPlaying(false); }}>⏮</button>
                            <button className="team-button" onClick={() => { setStepIndex((i) => Math.max(0, i - 1)); setPlaying(false); }}>◀</button>
                            <button className="team-button" onClick={() => setPlaying((p) => !p)}>{playing ? "⏸" : "▶"}</button>
                            <button className="team-button" onClick={() => { setStepIndex((i) => Math.min(steps.length - 1, i + 1)); setPlaying(false); }}>▶</button>
                            <button className="team-button" onClick={() => { setStepIndex(steps.length - 1); setPlaying(false); }}>⏭</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
