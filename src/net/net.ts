/** Thin WebRTC wrapper (PeerJS) for the 2-player race. One peer hosts (gets a
 * short code), the other joins with it. After connect, game data flows directly
 * peer-to-peer; only the handshake uses PeerJS's free broker. */
import { Peer, type DataConnection } from "peerjs";

export type NetMsg =
  | { t: "cfg"; level: number; edits: unknown }
  | { t: "go"; }
  | { t: "p"; x: number; y: number; bx: number; by: number }
  | { t: "fin"; ms: number };

const CODE_PREFIX = "CRBAL-";
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCode(n = 4): string {
  let s = "";
  for (let i = 0; i < n; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

export class Net {
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  code = "";
  onOpen: () => void = () => {};
  onData: (msg: NetMsg) => void = () => {};
  onClose: () => void = () => {};

  /** Become host; resolves with the short code to share. Retries on ID clash. */
  host(attempt = 0): Promise<string> {
    return new Promise((resolve, reject) => {
      const code = randomCode();
      const peer = new Peer(CODE_PREFIX + code);
      this.peer = peer;
      peer.on("open", () => { this.code = code; resolve(code); });
      peer.on("connection", (c) => this.bind(c));
      peer.on("error", (e: any) => {
        if (e?.type === "unavailable-id" && attempt < 5) {
          peer.destroy();
          this.host(attempt + 1).then(resolve, reject);
        } else if (this.code === "") {
          reject(e);
        }
      });
    });
  }

  /** Join an existing host by code. Resolves once the data channel opens. */
  join(code: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const peer = new Peer();
      this.peer = peer;
      peer.on("open", () => {
        const conn = peer.connect(CODE_PREFIX + code.trim().toUpperCase(), { reliable: true });
        this.bind(conn);
        conn.on("open", () => resolve());
      });
      peer.on("error", (e: any) => reject(e));
    });
  }

  private bind(conn: DataConnection) {
    this.conn = conn;
    conn.on("open", () => this.onOpen());
    conn.on("data", (d) => this.onData(d as NetMsg));
    conn.on("close", () => this.onClose());
  }

  send(msg: NetMsg) {
    try { if (this.conn?.open) this.conn.send(msg); } catch { /* ignore */ }
  }
  get connected() { return !!this.conn?.open; }
  destroy() { try { this.conn?.close(); this.peer?.destroy(); } catch { /* ignore */ } }
}
