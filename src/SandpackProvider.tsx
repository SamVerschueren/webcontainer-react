import {useState, useEffect, useRef, useCallback, useMemo} from 'react';
import {SandpackContext} from './context';
import {WebContainerManager} from './WebContainerManager';
import type {
  SandpackProviderProps,
  SandpackFiles,
  SandpackStatus,
  SandpackError,
  SandpackMessage,
  SandpackListener,
  SandpackState,
  SandpackContext as SandpackContextType,
  EditorState,
} from './types';

let nextProjectId = 0;

function deriveActiveFile(userFiles: SandpackFiles): string {
  for (const [path, file] of Object.entries(userFiles)) {
    if (file.active) return path;
  }
  for (const [path, file] of Object.entries(userFiles)) {
    if (!file.hidden) return path;
  }
  return Object.keys(userFiles)[0] ?? '/src/App.js';
}

function deriveVisibleFiles(allFiles: SandpackFiles): string[] {
  return Object.entries(allFiles)
    .filter(([, file]) => !file.hidden)
    .map(([path]) => path);
}

function filesToCodeMap(
  files: SandpackFiles
): Record<string, {code: string}> {
  const result: Record<string, {code: string}> = {};
  for (const [path, file] of Object.entries(files)) {
    result[path] = {code: file.code};
  }
  return result;
}

function buildCodeFrame(
  source: string | undefined,
  location: {line: number; column: number}
): string {
  if (!source) return '';

  const lines = source.split('\n');

  const start = Math.max(0, location.line - 3);
  const end = Math.min(location.line + 3, lines.length);

  const numberLength = `${end}`.length + 2;

  const frames = [];

  for (let i = start; i < end; i++) {
    const isErrorLine = i + 1 === location.line;

    const prefix = isErrorLine
      ? '>' + `${i + 1}`.padStart(numberLength - 1, ' ')
      : `${i + 1}`.padStart(numberLength, ' ');

    frames.push(`${prefix} | ${lines[i]}`);

    if (isErrorLine) {
      const gutter = ' '.repeat(numberLength);

      frames.push(`${gutter} | ` + '^'.padStart(location.column + 1));
    }
  }

  return frames.join('\n');
}

