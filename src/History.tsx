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

type Period = "7" | "30" | "all";

type Highlight = { step: number; label: string; kind: "deal" | "contract" | "announce" | "contra" | "capo" | "end" };

const PAGE = 30;

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

function relativeTime(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return "сега";
    if (min < 60) return `преди ${min} мин`;
    const h = Math.floor(min / 60);
    if (h < 24) return `преди ${h} ч`;
    const d = Math.floor(h / 24);
    if (d === 1) return "вчера";
    if (d < 7) return `преди ${d} дни`;
    const w = Math.floor(d / 7);
    if (d < 30) return `преди ${w} ${w === 1 ? "седмица" : "седмици"}`;
    const mo = Math.floor(d / 30);
    return `преди ${mo} ${mo === 1 ? "месец" : "месеца"}`;
}

function dayLabel(iso: string): string {
    return new Date(iso).toLocaleDateString("bg-BG", {
        weekday: "long",
        day: "numeric",
        month: "long",
        year: "numeric",
    });
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

/** Откроява ключови моменти от играта - за timeline-а. */
function computeHighlights(steps: ReplayStep[], outcome: GameOutcome | null): Highlight[] {
    const hs: Highlight[] = [];

    for (let i = 0; i < steps.length; i++) {
        const state = steps[i].state;
        const prev = i > 0 ? steps[i - 1].state : null;
        const label = steps[i].label;

        if (state.phase === "playing" && (!prev || prev.phase !== "playing")) {
            const review = outcome?.deals[steps[i].dealIndex]?.review;
            if (review?.contract) {
                hs.push({
                    step: i,
                    kind: "contract",
                    label: `Договор ${review.contract}${review.multiplier > 1 ? ` ×${review.multiplier}` : ""} от играч ${(review.declarer ?? 0) + 1}`,
                });
                const ann = review.announcements
                    .map((l, seat) => (l.length ? `играч ${seat + 1}: ${l.join(", ")}` : null))
                    .filter(Boolean);
                if (ann.length) hs.push({ step: i, kind: "announce", label: `Анонси — ${ann.join(" | ")}` });
                if (review.tricksCount.includes(8)) hs.push({ step: i, kind: "capo", label: "Капо — всички 8 взятки" });
            }
        }

        if (label.startsWith("Обява") && (label.includes("CONTRA") || label.includes("RECONTRA"))) {
            hs.push({ step: i, kind: "contra", label });
        }

        if (label.startsWith("Край на раздаване")) {
            hs.push({ step: i, kind: "end", label });
        }
    }

    return hs.sort((a, b) => a.step - b.step);
}

export default function History({ onClose }: { onClose: () => void }) {
    const [list, setList] = useState<HistoryItem[] | null>(null);
    const [selected, setSelected] = useState<HistoryDetail | null>(null);
    const [error, setError] = useState("");
    const [period, setPeriod] = useState<Period>("all");
    const [hasMore, setHasMore] = useState(true);
    const [loadingMore, setLoadingMore] = useState(false);

    const [stepIndex, setStepIndex] = useState(0);
    const [playing, setPlaying] = useState(false);

    function fromIso(p: Period): string | null {
        if (p === "all") return null;
        const days = p === "7" ? 7 : 30;
        return new Date(Date.now() - days * 86400000).toISOString();
    }

    async function loadPage(p: Period, offset: number, append: boolean) {
        try {
            const from = fromIso(p);
            const query = new URLSearchParams({ limit: String(PAGE), offset: String(offset) });
            if (from) query.set("from", from);
            const items = (await fetch(`${apiBase()}/api/history?${query}`).then((r) => r.json())) as HistoryItem[];

            if (!Array.isArray(items)) throw new Error("bad");
            setList((prev) => (append && prev ? [...prev, ...items] : items));
            setHasMore(items.length === PAGE);
        } catch {
            setError("Не мога да заредя историята.");
        } finally {
            setLoadingMore(false);
        }
    }

    useEffect(() => {
        setError("");
        setList(null);
        setHasMore(true);
        loadPage(period, 0, false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [period]);

    function more() {
        if (!list || loadingMore) return;
        setLoadingMore(true);
        loadPage(period, list.length, true);
    }

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
            return { log: decoded, outcome: replayGame(decoded, engine), steps: replayStates(decoded, engine) };
        } catch {
            return { log: null, outcome: null, steps: [] as ReplayStep[] };
        }
    }, [selected]);

    const highlights = useMemo(() => computeHighlights(steps, outcome), [steps, outcome]);

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
        }, 650);
        return () => clearInterval(timer);
    }, [playing, steps.length]);

    function jumpHighlight(dir: 1 | -1) {
        if (!highlights.length) return;
        const next =
            dir === 1
                ? highlights.find((h) => h.step > stepIndex)
                : [...highlights].reverse().find((h) => h.step < stepIndex);
        if (next) setStepIndex(next.step);
        setPlaying(false);
    }

    const names = selected
        ? [0, 1, 2, 3].map((s) => selected.players.find((p) => p.seat === s)?.name ?? `Играч ${s + 1}`)
        : ["1", "2", "3", "4"];

    const current = steps[stepIndex]?.state;

    return (
        <div className="modal">
            <div className="history-box">
                <div className="history-head">
                    <h2>История на игрите</h2>
                    <button className="close-x" onClick={onClose}>✕</button>
                </div>

                {error && <p className="error">{error}</p>}

                {!selected && (
                    <>
                        <div className="history-filters">
                            <span>Период:</span>
                            {(["7", "30", "all"] as Period[]).map((p) => (
                                <button
                                    key={p}
                                    className={`spectate-btn ${period === p ? "on" : ""}`}
                                    onClick={() => setPeriod(p)}
                                >
                                    {p === "7" ? "7 дни" : p === "30" ? "30 дни" : "Всички"}
                                </button>
                            ))}
                        </div>

                        {!list && !error && <p>Зареждане…</p>}
                        {list && list.length === 0 && <p>Няма записани игри за този период.</p>}

                        <div className="history-list">
                            {list?.map((g, i) => {
                                const day = dayLabel(g.createdAt);
                                const prevDay = i > 0 ? dayLabel(list[i - 1].createdAt) : null;
                                return (
                                    <div key={g.id}>
                                        {day !== prevDay && <div className="history-day">{day}</div>}
                                        <button className="history-row" onClick={() => open(g)}>
                                            <span className="history-score">{g.score0}:{g.score1}</span>
                                            <span className="history-players">{g.players.map((p) => p.name).join(", ")}</span>
                                            <span className="history-meta">
                                                {g.rounds} разд. · {relativeTime(g.createdAt)}
                                                {g.finishedAt ? "" : " · незавършена"}
                                            </span>
                                        </button>
                                    </div>
                                );
                            })}
                        </div>

                        {list && hasMore && (
                            <button className="new-game" onClick={more} disabled={loadingMore}>
                                {loadingMore ? "Зареждане…" : "Още по-стари игри"}
                            </button>
                        )}
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

                        <div className="rv-timeline">
                            <input
                                type="range"
                                className="rv-slider"
                                min={0}
                                max={Math.max(0, steps.length - 1)}
                                value={stepIndex}
                                onChange={(e) => { setStepIndex(Number(e.target.value)); setPlaying(false); }}
                            />
                            <div className="rv-track">
                                {highlights.map((h, i) => (
                                    <button
                                        key={i}
                                        className={`rv-marker kind-${h.kind}`}
                                        style={{ left: `${steps.length > 1 ? (h.step / (steps.length - 1)) * 100 : 0}%` }}
                                        title={h.label}
                                        onClick={() => { setStepIndex(h.step); setPlaying(false); }}
                                    />
                                ))}
                            </div>
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
                                        {current.multiplier > 1 ? ` ×${current.multiplier}` : ""} · точки {current.score[0]}:{current.score[1]}
                                    </div>
                                    <div className="rv-trick">
                                        {current.trick.length
                                            ? current.trick.map((t) => cardChip(t.card, `t-${t.card.id}`))
                                            : <em>няма карти на масата</em>}
                                    </div>
                                </div>
                            </div>

                            <div className="rv-side">
                                <h3>Акценти (timeline)</h3>
                                <div className="rv-highlights">
                                    {highlights.map((h, i) => (
                                        <button
                                            key={i}
                                            className={`rv-hl kind-${h.kind} ${h.step === stepIndex ? "active" : ""}`}
                                            onClick={() => { setStepIndex(h.step); setPlaying(false); }}
                                        >
                                            {h.label}
                                        </button>
                                    ))}
                                    {!highlights.length && <em>няма акценти</em>}
                                </div>

                                <h3>Раздавания · точки и анонси</h3>
                                {outcome?.deals.map((d, i) => (
                                    <DealReview key={i} outcome={d} index={i} names={names} />
                                ))}
                                {outcome && !outcome.ok && <p className="error">Replay грешка: {outcome.error}</p>}
                            </div>
                        </div>

                        <div className="rv-controls">
                            <button className="team-button" onClick={() => { setStepIndex(0); setPlaying(false); }}>⏮</button>
                            <button className="team-button" onClick={() => jumpHighlight(-1)}>⇤ акцент</button>
                            <button className="team-button" onClick={() => { setStepIndex((i) => Math.max(0, i - 1)); setPlaying(false); }}>◀</button>
                            <button className="team-button" onClick={() => setPlaying((p) => !p)}>{playing ? "⏸" : "▶"}</button>
                            <button className="team-button" onClick={() => { setStepIndex((i) => Math.min(steps.length - 1, i + 1)); setPlaying(false); }}>▶</button>
                            <button className="team-button" onClick={() => jumpHighlight(1)}>акцент ⇥</button>
                            <button className="team-button" onClick={() => { setStepIndex(steps.length - 1); setPlaying(false); }}>⏭</button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
