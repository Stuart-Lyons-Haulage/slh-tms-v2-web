import { apiBaseUrl } from './api';

const recordSeparator = '\u001e';

type SignalRFrame = {
  type: number;
  target?: string;
  arguments?: unknown[];
  [key: string]: unknown;
};

type NegotiateResponse = {
  connectionToken?: string;
  connectionId?: string;
  availableTransports?: Array<{ transport?: string }>;
  error?: string;
};

export type SignalRSubscription = {
  close(): void;
};

export type SignalRJsonOptions<T> = {
  hubPath: string;
  target: string;
  accessToken: () => Promise<string>;
  onMessage: (payload: T) => void;
  onStatus?: (connected: boolean) => void;
  onError?: (error: Error) => void;
};

function apiUrl(path: string) {
  const base = new URL(apiBaseUrl || '/', window.location.origin);
  const basePath = base.pathname.replace(/\/$/, '');
  return new URL(`${basePath}${path.startsWith('/') ? path : `/${path}`}`, base.origin);
}

function websocketUrl(httpUrl: URL, token: string, connectionToken: string) {
  const url = new URL(httpUrl.toString());
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  url.searchParams.set('id', connectionToken);
  url.searchParams.set('access_token', token);
  return url.toString();
}

function frames(data: string): SignalRFrame[] {
  const messages: SignalRFrame[] = [];
  for (const raw of data.split(recordSeparator)) {
    const text = raw.trim();
    if (!text) continue;
    try {
      const parsed = JSON.parse(text) as SignalRFrame;
      if (typeof parsed === 'object' && parsed !== null && typeof parsed.type === 'number') messages.push(parsed);
    } catch {
      // SignalR's empty handshake response is `{}` and deliberately has no frame type.
    }
  }
  return messages;
}

export function connectSignalRJson<T>(options: SignalRJsonOptions<T>): SignalRSubscription {
  let closed = false;
  let socket: WebSocket | undefined;
  let reconnectTimer: number | undefined;
  let reconnectAttempt = 0;
  let connectGeneration = 0;

  const reportError = (error: unknown) => {
    const resolved = error instanceof Error ? error : new Error(String(error));
    options.onError?.(resolved);
  };

  const scheduleReconnect = () => {
    if (closed || reconnectTimer !== undefined) return;
    options.onStatus?.(false);
    const delay = Math.min(30_000, 2_000 * 2 ** Math.min(reconnectAttempt, 4));
    reconnectAttempt += 1;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = undefined;
      void connect();
    }, delay);
  };

  const connect = async () => {
    if (closed) return;
    const generation = ++connectGeneration;
    try {
      const token = await options.accessToken();
      if (closed || generation !== connectGeneration) return;
      const negotiate = apiUrl(`${options.hubPath.replace(/\/$/, '')}/negotiate`);
      negotiate.searchParams.set('negotiateVersion', '1');
      const response = await fetch(negotiate, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token}`
        }
      });
      if (!response.ok) throw new Error(`SignalR negotiate failed (${response.status}).`);
      const result = await response.json() as NegotiateResponse;
      if (result.error) throw new Error(result.error);
      const connectionToken = result.connectionToken || result.connectionId;
      if (!connectionToken) throw new Error('SignalR negotiate did not return a connection token.');
      if (result.availableTransports && !result.availableTransports.some(item => item.transport === 'WebSockets'))
        throw new Error('SignalR WebSockets transport is unavailable.');
      if (closed || generation !== connectGeneration) return;

      const hub = apiUrl(options.hubPath);
      const nextSocket = new WebSocket(websocketUrl(hub, token, connectionToken));
      socket = nextSocket;

      nextSocket.onopen = () => {
        if (closed || socket !== nextSocket) return;
        nextSocket.send(`${JSON.stringify({ protocol: 'json', version: 1 })}${recordSeparator}`);
        reconnectAttempt = 0;
        options.onStatus?.(true);
      };
      nextSocket.onmessage = event => {
        if (closed || socket !== nextSocket || typeof event.data !== 'string') return;
        for (const frame of frames(event.data)) {
          if (frame.type !== 1 || frame.target !== options.target) continue;
          const payload = frame.arguments?.[0] as T | undefined;
          if (payload !== undefined) options.onMessage(payload);
        }
      };
      nextSocket.onerror = () => reportError(new Error('SignalR WebSocket connection failed.'));
      nextSocket.onclose = () => {
        if (socket === nextSocket) socket = undefined;
        scheduleReconnect();
      };
    } catch (error) {
      reportError(error);
      scheduleReconnect();
    }
  };

  void connect();

  return {
    close() {
      closed = true;
      connectGeneration += 1;
      if (reconnectTimer !== undefined) window.clearTimeout(reconnectTimer);
      reconnectTimer = undefined;
      options.onStatus?.(false);
      const current = socket;
      socket = undefined;
      if (current && current.readyState < WebSocket.CLOSING) current.close(1000, 'TMS view closed');
    }
  };
}
