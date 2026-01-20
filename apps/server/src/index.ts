import express, { Request, Response } from 'express';
import cors from 'cors';
import multer from 'multer';
import { nanoid } from 'nanoid';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import path from 'path';
import fs from 'fs';
import archiver from 'archiver';

type FileMeta = {
  id: string;
  name: string;
  size: number;
  type: string;
  path?: string; // Add path to stored file
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

// Create uploads directory if it doesn't exist
const uploadsDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const sessionId = req.body.sessionId || 'temp';
    const sessionDir = path.join(uploadsDir, sessionId);
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
    }
    cb(null, sessionDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage });

const app = express();
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(uploadsDir));

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ ok: true });
});

// Debug endpoint to list all sessions
app.get('/api/debug/sessions', (_req: Request, res: Response) => {
  const sessionList = Array.from(sessions.entries()).map(([id, session]) => ({
    id,
    pin: session.pin,
    deviceName: session.deviceName,
    status: session.status,
    expiresAt: session.expiresAt,
    fileCount: session.files.length,
    files: session.files.map(f => ({ id: f.id, name: f.name, hasPath: !!f.path }))
  }));
  res.json({ sessions: sessionList, total: sessionList.length });
});

// Upload files first, then create session
app.post('/api/upload', upload.array('files'), (req: Request, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files || files.length === 0) {
      return res.status(400).json({ message: 'No files uploaded' });
    }

    const filesMeta: FileMeta[] = files.map((file, index) => ({
      id: `${file.originalname}-${file.size}-${index}`,
      name: file.originalname,
      size: file.size,
      type: file.mimetype,
      path: file.path
    }));

    // Store temporary session data
    const tempSessionId = nanoid(12);
    sessions.set(tempSessionId, {
      id: tempSessionId,
      pin: '',
      deviceName: '',
      expiresAt: Date.now() + 300000, // 5 minutes for temp session
      status: 'pending',
      files: filesMeta
    });

    res.json({
      tempSessionId,
      files: filesMeta
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ message: 'Upload failed' });
  }
});

app.post('/api/session', (req: Request, res: Response) => {
  const { deviceName, tempSessionId, expirySeconds = 600 } = req.body as {
    deviceName: string;
    tempSessionId: string;
    expirySeconds: number;
  };

  const tempSession = sessions.get(tempSessionId);
  if (!tempSession || !tempSession.files.length) {
    return res.status(400).json({ message: 'No files found. Upload files first.' });
  }

  const pin = generatePin();
  const expiresAt = Date.now() + expirySeconds * 1000;

  const record: SessionRecord = {
    id: tempSessionId,
    pin,
    deviceName,
    expiresAt,
    status: 'ready',
    files: tempSession.files
  };

  sessions.set(tempSessionId, record);
  pinIndex.set(pin, tempSessionId);

  // Remove temp session status
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

// Download individual file
app.get('/api/download/:sessionId/:fileId', (req: Request, res: Response) => {
  const { sessionId, fileId } = req.params;
  
  const session = sessions.get(sessionId);
  if (!session) return res.status(404).json({ message: 'Session not found' });
  
  if (session.expiresAt < Date.now()) {
    return res.status(410).json({ message: 'Session expired' });
  }
  
  const file = session.files.find(f => f.id === fileId);
  if (!file || !file.path) return res.status(404).json({ message: 'File not found' });
  
  // Check if file exists
  if (!fs.existsSync(file.path)) {
    return res.status(404).json({ message: 'File not found on server' });
  }
  
  // Set headers for file download
  res.setHeader('Content-Type', file.type);
  res.setHeader('Content-Disposition', `attachment; filename="${file.name}"`);
  res.setHeader('Content-Length', file.size.toString());
  
  // Stream the file
  const fileStream = fs.createReadStream(file.path);
  fileStream.pipe(res);
  
  fileStream.on('error', (error) => {
    console.error('File stream error:', error);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Error serving file' });
    }
  });
});

// Download all files as zip
app.get('/api/download/:sessionId/all', (req: Request, res: Response) => {
  const { sessionId } = req.params;
  
  console.log('Download request for session:', sessionId); // Debug log
  
  const session = sessions.get(sessionId);
  if (!session) {
    console.log('Session not found:', sessionId); // Debug log
    return res.status(404).json({ message: 'Session not found' });
  }
  
  if (session.expiresAt < Date.now()) {
    return res.status(410).json({ message: 'Session expired' });
  }
  
  // Filter files that actually exist on disk
  const existingFiles = session.files.filter(file => file.path && fs.existsSync(file.path));
  
  if (existingFiles.length === 0) {
    return res.status(404).json({ message: 'No files found to download' });
  }
  
  // Set headers for zip download
  res.setHeader('Content-Type', 'application/zip');
  res.setHeader('Content-Disposition', `attachment; filename="files-${sessionId}.zip"`);
  
  // Create zip archive
  const archive = archiver('zip', { zlib: { level: 9 } });
  
  archive.on('error', (err) => {
    console.error('Archive error:', err);
    if (!res.headersSent) {
      res.status(500).json({ message: 'Error creating zip file' });
    }
  });
  
  archive.pipe(res);
  
  // Add each file to the zip
  existingFiles.forEach((file) => {
    if (file.path) {
      archive.file(file.path, { name: file.name });
    }
  });
  
  archive.finalize();
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
