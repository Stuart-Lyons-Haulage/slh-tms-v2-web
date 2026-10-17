import { useEffect, useMemo, useState } from 'react';
import { request } from '../lib/api';
import { useAccessToken } from '../lib/auth';
import { connectSignalRJson } from '../lib/signalRJson';
import './BackloadMatchNotifications.css';

type MatrixPoint = { latitude: number; longitude: number };

type BackloadMatch = {
  orderId: string;
  orderReference: string;
  collectionPointName: string;
  collectionPoint: MatrixPoint;
  deliveryPointName: string;
  deliveryPoint: MatrixPoint;
  palletCount: number;
  estimatedCollectionDetourMiles: number;
  estimatedTimeToCollectionMinutes: number;
  backloadScore: number;
  reason: string;
};

type BackloadDispatchNotification = {
  loadId: string;
  vehicleReg: string;
  driverName: string;
  currentPosition: MatrixPoint;
  matches: BackloadMatch[];
};

type BackloadCard = BackloadMatch & {
  loadId: string;
  vehicleReg: string;
  driverName: string;
  currentPosition: MatrixPoint;
};

type DeclineReason = '' | 'capacity' | 'timing' | 'customer instruction' | 'other';

function cardKey(card: Pick<BackloadCard, 'loadId' | 'orderId'>) {
  return `${card.loadId}:${card.orderId}`;
}

export function BackloadMatchNotifications() {
  const accessToken = useAccessToken();
  const [cards, setCards] = useState<BackloadCard[]>([]);
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [declineReasons, setDeclineReasons] = useState<Record<string, DeclineReason>>({});

  useEffect(() => {
    const subscription = connectSignalRJson<BackloadDispatchNotification>({
      hubPath: '/dispatch-hub',
      target: 'BackloadMatches',
      accessToken,
      onStatus: setConnected,
      onError: error => console.warn('Backload SignalR connection issue.', error),
      onMessage: notification => {
        if (!notification?.loadId || !Array.isArray(notification.matches)) return;
        setCards(current => {
          const next = new Map(current.map(card => [cardKey(card), card]));
          for (const match of notification.matches) {
            const card: BackloadCard = {
              ...match,
              loadId: notification.loadId,
              vehicleReg: notification.vehicleReg,
              driverName: notification.driverName,
              currentPosition: notification.currentPosition
            };
            next.set(cardKey(card), card);
          }
          return Array.from(next.values()).sort((a, b) => b.backloadScore - a.backloadScore);
        });
      }
    });
    return () => subscription.close();
  }, [accessToken]);

  const title = useMemo(() => cards.length === 1 ? '1 backload opportunity' : `${cards.length} backload opportunities`, [cards.length]);
  if (cards.length === 0) return null;

  const remove = (key: string) => setCards(current => current.filter(card => cardKey(card) !== key));

  const accept = async (card: BackloadCard) => {
    const key = cardKey(card);
    setBusy(current => ({ ...current, [key]: true }));
    setErrors(current => ({ ...current, [key]: '' }));
    try {
      const token = await accessToken();
      await request('/api/dispatch/accept-backload', token, {
        method: 'POST',
        body: JSON.stringify({ loadId: card.loadId, orderId: card.orderId })
      });
      remove(key);
    } catch (error) {
      setErrors(current => ({ ...current, [key]: error instanceof Error ? error.message : 'Could not accept this backload.' }));
    } finally {
      setBusy(current => ({ ...current, [key]: false }));
    }
  };

  const decline = async (card: BackloadCard) => {
    const key = cardKey(card);
    const reason = declineReasons[key] || '';
    if (!reason) {
      setErrors(current => ({ ...current, [key]: 'Choose a decline reason first.' }));
      return;
    }
    setBusy(current => ({ ...current, [key]: true }));
    setErrors(current => ({ ...current, [key]: '' }));
    try {
      const token = await accessToken();
      await request('/api/dispatch/decline-backload', token, {
        method: 'POST',
        body: JSON.stringify({ loadId: card.loadId, orderId: card.orderId, reason })
      });
      remove(key);
    } catch (error) {
      setErrors(current => ({ ...current, [key]: error instanceof Error ? error.message : 'Could not decline this backload.' }));
    } finally {
      setBusy(current => ({ ...current, [key]: false }));
    }
  };

  return <section className="backload-opportunities" aria-live="polite">
    <div className="backload-opportunities__header">
      <div>
        <p>Return-load intelligence</p>
        <h2>{title}</h2>
      </div>
      <span className={`backload-opportunities__live ${connected ? 'is-live' : ''}`}>{connected ? 'Live' : 'Reconnecting'}</span>
    </div>
    <div className="backload-opportunities__grid">
      {cards.map(card => {
        const key = cardKey(card);
        return <article className="backload-card" key={key}>
          <button className="backload-card__dismiss" type="button" onClick={() => remove(key)} aria-label={`Dismiss ${card.orderReference}`}>×</button>
          <div className="backload-card__topline">
            <span className="backload-card__score">Score {card.backloadScore.toFixed(1)}</span>
            <strong>{card.orderReference}</strong>
          </div>
          <h3>{card.collectionPointName} → {card.deliveryPointName}</h3>
          <p className="backload-card__reason">{card.reason}</p>
          <dl className="backload-card__facts">
            <div><dt>Vehicle</dt><dd>{card.vehicleReg}</dd></div>
            <div><dt>Driver</dt><dd>{card.driverName}</dd></div>
            <div><dt>Collection detour</dt><dd>{card.estimatedCollectionDetourMiles.toFixed(1)} mi</dd></div>
            <div><dt>Time to collection</dt><dd>{card.estimatedTimeToCollectionMinutes} min</dd></div>
            <div><dt>Pallets</dt><dd>{card.palletCount}</dd></div>
          </dl>
          {errors[key] && <p className="backload-card__error" role="alert">{errors[key]}</p>}
          <div className="backload-card__actions">
            <button type="button" className="primary" disabled={busy[key]} onClick={() => void accept(card)}>{busy[key] ? 'Working…' : 'Accept'}</button>
            <select
              aria-label={`Decline reason for ${card.orderReference}`}
              value={declineReasons[key] || ''}
              disabled={busy[key]}
              onChange={event => setDeclineReasons(current => ({ ...current, [key]: event.target.value as DeclineReason }))}
            >
              <option value="">Decline reason…</option>
              <option value="capacity">Capacity</option>
              <option value="timing">Timing</option>
              <option value="customer instruction">Customer instruction</option>
              <option value="other">Other</option>
            </select>
            <button type="button" disabled={busy[key]} onClick={() => void decline(card)}>Decline</button>
          </div>
        </article>;
      })}
    </div>
  </section>;
}
