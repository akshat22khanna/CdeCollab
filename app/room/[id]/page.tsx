'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { io, Socket } from 'socket.io-client';
import * as Y from 'yjs';
import { useParams } from 'next/navigation';
import { api } from '@/lib/client-api';

const WS_URL = process.env.NEXT_PUBLIC_WS_URL || 'https://akshat22khanna-codecollab-api.onrender.com';
const Editor = dynamic(() => import('@monaco-editor/react'), { ssr: false });

type Room = { id: number; title: string; language: string; current_code: string };
type Analysis = {
  complexity: string;
  complexity_score: number;
  quality_score: number;
  bugs: string[];
  suggestions: string[];
  hint: string;
};

function updateToBase64(update: Uint8Array) {
  let binary = '';
  for (let i = 0; i < update.length; i += 1) binary += String.fromCharCode(update[i]);
  return btoa(binary);
}

function base64ToUpdate(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export default function RoomPage() {
  const params = useParams<{ id: string }>();
  const roomId = Number(params?.id || 0);
  const [room, setRoom] = useState<Room | null>(null);
  const [language, setLanguage] = useState('javascript');
  const [code, setCode] = useState('// Start coding...');
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [analysisError, setAnalysisError] = useState('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [lastAnalyzedAt, setLastAnalyzedAt] = useState<string>('');
  const [participants, setParticipants] = useState<string[]>([]);
  const [status, setStatus] = useState('connecting');

  const socketRef = useRef<Socket | null>(null);
  const idleRef = useRef<NodeJS.Timeout | null>(null);
  const saveRef = useRef<NodeJS.Timeout | null>(null);
  const yDocRef = useRef<Y.Doc | null>(null);
  const yTextRef = useRef<Y.Text | null>(null);
  const bindingRef = useRef<{ destroy: () => void } | null>(null);

  useEffect(() => {
    if (!roomId) return;

    let mounted = true;

    async function bootstrap() {
      const roomRes = await api(`/api/rooms/${roomId}`);
      if (!mounted) return;

      setRoom(roomRes.room);
      setLanguage(roomRes.room.language || 'javascript');
      setCode(roomRes.room.current_code || '');

      const joinRes = await api(`/api/rooms/${roomId}/join`, { method: 'POST' });
      const socket = io(WS_URL, {
        auth: { token: joinRes.token },
        transports: ['websocket', 'polling'],
      });
      socketRef.current = socket;

      socket.on('connect', () => {
        setStatus('connected');
        socket.emit('room:join', { roomId });
      });

      socket.on('disconnect', () => setStatus('disconnected'));
      socket.on('room:participants', (names: string[]) => setParticipants(names));
      socket.on('room:language', (payload: { language: string }) => {
        setLanguage(payload.language || 'javascript');
      });

      socket.on('room:yjs:init', (payload: { update: string }) => {
        const yDoc = yDocRef.current;
        if (!yDoc || !payload?.update) return;
        const update = base64ToUpdate(payload.update);
        Y.applyUpdate(yDoc, update, 'remote');
      });

      socket.on('room:yjs:update', (payload: { update: string }) => {
        const yDoc = yDocRef.current;
        if (!yDoc || !payload?.update) return;
        const update = base64ToUpdate(payload.update);
        Y.applyUpdate(yDoc, update, 'remote');
      });
    }

    bootstrap().catch(() => setStatus('error'));

    return () => {
      mounted = false;
      socketRef.current?.disconnect();
      bindingRef.current?.destroy();
      yDocRef.current?.destroy();
      if (idleRef.current) clearTimeout(idleRef.current);
      if (saveRef.current) clearTimeout(saveRef.current);
    };
  }, [roomId]);

  async function runAnalysis(nextCode?: string, nextLanguage?: string) {
    try {
      setIsAnalyzing(true);
      setAnalysisError('');
      const res = await api('/api/ai/analyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          roomId,
          code: nextCode ?? code,
          language: nextLanguage ?? language,
        }),
      });
      setAnalysis(res.analysis);
      setLastAnalyzedAt(new Date().toLocaleTimeString());
    } catch (e: any) {
      setAnalysisError(e?.message || 'Analysis request failed');
    } finally {
      setIsAnalyzing(false);
    }
  }

  const debouncedAnalyze = (nextCode: string, nextLanguage: string) => {
    if (idleRef.current) clearTimeout(idleRef.current);
    idleRef.current = setTimeout(() => {
      runAnalysis(nextCode, nextLanguage).catch(() => undefined);
    }, 800);
  };

  const debouncedSave = (nextCode: string, nextLanguage: string) => {
    if (saveRef.current) clearTimeout(saveRef.current);
    saveRef.current = setTimeout(() => {
      socketRef.current?.emit('room:code', { roomId, code: nextCode, language: nextLanguage });
    }, 400);
  };

  const handleEditorMount = async (editor: any, monaco: any) => {
    const { MonacoBinding } = await import('y-monaco');
    const yDoc = new Y.Doc();
    const yText = yDoc.getText('monaco');

    if (code) yText.insert(0, code);

    const model = editor.getModel() || monaco.editor.createModel(code, language);
    const binding = new MonacoBinding(yText, model, new Set([editor]), undefined);

    yDoc.on('update', (update, origin) => {
      const nextCode = model.getValue();
      setCode(nextCode);

      if (origin !== 'remote') {
        const encoded = updateToBase64(update);
        socketRef.current?.emit('room:yjs:update', { roomId, update: encoded });
      }

      debouncedSave(nextCode, language);
      debouncedAnalyze(nextCode, language);
    });

    yDocRef.current = yDoc;
    yTextRef.current = yText;
    bindingRef.current = binding;
  };

  const title = useMemo(() => room?.title || `Room ${roomId}`, [room, roomId]);

  if (!roomId) {
    return (
      <main className="min-h-screen bg-slate-100 p-6">
        <p className="text-sm text-red-600">Invalid room id.</p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 p-4 md:p-6">
      <section className="mx-auto grid max-w-7xl gap-4 lg:grid-cols-[1fr_360px]">
        <article className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          <header className="mb-3 flex flex-wrap items-center justify-between gap-3 px-2">
            <div>
              <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
              <p className="text-xs text-slate-600">Status: {status} | Participants: {participants.join(', ') || 'No one yet'}</p>
            </div>
            <select
              className="rounded border p-2 text-sm"
              value={language}
              onChange={(e) => {
                const nextLanguage = e.target.value;
                setLanguage(nextLanguage);
                socketRef.current?.emit('room:code', { roomId, code, language: nextLanguage });
                debouncedAnalyze(code, nextLanguage);
              }}
            >
              <option value="javascript">JavaScript</option>
              <option value="typescript">TypeScript</option>
              <option value="python">Python</option>
              <option value="java">Java</option>
              <option value="cpp">C++</option>
            </select>
          </header>
          <Editor
            height="72vh"
            language={language}
            defaultValue={code}
            theme="vs-light"
            onMount={handleEditorMount}
            options={{ automaticLayout: true }}
          />
        </article>

        <article className="space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h2 className="font-medium text-slate-900">AI Mentor</h2>
              <button
                className="rounded bg-sky-700 px-3 py-1.5 text-xs text-white disabled:opacity-60"
                onClick={() => runAnalysis()}
                disabled={isAnalyzing}
              >
                {isAnalyzing ? 'Analyzing...' : 'Analyze Now'}
              </button>
            </div>
            <p className="mt-3 text-sm text-slate-700">{analysis?.hint || 'Type code and wait 800ms for automatic hints.'}</p>
            {lastAnalyzedAt ? <p className="mt-2 text-xs text-slate-500">Last analyzed at {lastAnalyzedAt}</p> : null}
            {analysisError ? <p className="mt-2 text-xs text-red-600">{analysisError}</p> : null}
            <div className="mt-3 text-sm text-slate-600">
              <p>Complexity: {analysis?.complexity || '-'}</p>
              <p>Complexity Score: {analysis?.complexity_score ?? '-'}</p>
              <p>Quality Score: {analysis?.quality_score ?? '-'}</p>
            </div>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="font-medium text-slate-900">Bugs</h2>
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              {(analysis?.bugs || ['No issues detected yet']).map((item) => (
                <li key={item}>- {item}</li>
              ))}
            </ul>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <h2 className="font-medium text-slate-900">Suggestions</h2>
            <ul className="mt-2 space-y-1 text-sm text-slate-700">
              {(analysis?.suggestions || ['Awaiting analysis']).map((item) => (
                <li key={item}>- {item}</li>
              ))}
            </ul>
          </section>
        </article>
      </section>
    </main>
  );
}
