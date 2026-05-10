import { useEffect, useState } from 'react';
import { useWs } from './useWs.ts';
import type { WsStatus } from '../lib/ws.ts';

export function useWsStatus(): WsStatus {
  const ws = useWs();
  const [status, setStatus] = useState<WsStatus>(ws.getStatus());
  useEffect(() => ws.onStatus(setStatus), [ws]);
  return status;
}
