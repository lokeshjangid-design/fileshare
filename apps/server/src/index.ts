import express, { Request, Response } from 'express';
import cors from 'cors';
import { nanoid } from 'nanoid';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';

type FileMeta = {
  id: string;
  name: string;
  size: number;
  type: string;
};

type SessionRecord = {
  id: string;
  pin: string;
  deviceName: string;
  expiresAt: number;
  status: 'pending' | 'ready' | 'expired';
  files: FileMeta[];
};

const sessions = new Map<string, SessionRecord>();
const pinIndex = new Map<string, string>();

const app = express();
app.use(cors());
app.use(express.json());

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

app.post('/api/session', (req: Request, res: Response) => {
  const { deviceName, files, expirySeconds = 600 } = req.body as {
    deviceName: string;
    files: FileMeta[];
    expirySeconds: number;
  };

  if (!files?.length) {
    return res.status(400).json({ message: 'Files metadata required' });
  }

  const id = nanoid(12);
  const pin = generatePin();
  const expiresAt = Date.now() + expirySeconds * 1000;

  const record: SessionRecord = {
    id,
    pin,
    deviceName,
    expiresAt,
    status: 'pending',
    files,
  };

  sessions.set(id, record);
  pinIndex.set(pin, id);

  res.json(record);
});

app.get('/api/session/by-pin/:pin', (req: Request, res: Response) => {
  const { pin } = req.params as { pin: string };
  const sessionId = pinIndex.get(pin);
  if (!sessionId) return res.status(404).json({ message: 'Session not found' });

  const record = sessions.get(sessionId);
  if (!record) return res.status(404).json({ message: 'Session not found' });

  if (record.expiresAt < Date.now()) {
    record.status = 'expired';
    return res.status(410).json({ message: 'Session expired' });
  }

  res.json(record);
});

const httpServer = createServer(app);
const wss = new WebSocketServer({ server: httpServer, path: '/ws' });

wss.on('connection', (socket: WebSocket) => {
  socket.on('message', (data: Buffer) => {
    wss.clients.forEach((client) => {
      if (client !== socket && client.readyState === WebSocket.OPEN) {
        client.send(data);
      }
    });
  });
});

const PORT = process.env.PORT ?? 4000;
httpServer.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});

function generatePin() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}
