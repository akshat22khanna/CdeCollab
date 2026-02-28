'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Line } from 'react-chartjs-2';
import { Chart as ChartJS, CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend } from 'chart.js';
import { api, getToken, setToken } from '@/lib/client-api';

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

type User = { id: number; name: string; email: string; role: 'interviewer' | 'candidate' };
type Room = { id: number; title: string; language: string; created_at: string };
type Session = { id: number; room_title: string; complexity_score: number; quality_score: number; created_at: string };

export default function HomePage() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [token, updateToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<'interviewer' | 'candidate'>('candidate');
  const [roomTitle, setRoomTitle] = useState('Mock Interview Room');
  const [roomLanguage, setRoomLanguage] = useState('javascript');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const t = getToken();
    if (t) {
      updateToken(t);
      bootstrap();
    }
  }, []);

  async function bootstrap() {
    try {
      const me = await api('/api/auth/me');
      setUser(me.user);
      setRooms((await api('/api/rooms')).rooms);
      setSessions((await api('/api/sessions/history?page=1&limit=10')).sessions);
    } catch {
      setToken(null);
      updateToken(null);
    }
  }

  async function submitAuth() {
    setLoading(true);
    setError('');
    try {
      const payload = mode === 'register' ? { name, email, password, role } : { email, password };
      const res = await api(`/api/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        skipAuth: true,
      });
      setToken(res.token);
      updateToken(res.token);
      await bootstrap();
    } catch (e: any) {
      setError(e.message || 'Authentication failed');
    } finally {
      setLoading(false);
    }
  }

  async function createRoom() {
    setLoading(true);
    setError('');
    try {
      const res = await api('/api/rooms', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: roomTitle, language: roomLanguage }),
      });
      setRooms([res.room, ...rooms]);
      router.push(`/room/${res.room.id}`);
    } catch (e: any) {
      setError(e.message || 'Could not create room');
    } finally {
      setLoading(false);
    }
  }

  const chartData = useMemo(() => ({
    labels: sessions.slice().reverse().map((s) => new Date(s.created_at).toLocaleDateString()),
    datasets: [
      { label: 'Complexity Score', data: sessions.slice().reverse().map((s) => s.complexity_score), borderColor: '#0369a1', backgroundColor: 'rgba(3,105,161,0.2)' },
      { label: 'Quality Score', data: sessions.slice().reverse().map((s) => s.quality_score), borderColor: '#15803d', backgroundColor: 'rgba(21,128,61,0.2)' },
    ],
  }), [sessions]);

  if (!token || !user) {
    return (
      <main className="min-h-screen bg-slate-100 px-4 py-10">
        <section className="mx-auto max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">CodeCollab</h1>
          <p className="mt-2 text-sm text-slate-600">AI-assisted real-time interview room.</p>
          <div className="mt-6 flex gap-2 text-sm">
            <button className={`rounded px-3 py-1.5 ${mode === 'login' ? 'bg-slate-900 text-white' : 'bg-slate-200'}`} onClick={() => setMode('login')}>Login</button>
            <button className={`rounded px-3 py-1.5 ${mode === 'register' ? 'bg-slate-900 text-white' : 'bg-slate-200'}`} onClick={() => setMode('register')}>Register</button>
          </div>
          <div className="mt-4 space-y-3">
            {mode === 'register' ? <input className="w-full rounded border p-2" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} /> : null}
            <input className="w-full rounded border p-2" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
            <input className="w-full rounded border p-2" type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
            {mode === 'register' ? (
              <select className="w-full rounded border p-2" value={role} onChange={(e) => setRole(e.target.value as 'interviewer' | 'candidate')}>
                <option value="candidate">Candidate</option>
                <option value="interviewer">Interviewer</option>
              </select>
            ) : null}
          </div>
          {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}
          <button className="mt-4 w-full rounded bg-sky-700 px-4 py-2 text-white disabled:opacity-60" onClick={submitAuth} disabled={loading}>
            {loading ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-100 p-4 md:p-8">
      <section className="mx-auto max-w-6xl space-y-5">
        <header className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">CodeCollab Dashboard</h1>
              <p className="text-sm text-slate-600">Signed in as {user.name} ({user.role})</p>
            </div>
            <button className="rounded bg-slate-900 px-3 py-2 text-sm text-white" onClick={() => { setToken(null); updateToken(null); setUser(null); }}>
              Sign Out
            </button>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-2">
          <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-medium text-slate-900">Create Room</h2>
            <div className="mt-3 space-y-3">
              <input className="w-full rounded border p-2" value={roomTitle} onChange={(e) => setRoomTitle(e.target.value)} placeholder="Room title" />
              <select className="w-full rounded border p-2" value={roomLanguage} onChange={(e) => setRoomLanguage(e.target.value)}>
                <option value="javascript">JavaScript</option><option value="typescript">TypeScript</option><option value="python">Python</option><option value="java">Java</option><option value="cpp">C++</option>
              </select>
              <button className="rounded bg-sky-700 px-4 py-2 text-white" onClick={createRoom}>Start Interview Room</button>
            </div>
          </article>

          <article className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
            <h2 className="text-lg font-medium text-slate-900">Recent Sessions</h2>
            <div className="mt-3 h-56"><Line data={chartData} options={{ maintainAspectRatio: false, responsive: true }} /></div>
          </article>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-medium text-slate-900">Rooms</h2>
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {rooms.map((room) => (
              <div key={room.id} className="rounded border border-slate-200 p-3">
                <p className="font-medium text-slate-900">{room.title}</p>
                <p className="text-sm text-slate-600">Language: {room.language}</p>
                <Link className="mt-2 inline-block text-sm text-sky-700" href={`/room/${room.id}`}>Open Room</Link>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h2 className="text-lg font-medium text-slate-900">Session Replay</h2>
          <div className="mt-3 space-y-2">
            {sessions.length === 0 ? (
              <p className="text-sm text-slate-600">No session data yet.</p>
            ) : (
              sessions.map((session) => (
                <div key={session.id} className="flex items-center justify-between rounded border border-slate-200 p-3">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{session.room_title}</p>
                    <p className="text-xs text-slate-600">
                      {new Date(session.created_at).toLocaleString()} | Complexity {session.complexity_score} | Quality {session.quality_score}
                    </p>
                  </div>
                  <Link className="text-sm text-sky-700" href={`/session/${session.id}`}>Replay</Link>
                </div>
              ))
            )}
          </div>
        </section>
      </section>
    </main>
  );
}
