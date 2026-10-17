import type { WebSocketRoute } from '@playwright/test';
export function realtimeFeed() {
  type Subscription = { socket: WebSocketRoute; topic: string; id: number; table: string; joinRef: string };
  const subscriptions: Subscription[] = [];
  let sequence = 0;
  const send = (socket: WebSocketRoute, frame: { join_ref?: string; ref?: string; topic: string; event: string; payload: unknown }) =>
    socket.send(JSON.stringify([frame.join_ref || null, frame.ref || null, frame.topic, frame.event, frame.payload]));
  const connect = (socket: WebSocketRoute) => {
    if (!socket.url().includes('kzrnyjsosryejjejliii.supabase.co/realtime/')) { socket.close(); return; }
    socket.onMessage(raw => {
      // The installed Supabase client uses Phoenix serializer v2 tuples.
      const [join_ref, ref, topic, event, payload] = JSON.parse(String(raw));
      const frame = { join_ref, ref, topic, event, payload };
      if (frame.event === 'phx_join') {
        const filters = (frame.payload.config?.postgres_changes || []) as { table: string; event: string; schema: string }[];
        const changes = filters.map(filter => {
          const id = ++sequence;
          subscriptions.push({ socket, topic: frame.topic, id, table: filter.table, joinRef: frame.join_ref });
          return { ...filter, id };
        });
        send(socket, { event: 'phx_reply', topic: frame.topic, ref: frame.ref, join_ref: frame.join_ref,
          payload: { status: 'ok', response: { postgres_changes: changes } } });
      } else if (frame.event === 'heartbeat' || frame.event === 'phx_leave') {
        send(socket, { event: 'phx_reply', topic: frame.topic, ref: frame.ref, payload: { status: 'ok', response: {} } });
        if (frame.event === 'phx_leave') for (let index = subscriptions.length - 1; index >= 0; index--) {
          if (subscriptions[index].socket === socket && subscriptions[index].topic === frame.topic) subscriptions.splice(index, 1);
        }
      }
    });
    socket.onClose(() => {
      for (let index = subscriptions.length - 1; index >= 0; index--) if (subscriptions[index].socket === socket) subscriptions.splice(index, 1);
    });
  };
  return { connect, subscriptions, publish(table: string, record: Record<string, unknown>) {
    for (const subscription of subscriptions.filter(entry => entry.table === table)) {
      send(subscription.socket, { topic: subscription.topic, event: 'postgres_changes', join_ref: subscription.joinRef,
        payload: { ids: [subscription.id], data: { schema: 'public', table, type: 'UPDATE',
          columns: Object.keys(record).map(name => ({ name, type: name === 'revision' ? 'int8' : 'text' })),
          record, old_record: {}, errors: null, commit_timestamp: new Date().toISOString() } } });
    }
  } };
}
