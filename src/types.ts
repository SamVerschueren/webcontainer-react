// ---- File types ----

export interface SandpackFile {
  code: string;
  hidden?: boolean;
  active?: boolean;
  readOnly?: boolean;
}

export type SandpackFiles = Record<string, SandpackFile>;

// ---- Status ----

export type SandpackStatus =
  | 'initial'
  | 'installing'
  | 'running'
  | 'idle'
  | 'timeout';

export type EditorState = 'pristine' | 'dirty';

// ---- Messages ----

export type SandpackMessageConsoleMethods =
  | 'log'
  | 'info'
  | 'warn'
  | 'error'
  | 'debug'
  | 'clear';

export type SandpackMessage =
  | {type: 'start'; firstLoad: boolean}
  | {type: 'done'}
  | {type: 'refresh'}
  | {type: 'resize'; height: number}
  | {
      type: 'console';
      codesandbox: true;
      log: Array<{
        method: SandpackMessageConsoleMethods;
        id: string;
        data: Array<string | Record<string, string>>;
      }>;
    };

// ---- Errors ----

export interface SandpackError {
  title: string;
  message: string;
}

// ---- Theme ----

export interface SandpackThemeColors {
  accent: string;
  base: string;
  clickable: string;
  disabled: string;
  error: string;
  errorSurface: string;
  hover: string;
  surface1: string;
  surface2: string;
  surface3: string;
  warning: string;
  warningSurface: string;
}

export interface SandpackThemeSyntax {
  plain: string;
  comment: string;
  keyword: string;
  tag: string;
  punctuation: string;
  definition: string;
  property: string;
  static: string;
  string: string;
}

export interface SandpackThemeFont {
  body: string;
  mono: string;
  size: string;
  lineHeight: string;
}

export interface SandpackTheme {
  colors: SandpackThemeColors;
  syntax: SandpackThemeSyntax;
  font: SandpackThemeFont;
}

// ---- State (returned by useSandpack) ----

export interface SandpackState {
  files: Record<string, {code: string}>;
  activeFile: string;
  setActiveFile: (path: string) => void;
  visibleFiles: string[];
  status: SandpackStatus;
  error: SandpackError | null;
  editorState: EditorState;
  resetAllFiles: () => void;
  previewUrl: string | null;
  updateFile: (path: string, code: string) => void;
}

export type SandpackListener = (msg: SandpackMessage) => void;
export type UnsubscribeFunction = () => void;

export interface SandpackContext {
  sandpack: SandpackState;
  listen: (
    callback: SandpackListener,
    clientId?: string
  ) => UnsubscribeFunction;
  dispatch: (msg: SandpackMessage) => void;
}

// ---- Loading overlay ----

export type LoadingOverlayState =
  | 'HIDDEN'
  | 'LOADING'
  | 'PRE_FADING'
  | 'FADING'
  | 'TIMEOUT';

// ---- Provider props ----

export interface SandpackProviderProps {
  files: SandpackFiles;
  theme?: SandpackTheme;
  options?: {
    autorun?: boolean;
    initMode?: 'immediate' | 'user-visible';
    initModeObserverOptions?: IntersectionObserverInit;
  };
  children: React.ReactNode;
}

// ---- CodeEditor props ----

export interface SandpackCodeEditorProps {
  showLineNumbers?: boolean;
  showInlineErrors?: boolean;
  showTabs?: boolean;
  showRunButton?: boolean;
  extensions?: any[];
  readOnly?: boolean;
  initMode?: 'immediate' | 'user-visible';
  code?: string;
}

// ---- CodeViewer props ----

export interface SandpackCodeViewerProps {
  showTabs?: boolean;
  initMode?: 'immediate' | 'user-visible';
  code?: string;
}
