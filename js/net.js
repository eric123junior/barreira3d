// Conexão online sem servidor próprio: usa brokers MQTT públicos via WebSocket.
// Conecta em mais de um broker ao mesmo tempo e envia para todos; mensagens
// repetidas são descartadas pelo par (remetente, sequência).

const BROKERS = [
  'wss://broker.emqx.io:8084/mqtt',
  'wss://broker.hivemq.com:8884/mqtt',
];
const TOPIC_PREFIX = 'barreira3d-jogo/v1/';

export function randomId(len = 10) {
  const a = 'abcdefghijkmnpqrstuvwxyz23456789';
  let s = '';
  const buf = crypto.getRandomValues(new Uint8Array(len));
  for (const b of buf) s += a[b % a.length];
  return s;
}

export function randomRoomCode() {
  const a = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let s = '';
  const buf = crypto.getRandomValues(new Uint8Array(5));
  for (const b of buf) s += a[b % a.length];
  return s;
}

export class Net {
  constructor(room, onMessage, onStatus) {
    this.id = randomId();
    this.topic = TOPIC_PREFIX + room;
    this.onMessage = onMessage;
    this.onStatus = onStatus || (() => {});
    this.clients = [];
    this.seq = 0;
    this.seen = new Map();
    this.closed = false;
  }

  connect() {
    if (!window.mqtt) {
      this.onStatus('error', 'Não foi possível carregar a biblioteca de rede.');
      return;
    }
    for (const url of BROKERS) {
      const client = window.mqtt.connect(url, {
        clientId: 'b3d_' + this.id + '_' + randomId(4),
        clean: true,
        keepalive: 30,
        connectTimeout: 8000,
        reconnectPeriod: 2500,
      });
      client.on('connect', () => {
        client.subscribe(this.topic, { qos: 1 });
        this.onStatus('connected', this.connectedCount());
      });
      client.on('close', () => this.onStatus('disconnected', this.connectedCount()));
      client.on('error', () => {});
      client.on('message', (_t, payload) => this.handle(payload));
      this.clients.push(client);
    }
  }

  connectedCount() {
    return this.clients.filter(c => c.connected).length;
  }

  handle(payload) {
    let m;
    try { m = JSON.parse(payload.toString()); } catch { return; }
    if (!m || m.from === this.id) return;
    if (m.to && m.to !== this.id) return;
    const k = m.from + ':' + m.seq;
    if (this.seen.has(k)) return;
    this.seen.set(k, Date.now());
    if (this.seen.size > 2000) {
      const cut = Date.now() - 60000;
      for (const [kk, t] of this.seen) if (t < cut) this.seen.delete(kk);
    }
    this.onMessage(m);
  }

  send(msg) {
    if (this.closed) return;
    msg.from = this.id;
    msg.seq = ++this.seq;
    const data = JSON.stringify(msg);
    for (const c of this.clients) if (c.connected) c.publish(this.topic, data, { qos: 1 });
  }

  close() {
    this.closed = true;
    for (const c of this.clients) { try { c.end(true); } catch {} }
    this.clients = [];
  }
}