export function SandpackProvider({
  template,
  files: userFiles,
  options,
  children,
}: SandpackProviderProps) {
  const {
    autorun = true,
    initMode = 'immediate',
    initModeObserverOptions,
  } = options ?? {};

  // Stable project ID, generated once per mount
  const [projectId] = useState(() => `sp-${nextProjectId++}`);

  // Snapshot of all files at mount time (user wins over app, app wins over shared)
  const initialFilesRef = useRef<SandpackFiles>({
    ...template.sharedFiles,
    ...template.appFiles,
    ...userFiles,
  });

  const visibleFiles = useMemo(
    () => deriveVisibleFiles(initialFilesRef.current),
    []
  );

  const [files, setFiles] = useState(() =>
    filesToCodeMap(initialFilesRef.current)
  );
  const [activeFile, setActiveFile] = useState(() =>
    deriveActiveFile(userFiles)
  );
  const [status, setStatus] = useState<SandpackStatus>('initial');
  const [error, setError] = useState<SandpackError | null>(null);
  const [basePreviewUrl, setBasePreviewUrl] = useState<string | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);
  const [isVisible, setIsVisible] = useState(initMode === 'immediate');

  const containerRef = useRef<HTMLDivElement>(null);
  const listenersRef = useRef(new Set<SandpackListener>());
  const filesRef = useRef(files);
  filesRef.current = files;
  const manager = useMemo(() => WebContainerManager.getInstance(), []);

  // ---- Derived ----

  const editorState: EditorState = useMemo(() => {
    const initial = initialFilesRef.current;
    for (const path of Object.keys(files)) {
      if (initial[path] && initial[path].code !== files[path].code) {
        return 'dirty';
      }
    }
    return 'pristine';
  }, [files]);

  const previewUrl = useMemo(() => {
    if (!basePreviewUrl) return null;
    return refreshCount > 0
      ? `${basePreviewUrl}?_r=${refreshCount}`
      : basePreviewUrl;
  }, [basePreviewUrl, refreshCount]);

  // ---- Emit to registered sandpack listeners ----

  const emit = useCallback((msg: SandpackMessage) => {
    Array.from(listenersRef.current).forEach((listener) => {
      try {
        listener(msg);
      } catch {
        // Don't let one listener break others
      }
    });
  }, []);

  // ---- Public API: updateFile ----

  const updateFile = useCallback(
    (path: string, code: string) => {
      setFiles((prev) => ({...prev, [path]: {code}}));
      manager.writeFile(projectId, path, code).catch(() => {});
    },
    [projectId, manager]
  );

  // ---- Public API: resetAllFiles ----

  const resetAllFiles = useCallback(() => {
    const initial = initialFilesRef.current;
    setFiles(filesToCodeMap(initial));
    manager.mountFiles(projectId, initial).catch(() => {});
  }, [projectId, manager]);

  // ---- Public API: listen ----

  const listen = useCallback(
    (callback: SandpackListener, _clientId?: string) => {
      listenersRef.current.add(callback);
      return () => {
        listenersRef.current.delete(callback);
      };
    },
    []
  );

  // ---- Public API: dispatch ----

  const dispatch = useCallback(
    (msg: SandpackMessage) => {
      if (msg.type === 'refresh') {
        setRefreshCount((c) => c + 1);
        emit({type: 'refresh'});
      }
    },
    [emit]
  );

  // ---- IntersectionObserver for user-visible init mode ----

  useEffect(() => {
    if (initMode !== 'user-visible' || isVisible) return;
    const el = containerRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setIsVisible(true);
        observer.disconnect();
      }
    }, initModeObserverOptions);

    observer.observe(el);
    return () => observer.disconnect();
  }, [initMode, isVisible, initModeObserverOptions]);

  // ---- Boot WebContainer, install template, mount files, spawn dev server ----

  useEffect(() => {
    if (!isVisible || !autorun) return;

    manager.registerProject(projectId, initialFilesRef.current, template.id);
    const unsubListener = manager.addListener(projectId, emit);

    let cancelled = false;

    (async () => {
      try {
        setStatus('installing');
        await manager.boot();
        if (cancelled) return;

        await manager.ensureTemplateInstalled(template);
        if (cancelled) return;

        await manager.mountFiles(projectId, initialFilesRef.current);
        if (cancelled) return;

        setStatus('running');
        const url = await manager.spawnDevServer(projectId, template);
        if (cancelled) return;

        setBasePreviewUrl(url);
      } catch (err) {
        if (cancelled) return;
        console.log(err);
        setError({
          title: 'Sandbox Error',
          message: err instanceof Error ? err.message : String(err),
        });
        setStatus('timeout');
      }
    })();

    return () => {
      cancelled = true;
      unsubListener();
      manager.unregisterProject(projectId);
    };
  }, [isVisible, autorun, projectId, emit, manager, template]);

  // ---- Forward iframe postMessage (console / resize) to listeners ----

  useEffect(() => {
    if (!basePreviewUrl) return;

    let expectedOrigin: string;

    try {
      expectedOrigin = new URL(basePreviewUrl).origin;
    } catch {
      return;
    }

    let lastMessageTimestamp = 0;

    function onMessage(event: MessageEvent) {
      if (event.origin !== expectedOrigin) return;

      const data = event.data;
      if (!data || typeof data.type !== 'string') return;
      if (data.projectId && data.projectId !== projectId) return;

      if (data.timestamp && data.timestamp < lastMessageTimestamp) return;

      lastMessageTimestamp = data.timestamp;

      if (data.type === 'show-error') {
        const error = data.error;

        let message = `${error.file}: ${error.message}`;

        if (typeof error.line === 'number' && typeof error.column === 'number') {
          const codeFrame = buildCodeFrame(
            filesRef.current[error.file]?.code,
            {
              line: error.line,
              column: error.column,
            }
          );

          message += ` (${error.line}:${error.column + 1})\n\n${codeFrame}`;
        }

        setError({
          title: error.title ?? 'Error',
          message,
          line: error.line,
          column: error.column + 1,
          path: error.file,
        });

        return;
      }

      if (data.type === 'clear-error') {
        setError(null);
        return;
      }

      if (
        (data.type === 'console' && data.codesandbox === true) ||
        data.type === 'resize'
      ) {
        emit(data as SandpackMessage);
      }
    }

    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [emit, basePreviewUrl, projectId, setError]);

  // ---- Build context value ----

  const sandpack: SandpackState = useMemo(
    () => ({
      files,
      activeFile,
      setActiveFile,
      visibleFiles,
      status,
      error,
      editorState,
      resetAllFiles,
      previewUrl,
      updateFile,
      templateEnvironment: template.environment,
    }),
    [
      files,
      activeFile,
      setActiveFile,
      visibleFiles,
      status,
      error,
      editorState,
      resetAllFiles,
      previewUrl,
      updateFile,
      template.environment,
    ]
  );

  const ctx: SandpackContextType = useMemo(
    () => ({sandpack, listen, dispatch}),
    [sandpack, listen, dispatch]
  );

  return (
    <SandpackContext.Provider value={ctx}>
      <div ref={containerRef} className="sp-wrapper">{children}</div>
    </SandpackContext.Provider>
  );
}
