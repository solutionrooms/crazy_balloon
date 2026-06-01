/** WebRTC wrapper (PeerJS) for the 2-player race — same approach as landitar:
 * broker-assigned peer IDs, a reliable channel for game events + a separate
 * unreliable "fast" channel for position. Only the handshake uses the broker;
 * game data then flows directly peer-to-peer. */
import Peer, { type DataConnection } from "peerjs";

export type NetMsg =
  | { t: "cfg"; level: number; edits: unknown }
  | { t: "go" }
  | { t: "p"; x: number; y: number; bx: number; by: number }
  | { t: "fin"; ms: number };

export class Net {
  private peer: Peer | null = null;
  private dataConn: DataConnection | null = null; // reliable: events
  private fastConn: DataConnection | null = null; // unreliable: position
  id = "";
  onOpen: () => void = () => {};
  onData: (m: NetMsg) => void = () => {};
  onClose: () => void = () => {};

  /** Host: resolves with our broker peer-id (share it as a link/code). */
  host(): Promise<string> {
    return new Promise((resolve, reject) => {
      const peer = new Peer();
      this.peer = peer;
      peer.on("open", (id) => { this.id = id; resolve(id); });
      peer.on("error", (e) => { if (!this.id) reject(e); });
      peer.on("connection", (conn) => {
        if (conn.label === "fast" || (conn as any).reliable === false) {
          this.fastConn = conn; this.bind(conn);
        } else {
          this.dataConn = conn; this.bind(conn);
          conn.on("open", () => this.onOpen());
        }
      });
    });
  }

  /** Join an existing host by peer-id. Resolves once the reliable channel opens. */
  join(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const peer = new Peer();
      this.peer = peer;
      peer.on("open", () => {
        const dc = peer.connect(id.trim(), { reliable: true });
        const fc = peer.connect(id.trim(), { reliable: false, label: "fast" });
        this.dataConn = dc; this.fastConn = fc;
        this.bind(dc); this.bind(fc);
        dc.on("open", () => { this.onOpen(); resolve(); });
      });
      peer.on("error", (e) => reject(e));
    });
  }

  private bind(conn: DataConnection) {
    conn.on("data", (d) => this.onData(d as NetMsg));
    conn.on("close", () => this.onClose());
  }

  send(msg: NetMsg) {
    try {
      if (msg.t === "p" && this.fastConn?.open) { this.fastConn.send(msg); return; }
      if (this.dataConn?.open) this.dataConn.send(msg);
    } catch { /* ignore */ }
  }
  get connected() { return !!this.dataConn?.open; }
  destroy() { try { this.dataConn?.close(); this.fastConn?.close(); this.peer?.destroy(); } catch { /* ignore */ } }
}
