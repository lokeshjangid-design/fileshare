# Cloudbeam Share – Architecture Overview

## Objectives
- Cross-network, cross-device file exchange without shared Wi-Fi/IP.
- Cloudflare-first infrastructure (Workers, Durable Objects, R2, WebRTC/WebSockets).
- Simple sender/receiver UX with codes or QR.

## Components
1. **Frontend (React + Vite + Tailwind)**
   - PWA-ready SPA with Sender/Receiver flows.
   - Zustand store managing session state, theme, and transfer progress.
   - Uses WebRTC/WebSocket clients and signed URLs for R2.

2. **Edge Backend**
   - **Cloudflare Worker** exposes REST + WebSocket endpoints:
     - `POST /api/session` → creates transfer session, generates 6-digit pin + QR payload, returns ephemeral key + upload slots.
     - `POST /api/session/:id/files` → obtains signed R2 URLs per chunk.
     - `GET /api/session/:pin` → receiver lookup, verifying password/expiry, returning manifest + signaling info.
   - **Durable Object (SessionCoordinator)** handles:
     - Session lifecycle, expiry timers, password hashing.
     - WebRTC signaling via `offer/answer` exchange.
     - Progress broadcasts via `broadcast()` to connected clients.
   - **R2 Bucket** stores encrypted file chunks. Object metadata captures checksums + expiry TTL.
   - **KV / D1** optional for analytics/history. Not required for MVP.

3. **Supporting Jobs**
   - Scheduled Worker cleans expired sessions, deletes manifests, triggers R2 lifecycle delete.

## Data Model (MVP)
```ts
Session {
  id: string;
  pin: string; // 6 digits
  qrPayload: string; // base64 JSON { sessionId, secret }
  expiresAt: number;
  passwordHash?: string;
  senderDevice?: string;
  files: Array<{
    id: string;
    name: string;
    size: number;
    type: string;
    chunks: number;
    checksum: string;
  }>;
  status: 'pending' | 'uploading' | 'ready' | 'completed' | 'expired';
}
```

## API Surface
- `POST /api/session` → `{ filesMeta[], password? }` → `{ sessionId, pin, qrPayload, rtcConfig, uploadUrls[] }`
- `POST /api/session/:id/chunk` → body chunk forwarded to R2 (streamed) or returns signed URL.
- `POST /api/session/:id/offer` / `/answer` for WebRTC signaling.
- `GET /api/session/:pin` → manifest for receiver.
- `POST /api/session/:id/complete` → mark ready for download.

## Security
- Client-side AES-GCM encryption with derived key encoded in QR/pin payload.
- Pins expire in 10 minutes by default; manual expiry options propagate to Durable Object TTL.
- Password option hashed via PBKDF2 before storing.
- Rate limiting per IP/device via Worker fetch metadata.

## Performance
- Chunked uploads (default 6 MB) with up to 6 parallel requests.
- WebRTC prioritized for direct streaming; fallback to R2 downloads (signed URLs with range support).
- Progressive download UI with resume by tracking chunk indexes per file.

## Roadmap
1. MVP signaling + R2 stub (no encryption) for demo.
2. Add encryption, password, QR.
3. Implement auto-delete cron + history view.
4. Harden with monitoring + analytics.
