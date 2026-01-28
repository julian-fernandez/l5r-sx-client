import { useState, useEffect } from 'react';
import type { NormalizedCard, ParsedDeck } from '../types/cards';
import { parseDeck } from '../engine/deckParser';
import { useGameStore } from '../store/gameStore';

const SAMPLE_DECK = `# Stronghold
1 Plains of the Maiden

# Sensei
1 Min-Hee Sensei

# Pregame Holdings
1 Border Keep - exp2
1 Bamboo Harvesters - exp

# Dynasty
# Personalities (22)
1 Utaku Liu Xeung - exp
3 Utaku Ji-Yun
3 Utaku Lishan
3 Utaku Mai
3 Utaku Ryoko
3 Utaku Sung-Ki
1 Utaku Ji-Yun - exp
3 Utaku Eun-ju
1 Utaku Kohana - exp
1 Moto Naleesh
# Holdings (12)
3 Small Farm
3 Stables
3 Spirit's Essence Dojo
1 Chugo Seido
1 Ageless Shrine
1 Traveling Peddler
# Celestials (2)
1 Jurojin's Blessing
1 Sadahako's Artistry
# Regions (2)
1 Shinden Shorai
1 The Second City
# Events (2)
1 Imperial Gift
1 Military Alliance

# Fate
# Strategies (35)
3 A Paragon's Strength
3 Cast Aside the Weak
3 Grateful Reward
3 Surety of Purpose
2 Two-Fold Virtue
3 The Perfect Moment
3 The Compassion of the Unicorn
1 Creating Order
3 Pure Intent
2 The Sound of Thunder
3 Riding in Harmony
3 Shinjo's Courage
3 A Noble End
# Items (1)
1 The Blessed Mantle of the Greensnakes
# Followers (3)
3 Utaku Elite Guard
# Rings (1)
1 Ring of the Void`;

interface Props {
  onLoad: (deck: ParsedDeck) => void;
}

interface StrongholdStats {
  honor: number;
  gold: number;
  provinceStrength: number;
}

