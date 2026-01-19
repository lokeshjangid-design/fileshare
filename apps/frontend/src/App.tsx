import type { ChangeEvent, DragEvent } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  ArrowLeft,
  Check,
  Clock3,
  DownloadCloud,
  History,
  Lock,
  MonitorSmartphone,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  UploadCloud,
  Zap,
} from 'lucide-react';
import clsx from 'clsx';
import {
  createSession,
  lookupSessionByPin,
  type SessionRecord as ApiSessionRecord,
} from './lib/api';

const expiryOptions = [
  { label: '10 minutes', value: 600 },
  { label: '1 hour', value: 3600 },
  { label: 'Manual delete', value: 0 },
];

type Role = 'sender' | 'receiver' | null;

type SessionStatus = 'idle' | 'uploading' | 'ready';

const sampleReceiverManifest = {
  senderDevice: 'MacBook Pro',
  expiresIn: '9m left',
  files: [
    { id: 'doc', name: 'Brand Guidelines.pdf', size: 12_450_332 },
    { id: 'photos', name: 'Launch Photos.zip', size: 187_904_819 },
    { id: 'video', name: 'Demo.mov', size: 640_120_402 },
  ],
};

const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
};

const App = () => {
  const [theme, setTheme] = useState<'light' | 'dark'>('dark');
  const [role, setRole] = useState<Role>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [passwordEnabled, setPasswordEnabled] = useState(false);
  const [password, setPassword] = useState('');
  const [expiry, setExpiry] = useState(expiryOptions[0].value);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>('idle');
  const [progress, setProgress] = useState(0);
  const progressTimerRef = useRef<number | undefined>(undefined);
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [receiverCode, setReceiverCode] = useState('');
  const [receiverPassword, setReceiverPassword] = useState('');
  const [downloadReady, setDownloadReady] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [creatingSession, setCreatingSession] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [receiverSession, setReceiverSession] = useState<ApiSessionRecord | null>(null);
  const [receiverError, setReceiverError] = useState<string | null>(null);
  const [receiverLoading, setReceiverLoading] = useState(false);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.body.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (sessionStatus !== 'uploading') {
      window.clearInterval(progressTimerRef.current);
      return;
    }

    progressTimerRef.current = window.setInterval(() => {
      setProgress((prev) => {
        if (prev >= 100) {
          window.clearInterval(progressTimerRef.current);
          setSessionStatus('ready');
          setShareLink(`${window.location.origin}/join/${generatedCode ?? ''}`);
          return 100;
        }
        return prev + 4;
      });
    }, 180);

    return () => window.clearInterval(progressTimerRef.current);
  }, [sessionStatus, generatedCode]);

  useEffect(() => {
    setDownloadReady(Boolean(receiverSession));
  }, [receiverSession]);

  useEffect(() => {
    if (receiverCode.length !== 6) {
      setReceiverSession(null);
      setReceiverError(null);
      setReceiverLoading(false);
      return;
    }

    let cancelled = false;
    setReceiverLoading(true);
    lookupSessionByPin(receiverCode)
      .then((record) => {
        if (cancelled) return;
        setReceiverSession(record);
        setReceiverError(null);
      })
      .catch((error) => {
        if (cancelled) return;
        setReceiverSession(null);
        setReceiverError(error instanceof Error ? error.message : 'Lookup failed');
      })
      .finally(() => {
        if (!cancelled) {
          setReceiverLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [receiverCode]);

  const totalSize = useMemo(
    () => selectedFiles.reduce((acc, file) => acc + file.size, 0),
    [selectedFiles]
  );

  const deviceName = useMemo(() => {
    if (typeof navigator === 'undefined') return 'This device';
    const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
    if (nav.userAgentData?.platform) {
      return nav.userAgentData.platform;
    }
    if (navigator.userAgent.includes('iPhone')) return 'iPhone';
    if (navigator.userAgent.includes('Android')) return 'Android Device';
    if (navigator.userAgent.includes('Mac')) return 'MacBook';
    if (navigator.userAgent.includes('Win')) return 'Windows PC';
    return 'This device';
  }, []);

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    setSelectedFiles(Array.from(files));
    setSessionStatus('idle');
    setGeneratedCode(null);
    setShareLink(null);
    setProgress(0);
  };

  const handleDrop = (event: DragEvent<HTMLLabelElement>) => {
    event.preventDefault();
    setDragActive(false);
    handleFiles(event.dataTransfer.files);
  };

  const handleGenerateSession = async () => {
    if (!selectedFiles.length || creatingSession) return;
    setSessionError(null);
    setCreatingSession(true);
    try {
      const filesMeta = selectedFiles.map((file, index) => ({
        id: `${file.name}-${file.lastModified}-${index}`,
        name: file.name,
        size: file.size,
        type: file.type,
      }));

      const record = await createSession({
        deviceName,
        expirySeconds: expiry === 0 ? 3600 : expiry,
        password: passwordEnabled && password ? password : undefined,
        files: filesMeta,
      });

      setGeneratedCode(record.pin);
      setSessionStatus('uploading');
    } catch (error) {
      setSessionError(error instanceof Error ? error.message : 'Failed to create session');
    } finally {
      setCreatingSession(false);
    }
  };

  const resetFlow = () => {
    setRole(null);
    setSelectedFiles([]);
    setGeneratedCode(null);
    setSessionStatus('idle');
    setProgress(0);
    setShareLink(null);
    setReceiverCode('');
    setReceiverPassword('');
    setReceiverSession(null);
    setReceiverError(null);
    setDownloadReady(false);
  };

  const renderRolePicker = () => (
    <motion.section
      initial={{ opacity: 0, translateY: 12 }}
      animate={{ opacity: 1, translateY: 0 }}
      className="glass-panel grid gap-6 md:grid-cols-2"
    >
      <RoleCard
        title="I am a Sender"
        description="Upload files, generate a secure code or QR, and share instantly."
        accent="from-blue-500/70 to-indigo-500/80"
        icon={<UploadCloud className="h-10 w-10" />}
        onClick={() => setRole('sender')}
      />
      <RoleCard
        title="I am a Receiver"
        description="Enter the 6-digit code or scan a QR to download files."
        accent="from-emerald-500/70 to-lime-500/80"
        icon={<DownloadCloud className="h-10 w-10" />}
        onClick={() => setRole('receiver')}
      />
    </motion.section>
  );

  return (
    <div
      className={clsx(
        'min-h-screen w-full bg-gradient-to-br px-6 py-10 transition-colors md:px-10',
        theme === 'dark'
          ? 'from-slate-950 via-slate-900 to-slate-950 text-white'
          : 'from-slate-50 via-white to-slate-100 text-slate-900'
      )}
    >
      <div className="mx-auto max-w-6xl space-y-10">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm uppercase tracking-[0.2em] text-blue-400">Cloudbeam Share</p>
            <h1 className="text-3xl font-semibold md:text-4xl">
              Share files securely across any network
            </h1>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              className="rounded-full border border-white/20 px-4 py-2 text-sm backdrop-blur transition hover:border-white/50"
            >
              {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
            </button>
            {role && (
              <button
                onClick={resetFlow}
                className="inline-flex items-center gap-2 rounded-full border border-white/20 px-4 py-2 text-sm backdrop-blur transition hover:border-white/50"
              >
                <ArrowLeft className="h-4 w-4" />
                Change role
              </button>
            )}
          </div>
        </header>

        {!role && renderRolePicker()}

        {role === 'sender' && (
          <motion.section
            initial={{ opacity: 0, translateY: 12 }}
            animate={{ opacity: 1, translateY: 0 }}
            className="glass-panel grid gap-8 lg:grid-cols-[3fr_2fr]"
          >
            <div className="space-y-6">
              <div className="flex flex-wrap items-center gap-4 text-sm text-slate-400">
                <StepperItem label="Select" active />
                <StepperItem label="Secure" active={sessionStatus !== 'idle'} />
                <StepperItem label="Share" active={sessionStatus === 'ready'} />
              </div>

              <label
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragActive(true);
                }}
                onDragLeave={() => setDragActive(false)}
                onDrop={handleDrop}
                className={clsx(
                  'flex min-h-[220px] cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed px-6 text-center transition',
                  dragActive
                    ? 'border-blue-500/80 bg-blue-500/10'
                    : 'border-white/15 hover:border-white/40'
                )}
              >
                <input
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(event: ChangeEvent<HTMLInputElement>) =>
                    handleFiles(event.target.files)
                  }
                />
                <UploadCloud className="mb-4 h-12 w-12 text-blue-400" />
                <p className="text-lg font-semibold">Drag & drop or tap to choose files</p>
                <p className="mt-2 text-sm text-slate-400">
                  Works for folders, photos, videos, and documents
                </p>
              </label>

              {selectedFiles.length > 0 && (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-white/10 bg-white/5 p-4">
                    <div>
                      <p className="text-sm uppercase tracking-[0.3em] text-slate-400">Selected</p>
                      <p className="text-xl font-semibold">{selectedFiles.length} files</p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm text-slate-400">Total size</p>
                      <p className="text-lg font-semibold">{formatBytes(totalSize)}</p>
                    </div>
                  </div>
                  <ul className="space-y-3">
                    {selectedFiles.map((file) => (
                      <li
                        key={file.name}
                        className="flex items-center justify-between rounded-2xl border border-white/5 bg-white/5 px-4 py-3 text-left text-sm"
                      >
                        <div className="truncate">
                          <p className="font-medium truncate">{file.name}</p>
                          <p className="text-slate-400">{formatBytes(file.size)}</p>
                        </div>
                        <span className="text-slate-400">{file.type || 'Unknown type'}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div className="grid gap-4 md:grid-cols-2">
                <ToggleCard
                  title="Password protect"
                  description="Receiver must enter your password"
                  active={passwordEnabled}
                  icon={<Lock className="h-5 w-5" />}
                  onToggle={() => setPasswordEnabled((prev) => !prev)}
                />
                <ToggleCard
                  title="Auto delete"
                  description="Choose how long files stay online"
                  active={expiry === 0}
                  icon={<Clock3 className="h-5 w-5" />}
                  onToggle={() => setExpiry(expiry === 0 ? expiryOptions[0].value : 0)}
                />
              </div>

              {passwordEnabled && (
                <input
                  type="password"
                  className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 outline-none backdrop-blur"
                  placeholder="Create a password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              )}

              <div className="space-y-3">
                <label className="text-sm font-medium text-slate-300">Expiry</label>
                <div className="flex flex-wrap gap-3">
                  {expiryOptions.map((option) => (
                    <button
                      key={option.value}
                      onClick={() => setExpiry(option.value)}
                      className={clsx(
                        'rounded-full border px-4 py-2 text-sm transition',
                        expiry === option.value
                          ? 'border-blue-500/80 bg-blue-500/10 text-blue-200'
                          : 'border-white/10 text-slate-300 hover:border-white/40'
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-6 backdrop-blur">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-400">Device detected</p>
                    <p className="text-lg font-semibold">{deviceName}</p>
                  </div>
                  <MonitorSmartphone className="h-10 w-10 text-slate-400" />
                </div>
                <div className="mt-6 space-y-4">
                  <ProgressBar progress={progress} status={sessionStatus} />
                  <button
                    disabled={!selectedFiles.length}
                    onClick={handleGenerateSession}
                    className="group flex w-full items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-blue-500 to-indigo-500 py-3 font-semibold text-white shadow-lg shadow-blue-500/30 transition hover:translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    <Zap className="h-5 w-5" />
                    {sessionStatus === 'idle' ? 'Generate secure code' : 'Uploading...'}
                  </button>
                </div>
              </div>

              {generatedCode && (
                <div className="space-y-4 rounded-3xl border border-blue-500/20 bg-blue-500/5 p-6 text-center">
                  <p className="text-sm uppercase tracking-[0.4em] text-blue-200">Share this code</p>
                  <div className="text-5xl font-semibold tracking-[0.2em] text-blue-100">
                    {generatedCode}
                  </div>
                  <div className="flex items-center justify-center gap-3 text-sm text-blue-100">
                    <QrCode className="h-5 w-5" />
                    QR available once upload finishes
                  </div>
                  {sessionStatus === 'ready' && shareLink && (
                    <div className="space-y-3">
                      <p className="text-sm text-blue-100">Or share this link</p>
                      <div className="rounded-2xl border border-white/10 bg-white/10 p-3 text-xs">
                        {shareLink}
                      </div>
                    </div>
                  )}
                </div>
              )}

              <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                <div className="flex items-center gap-3 text-sm text-slate-300">
                  <ShieldCheck className="h-5 w-5 text-emerald-400" />
                  End-to-end encrypted · Auto delete after transfer
                </div>
              </div>
            </div>
          </motion.section>
        )}

        {role === 'receiver' && (
          <motion.section
            initial={{ opacity: 0, translateY: 12 }}
            animate={{ opacity: 1, translateY: 0 }}
            className="glass-panel grid gap-8 lg:grid-cols-[2fr_3fr]"
          >
            <div className="space-y-5">
              <div>
                <p className="text-sm text-slate-400">Enter code</p>
                <div className="mt-3 flex gap-3">
                  {Array.from({ length: 6 }).map((_, index) => (
                    <input
                      key={index}
                      maxLength={1}
                      value={receiverCode[index] ?? ''}
                      onChange={(event: ChangeEvent<HTMLInputElement>) => {
                        const value = event.target.value.replace(/[^0-9]/g, '');
                        if (!value) {
                          setReceiverCode((prev) =>
                            prev.slice(0, index) + prev.slice(index + 1)
                          );
                          return;
                        }
                        setReceiverCode((prev) => {
                          const chars = prev.split('');
                          chars[index] = value;
                          return chars.join('').padEnd(6, '');
                        });
                      }}
                      className="h-12 w-12 rounded-2xl border border-white/10 bg-white/5 text-center text-lg font-semibold text-current outline-none"
                    />
                  ))}
                </div>
              </div>

              <button className="flex w-full items-center justify-center gap-3 rounded-2xl border border-white/15 px-4 py-3 text-sm text-slate-200 transition hover:border-white/40">
                <QrCode className="h-5 w-5" />
                Scan QR instead
              </button>

              <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                <div className="flex items-center gap-3 text-sm text-slate-300">
                  <Smartphone className="h-5 w-5" />
                  Works across Wi-Fi, 5G, or any network
                </div>
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
                <div className="flex items-center gap-3 text-sm text-slate-300">
                  <History className="h-5 w-5" />
                  Recent transfers stay here for 1 hour
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-3xl border border-white/10 bg-white/5 p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm text-slate-400">Sender device</p>
                    <p className="text-2xl font-semibold">{sampleReceiverManifest.senderDevice}</p>
                  </div>
                  <ArrowLeft className="h-10 w-10 text-slate-500" />
                </div>

                {downloadReady ? (
                  <div className="mt-6 space-y-4">
                    <div className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 p-4">
                      <div>
                        <p className="text-sm text-slate-400">Files ready</p>
                        <p className="text-lg font-semibold">
                          {sampleReceiverManifest.files.length} items ·{' '}
                          {formatBytes(
                            sampleReceiverManifest.files.reduce(
                              (acc, file) => acc + file.size,
                              0
                            )
                          )}
                        </p>
                      </div>
                      <span className="text-xs uppercase tracking-[0.3em] text-emerald-300">
                        {sampleReceiverManifest.expiresIn}
                      </span>
                    </div>

                    {passwordEnabled && (
                      <input
                        type="password"
                        placeholder="Enter password"
                        value={receiverPassword}
                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                          setReceiverPassword(event.target.value)
                        }
                        className="w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-sm outline-none"
                      />
                    )}

                    <ul className="space-y-3">
                      {sampleReceiverManifest.files.map((file) => (
                        <li
                          key={file.id}
                          className="flex items-center justify-between rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
                        >
                          <div>
                            <p className="font-medium">{file.name}</p>
                            <p className="text-sm text-slate-400">{formatBytes(file.size)}</p>
                          </div>
                          <button className="text-sm text-blue-300">Download</button>
                        </li>
                      ))}
                    </ul>

                    <button className="flex w-full items-center justify-center gap-3 rounded-2xl bg-gradient-to-r from-emerald-500 to-lime-500 py-3 font-semibold text-emerald-950">
                      <DownloadCloud className="h-5 w-5" />
                      Download everything
                    </button>
                  </div>
                ) : (
                  <div className="mt-8 space-y-5 text-center">
                    <div className="inline-flex items-center gap-2 rounded-full border border-white/10 px-4 py-2 text-xs uppercase tracking-[0.3em] text-slate-400">
                      Waiting for code
                    </div>
                    <p className="text-lg font-semibold">
                      Enter the 6-digit code from the sender to preview files.
                    </p>
                  </div>
                )}
              </div>

              <div className="rounded-3xl border border-white/10 bg-white/5 p-5 text-sm text-slate-300">
                <div className="flex items-center gap-3">
                  <ShieldCheck className="h-5 w-5 text-emerald-400" />
                  Files are encrypted in transit and auto-delete after download.
                </div>
              </div>
            </div>
          </motion.section>
        )}
      </div>
    </div>
  );
};

const StepperItem = ({ label, active }: { label: string; active?: boolean }) => (
  <div
    className={clsx(
      'flex items-center gap-2 text-xs font-semibold tracking-[0.3em]',
      active ? 'text-white' : 'text-slate-500'
    )}
  >
    <span className={clsx('h-2 w-2 rounded-full', active ? 'bg-white' : 'bg-slate-600')} />
    {label.toUpperCase()}
  </div>
);

const ToggleCard = ({
  title,
  description,
  icon,
  active,
  onToggle,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  active?: boolean;
  onToggle: () => void;
}) => (
  <button
    onClick={onToggle}
    type="button"
    className={clsx(
      'flex w-full items-start gap-4 rounded-3xl border px-5 py-4 text-left transition',
      active
        ? 'border-blue-500/40 bg-blue-500/10'
        : 'border-white/10 bg-white/5 hover:border-white/30'
    )}
  >
    <span
      className={clsx(
        'rounded-2xl p-3',
        active ? 'bg-blue-500/20 text-blue-200' : 'bg-white/10 text-slate-200'
      )}
    >
      {icon}
    </span>
    <div>
      <p className="font-semibold">{title}</p>
      <p className="text-sm text-slate-400">{description}</p>
    </div>
  </button>
);

const ProgressBar = ({ progress, status }: { progress: number; status: SessionStatus }) => (
  <div className="space-y-3">
    <div className="flex items-center justify-between text-sm text-slate-300">
      <span>{status === 'ready' ? 'Upload complete' : 'Uploading files'}</span>
      <span>{progress}%</span>
    </div>
    <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
      <div
        className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all"
        style={{ width: `${progress}%` }}
      />
    </div>
  </div>
);

const RoleCard = ({
  title,
  description,
  accent,
  icon,
  onClick,
}: {
  title: string;
  description: string;
  accent: string;
  icon: React.ReactNode;
  onClick: () => void;
}) => (
  <button
    onClick={onClick}
    className="group relative overflow-hidden rounded-3xl border border-white/10 bg-white/5 p-6 text-left transition hover:border-white/40"
    type="button"
  >
    <div className="pointer-events-none absolute inset-0 opacity-60">
      <div className={clsx('absolute inset-0 rounded-3xl bg-gradient-to-br', accent)} />
    </div>
    <div className="relative flex h-full flex-col justify-between gap-4">
      <div className="inline-flex items-center gap-3 rounded-full border border-white/20 px-4 py-1 text-xs uppercase tracking-[0.3em] text-white/80">
        {icon}
        {title}
      </div>
      <p className="text-lg text-white/90">{description}</p>
    </div>
  </button>
);

const glassPanelClass =
  'rounded-[32px] border border-white/10 bg-white/5 p-6 text-white shadow-glass backdrop-blur-xl';

const styles = document.createElement('style');
styles.innerHTML = `
  .glass-panel {
    border-radius: 32px;
    border: 1px solid rgba(255, 255, 255, 0.1);
    background: rgba(255, 255, 255, 0.04);
    box-shadow: 0 25px 60px rgba(5, 6, 10, 0.25);
    backdrop-filter: blur(20px);
  }
`;
if (typeof document !== 'undefined' && !document.getElementById('glass-style')) {
  styles.id = 'glass-style';
  document.head.appendChild(styles);
}

export default App;
