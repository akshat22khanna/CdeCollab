'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Editor from '@monaco-editor/react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/client-api';

type Snapshot = {
  id: number;
  code: string;
  language: string;
  created_at: string;
};

export default function SessionReplayPage() {
  const params = useParams<{ id: string }>();
  const sessionId = Number(params?.id || 0);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (!sessionId) return;
    api(`/api/sessions/${sessionId}/snapshots`)
      .then((res) => setSnapshots(res.snapshots || []))
      .catch((e: any) => setError(e.message || 'Could not load replay data'));
  }, [sessionId]);

  useEffect(() => {
    if (!playing || snapshots.length <= 1) return;
    timerRef.current = setInterval(() => {
      setIndex((prev) => {
        if (prev >= snapshots.length - 1) {
          setPlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [playing, snapshots.length]);

  const current = snapshots[index];
  const pct = useMemo(() => {
    if (!snapshots.length) return 0;
    return Math.round((index / Math.max(1, snapshots.length - 1)) * 100);
  }, [index, snapshots.length]);

  return (
    <main className="min-h-screen bg-slate-100 p-4 md:p-8">
      <section className="mx-auto max-w-6xl space-y-4">
        <header className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-semibold text-slate-900">Session Replay #{sessionId}</h1>
              <p className="text-sm text-slate-600">
                {snapshots.length} snapshots | Progress {pct}%
              </p>
            </div>
            <Link href="/" className="text-sm text-sky-700">Back to Dashboard</Link>
          </div>
        </header>

        <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          {!error && snapshots.length === 0 ? (
            <p className="text-sm text-slate-600">No snapshots found for this session yet.</p>
          ) : null}

          {snapshots.length > 0 ? (
            <>
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <button
                  className="rounded bg-slate-900 px-3 py-1.5 text-xs text-white"
                  onClick={() => setPlaying((p) => !p)}
                >
                  {playing ? 'Pause' : 'Play'}
                </button>
                <button
                  className="rounded bg-slate-200 px-3 py-1.5 text-xs text-slate-900"
                  onClick={() => setIndex(0)}
                >
                  Reset
                </button>
                <span className="text-xs text-slate-600">
                  Snapshot {index + 1} / {snapshots.length} | {new Date(current.created_at).toLocaleString()}
                </span>
              </div>

              <input
                className="mb-4 w-full"
                type="range"
                min={0}
                max={Math.max(0, snapshots.length - 1)}
                value={index}
                onChange={(e) => {
                  setPlaying(false);
                  setIndex(Number(e.target.value));
                }}
              />

              <Editor
                height="70vh"
                language={current.language || 'javascript'}
                value={current.code}
                theme="vs-light"
                options={{ readOnly: true, minimap: { enabled: false } }}
              />
            </>
          ) : null}
        </section>
      </section>
    </main>
  );
}
