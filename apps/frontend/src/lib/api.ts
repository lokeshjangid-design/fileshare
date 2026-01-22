const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL?.replace(/\/$/, '') ?? 'http://localhost:8787';

export type SessionFileMeta = {
  id: string;
  name: string;
  size: number;
  type: string;
};

export type SessionRecord = {
  id: string;
  pin: string;
  status: 'pending' | 'uploading' | 'ready' | 'completed' | 'expired';
  deviceName: string;
  expiresAt: number;
  files: SessionFileMeta[];
  requiresPassword: boolean;
};

export type CreateSessionPayload = {
  deviceName: string;
  expirySeconds: number;
  password?: string;
  files: SessionFileMeta[];
};

async function handleJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  const data = text ? JSON.parse(text) : undefined;
  if (!response.ok) {
    const message =
      data && typeof data === 'object' && 'message' in data
        ? String((data as Record<string, unknown>).message)
        : 'Request failed';
    throw new Error(message);
  }
  return (data as T) ?? ({} as T);
}

export async function createSession(payload: CreateSessionPayload): Promise<SessionRecord> {
  const response = await fetch(`${API_BASE_URL}/api/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  return handleJson<SessionRecord>(response);
}

export async function lookupSessionByPin(pin: string): Promise<SessionRecord> {
  const response = await fetch(`${API_BASE_URL}/api/session/by-pin/${pin}`);
  return handleJson<SessionRecord>(response);
}

const CHUNK_SIZE = 32 * 1024 * 1024; // 32 MB per chunk for higher throughput
const MAX_CONCURRENCY = 6; // number of parallel chunk uploads

export async function uploadFiles(files: File[], pin: string, onProgress: (progress: number) => void) {
  const totalSize = files.reduce((acc, file) => acc + file.size, 0);
  const useChunked = totalSize > 25 * 1024 * 1024;

  if (!useChunked) {
    return uploadFilesLegacy(files, pin, onProgress);
  }

  return uploadFilesChunked(files, pin, onProgress);
}