export function DeckInput({ onLoad }: Props) {
  const catalogLoaded = useGameStore(s => s.catalogLoaded);
  const lastDeckText = useGameStore(s => s.lastDeckText);
  const setLastDeckText = useGameStore(s => s.setLastDeckText);
  const setStrongholdOverride = useGameStore(s => s.setStrongholdOverride);

  const [text, setText] = useState(lastDeckText || SAMPLE_DECK);
  const [parsed, setParsed] = useState<ParsedDeck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stats, setStats] = useState<StrongholdStats | null>(null);
  const [statsFromLookup, setStatsFromLookup] = useState(false);

  // When parsed deck changes, sync stronghold stats from card data
  useEffect(() => {
    if (!parsed) { setStats(null); return; }
    const sh = parsed.stronghold[0]?.card;
    if (sh) {
      const detected: StrongholdStats = {
        honor: sh.startingHonor ?? 5,
        gold: Number(sh.goldProduction) || 5,
        provinceStrength: sh.provinceStrength ?? 6,
      };
      setStats(detected);
      // If stats came from the lookup table they'll differ from defaults
      setStatsFromLookup(
        (sh.startingHonor != null && sh.startingHonor !== 5) ||
        (sh.provinceStrength != null && sh.provinceStrength !== 6)
      );
    } else {
      setStats(null);
    }
  }, [parsed]);

  function handleParse() {
    setError(null);
    try {
      const deck = parseDeck(text);
      setParsed(deck);
      setLastDeckText(text);
    } catch (e) {
      setError(String(e));
    }
  }

  function handleLoad() {
    if (!parsed || !stats) return;
    setStrongholdOverride(stats);
    onLoad(parsed);
  }

  const sh = parsed?.stronghold[0]?.card as NormalizedCard | undefined;
  const dynastyCount = parsed?.dynasty.reduce((s, e) => s + e.quantity, 0) ?? 0;
  const fateCount = parsed?.fate.reduce((s, e) => s + e.quantity, 0) ?? 0;

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 gap-8" style={{ background: '#0a0f1e' }}>
      {/* Header */}
      <div className="text-center space-y-1">
        <h1 className="text-2xl font-bold text-white tracking-tight">
          L5R · Samurai Extended
        </h1>
        <p className="text-sm text-gray-500">Solo proof of concept · Paste deck to begin</p>
      </div>

      <div className="w-full max-w-3xl flex gap-5">
        {/* Left: Deck text input */}
        <div className="flex-1 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
              Deck (Sun &amp; Moon format)
            </label>
            {!catalogLoaded && (
              <span className="text-xs text-amber-400 animate-pulse">Loading card database…</span>
            )}
          </div>

          <textarea
            value={text}
            onChange={e => { setText(e.target.value); setParsed(null); setStats(null); }}
            rows={22}
            disabled={!catalogLoaded}
            className="w-full bg-board-zone text-gray-300 text-[11px] font-mono rounded-xl border border-board-border px-3 py-3 resize-none focus:outline-none focus:ring-1 focus:ring-violet-600 disabled:opacity-40 leading-5"
            placeholder="Paste deck list here…"
            spellCheck={false}
          />

          {error && <p className="text-red-400 text-xs">{error}</p>}

          <button
            onClick={handleParse}
            disabled={!catalogLoaded || !text.trim()}
            className="btn-primary w-full justify-center disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Parse Deck
          </button>
        </div>

        {/* Right: Parsed results + stats */}
        <div className="w-64 flex-shrink-0 flex flex-col gap-3">
          {!parsed ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-2 text-center border border-dashed border-board-border rounded-xl p-6">
              <p className="text-gray-600 text-sm">Parse your deck to see the summary and set up the game.</p>
            </div>
          ) : (
            <>
              {/* Summary */}
              <div className="zone p-3 space-y-2">
                <p className="zone-label">Deck Summary</p>
                <SummaryRow label="Dynasty" value={dynastyCount} target={40} color="text-orange-400" />
                <SummaryRow label="Fate" value={fateCount} target={40} color="text-green-400" />

                {sh && (
                  <div className="pt-2 border-t border-board-border space-y-1">
                    <p className="text-[10px] text-gray-500">Stronghold</p>
                    <p className="text-xs font-semibold text-amber-300">{sh.name}</p>
                    {parsed.sensei[0]?.card && (
                      <>
                        <p className="text-[10px] text-gray-500">Sensei</p>
                        <p className="text-xs font-semibold text-violet-300">{parsed.sensei[0].card.name}</p>
                      </>
                    )}
                  </div>
                )}

                <div className="pt-2 border-t border-board-border space-y-1">
                  <p className="text-[10px] text-gray-500">Pregame Holdings</p>
                  {parsed.pregameHoldings.map((e, i) => (
                    <p key={i} className="text-xs text-gray-300">
                      {e.card ? e.card.name : <span className="text-red-400">{e.name} (not found)</span>}
                    </p>
                  ))}
                </div>
              </div>

              {/* Stronghold stats — editable */}
              {stats && (
                <div className="zone p-3 space-y-2.5">
                  <div className="flex items-center gap-2">
                    <p className="zone-label flex-1">Stronghold Stats</p>
                    {statsFromLookup
                      ? <span className="text-[9px] text-green-500 bg-green-950/50 border border-green-800/40 rounded px-1.5 py-0.5">From lookup</span>
                      : <span className="text-[9px] text-amber-500 bg-amber-950/50 border border-amber-800/40 rounded px-1.5 py-0.5">Verify values</span>
                    }
                  </div>
                  <StatInput label="Family Honor" value={stats.honor} onChange={v => setStats(s => s ? { ...s, honor: v } : s)} />
                  <StatInput label="Gold Production" value={stats.gold} onChange={v => setStats(s => s ? { ...s, gold: v } : s)} />
                  <StatInput label="Province Strength" value={stats.provinceStrength} onChange={v => setStats(s => s ? { ...s, provinceStrength: v } : s)} />
                  <p className="text-[9px] text-gray-600 leading-relaxed">
                    Sensei modifiers are applied automatically on top of these base stats.
                  </p>
                </div>
              )}

              {/* Missing cards */}
              {parsed.missing.length > 0 && (
                <div className="zone p-3 border-red-900/60">
                  <p className="text-[10px] text-red-400 font-semibold uppercase tracking-wide mb-1.5">
                    Not found ({parsed.missing.length})
                  </p>
                  <ul className="space-y-0.5">
                    {parsed.missing.map((m, i) => (
                      <li key={i} className="text-[11px] text-red-400">• {m}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Launch button */}
              <button
                onClick={handleLoad}
                disabled={!stats}
                className="btn-primary w-full justify-center text-base py-2.5 disabled:opacity-40"
              >
                Set Up Game →
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SummaryRow({ label, value, target, color }: {
  label: string; value: number; target: number; color: string;
}) {
  const ok = value >= target;
  return (
    <div className="flex justify-between items-center">
      <span className="text-[11px] text-gray-400">{label}</span>
      <span className={`text-sm font-bold ${ok ? color : 'text-red-400'}`}>
        {value}
        {!ok && <span className="text-[10px] text-red-500 ml-1">(need {target})</span>}
      </span>
    </div>
  );
}

function StatInput({ label, value, onChange }: {
  label: string; value: number; onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <label className="text-[11px] text-gray-400 flex-1">{label}</label>
      <input
        type="number"
        value={value}
        onChange={e => onChange(parseInt(e.target.value) || 0)}
        className="w-14 bg-white/5 border border-board-border rounded-md px-2 py-1 text-sm font-bold text-white text-center focus:outline-none focus:ring-1 focus:ring-violet-600"
        min={-20}
        max={40}
      />
    </div>
  );
}
