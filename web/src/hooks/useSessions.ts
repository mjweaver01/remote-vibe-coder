import { useEffect, useState } from 'react';
import type { SessionInfo } from '../../../src/types.ts';
import { useWs } from './useWs.ts';

export function useSessions(): SessionInfo[] {
  const ws = useWs();
  const [sessions, setSessions] = useState<SessionInfo[]>(ws.getSessions());
  useEffect(() => ws.onSessions(setSessions), [ws]);
  return sessions;
}

export function useSession(id: string | undefined): SessionInfo | null {
  const list = useSessions();
  if (!id) return null;
  return list.find((s) => s.id === id) ?? null;
}
