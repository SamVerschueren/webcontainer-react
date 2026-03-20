import type { WebContainer, WebContainerProcess } from '@webcontainer/api';
import type { SandpackFiles, SandpackListener, SandpackMessage } from './types';
import { rootPackageJson, rootPackageJsonLock } from './templates/vite-react';

export interface ProjectInfo {
  previewUrl: string | null;
  status: 'registered' | 'starting' | 'ready' | 'error';
}

interface ProjectState {
  files: SandpackFiles;
  viteProcess: WebContainerProcess | null;
  previewUrl: string | null;
  port: number;
  listeners: Set<SandpackListener>;
}

const MAX_CONCURRENT_VITE = 3;
const BASE_PORT = 3001;
const VITE_TIMEOUT_MS = 60_000;

/**
 * Injected into every preview iframe via setPreviewScript to bridge
 * console output and iframe resize events back to the host via postMessage.
 *
 * Message shapes match the SandpackMessage union so the existing
 * Console and Preview components can consume them unchanged.
 */
const BRIDGE_SCRIPT = `(function() {
  var _msgId = 0;

  // --- Console interception ---
  var methods = ['log', 'info', 'warn', 'error', 'debug'];
  methods.forEach(function(method) {
    var original = console[method];
    console[method] = function() {
      original.apply(console, arguments);
      const args = Array.prototype.slice.call(arguments);
      const data = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a));

      if (method === 'debug' && data.join('').startsWith('[vite]')) {
        return;
      }

      window.parent.postMessage({
        type: 'console',
        codesandbox: true,
        log: [{
          method: method,
          id: String(_msgId++),
          data
        }]
      }, '*');
    };
  });

  var originalClear = console.clear;
  console.clear = function() {
    originalClear.apply(console);
    window.parent.postMessage({
      type: 'console',
      codesandbox: true,
      log: [{ method: 'clear', id: String(_msgId++), data: [] }]
    }, '*');
  };

  // --- Resize observation ---
  function observeResize() {
    var root = document.getElementById('root');
    if (!root) return;
    new ResizeObserver(function(entries) {
      const { body } = document;
      const html = document.documentElement;
      const height = Math.max(body.scrollHeight, body.offsetHeight, html.offsetHeight);

      window.parent.postMessage({
        type: 'resize',
        height,
      }, '*');
    }).observe(root);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observeResize);
  } else {
    observeResize();
  }

  // --- Uncaught error forwarding ---
  window.addEventListener('error', function(event) {
    window.parent.postMessage({
      type: 'console',
      codesandbox: true,
      log: [{
        method: 'error',
        id: String(_msgId++),
        data: [event.message || 'Unknown error']
      }]
    }, '*');
  });

  window.addEventListener('unhandledrejection', function(event) {
    var msg = event.reason && event.reason.message
      ? event.reason.message
      : String(event.reason || 'Unhandled promise rejection');
    window.parent.postMessage({
      type: 'console',
      codesandbox: true,
      log: [{
        method: 'error',
        id: String(_msgId++),
        data: [msg]
      }]
    }, '*');
  });
})();`;

/**
 * Singleton that manages the single WebContainer instance.
 *
 * Each SandpackProvider registers a 'project' with a unique ID,
 * getting its own folder at /projects/{id}/.
 */
export class WebContainerManager {
  private static instance: WebContainerManager | null = null;

  private container: WebContainer | null = null;
  private bootPromise: Promise<WebContainer> | null = null;
  private projects = new Map<string, ProjectState>();
  private nextPort = BASE_PORT;
  private activeViteCount = 0;
  private pendingServerReady = new Map<number, { resolve: (url: string) => void; reject: (err: Error) => void }>();

  static getInstance(): WebContainerManager {
    if (!WebContainerManager.instance) {
      WebContainerManager.instance = new WebContainerManager();
    }
    return WebContainerManager.instance;
  }

  private constructor() {}

  /**
   * Lazily boots the WebContainer on first call, installs shared
   * dependencies at /projects/ once, then returns the instance.
   * Subsequent calls return the same instance.
   */
  async boot(): Promise<WebContainer> {
    if (this.container) {
      return this.container;
    }
    if (this.bootPromise) {
      return this.bootPromise;
    }

    this.bootPromise = import('@webcontainer/api')
      .then((module) => module.WebContainer.boot())
      .then(async (container) => {
        this.container = container;
        this.setupContainerListeners(container);
        await this.installSharedDependencies(container);
        await container.setPreviewScript(BRIDGE_SCRIPT);
        return container;
      });

    return this.bootPromise;
  }

  /**
   * Mounts the shared package.json at /projects/ and runs
   * `npm install` once so all project subdirectories can
   * resolve packages via Node's upward module resolution.
   */
  private async installSharedDependencies(container: WebContainer): Promise<void> {
    await container.fs.mkdir('/projects', { recursive: true });
    await container.fs.writeFile('/projects/package.json', rootPackageJson);
    await container.fs.writeFile('/projects/package-lock.json', rootPackageJsonLock);

    const install = await container.spawn('npm', ['install'], {
      cwd: '/projects',
    });

    let installOutput = '';
    install.output
      .pipeTo(
        new WritableStream({
          write(chunk) {
            installOutput += chunk;
          },
        }),
      )
      .catch(() => {});

    const exitCode = await install.exit;
    if (exitCode !== 0) {
      throw new Error(`Shared dependency install failed (exit ${exitCode}):\n${installOutput}`);
    }
  }

  private setupContainerListeners(container: WebContainer): void {
    container.on('server-ready', (port: number, url: string) => {
      const projects = Array.from(this.projects.values());
      for (let i = 0; i < projects.length; i++) {
        if (projects[i].port === port) {
          projects[i].previewUrl = url;
          this.emit(projects[i], { type: 'done' });
          break;
        }
      }

      const pending = this.pendingServerReady.get(port);
      if (pending) {
        this.pendingServerReady.delete(port);
        pending.resolve(url);
      }
    });
  }

  /**
   * Registers a project with a unique ID and assigns it a port.
   * No-op if the project is already registered.
   */
  registerProject(id: string, files: SandpackFiles): void {
    if (this.projects.has(id)) {
      return;
    }
    this.projects.set(id, {
      files: { ...files },
      viteProcess: null,
      previewUrl: null,
      port: this.nextPort++,
      listeners: new Set(),
    });
  }

  /**
   * Kills any running processes and removes the project entirely.
   */
  async unregisterProject(id: string): Promise<void> {
    await this.killProject(id);
    this.projects.delete(id);
  }

  /**
   * Writes all provided files into /projects/{id}/, creating
   * directories as needed. Merges into existing project files.
   */
  async mountFiles(id: string, files: SandpackFiles): Promise<void> {
    const container = await this.boot();
    const project = this.getProjectOrThrow(id);
    const base = `/projects/${id}`;

    const dirs = new Set<string>();
    for (const filePath of Object.keys(files)) {
      const parts = filePath.split('/').filter(Boolean);
      // Collect every ancestor directory under the project root
      for (let i = 1; i < parts.length; i++) {
        dirs.add(`${base}/${parts.slice(0, i).join('/')}`);
      }
    }

    for (const dir of Array.from(dirs).sort()) {
      await container.fs.mkdir(dir, { recursive: true });
    }

    for (const [filePath, file] of Object.entries(files)) {
      await container.fs.writeFile(`${base}${filePath}`, file.code);
    }

    Object.assign(project.files, files);
  }

  /**
   * Writes a single file inside the project folder.
   * Used for live edits from the code editor.
   */
  async writeFile(id: string, filePath: string, content: string): Promise<void> {
    const container = await this.boot();
    const fullPath = `/projects/${id}${filePath}`;
    const parentDir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    await container.fs.mkdir(parentDir, { recursive: true });
    await container.fs.writeFile(fullPath, content);
  }

  /**
   * Starts Vite in the project folder. Shared dependencies are
   * already installed at /projects/ during boot().
   * Resolves with the preview URL once the dev server is ready.
   */
  async spawnVite(id: string): Promise<string> {
    const container = await this.boot();
    const project = this.getProjectOrThrow(id);
    const cwd = `/projects/${id}`;

    this.emit(project, { type: 'start', firstLoad: true });

    // --- Evict oldest project if at the concurrency limit ---
    if (this.activeViteCount >= MAX_CONCURRENT_VITE) {
      const entries = Array.from(this.projects.entries());
      for (let i = 0; i < entries.length; i++) {
        const [otherId, other] = entries[i];
        if (otherId !== id && other.viteProcess) {
          await this.killProject(otherId);
          break;
        }
      }
    }

    // --- Start Vite dev server ---
    const url = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingServerReady.delete(project.port);
        reject(new Error('Vite server did not start within 60 seconds'));
      }, VITE_TIMEOUT_MS);

      this.pendingServerReady.set(project.port, {
        resolve: (serverUrl: string) => {
          clearTimeout(timeout);
          resolve(serverUrl);
        },
        reject: (err: Error) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      container
        .spawn('npx', ['vite', '--port', String(project.port)], { cwd })
        .then((proc) => {
          project.viteProcess = proc;
          this.activeViteCount++;

          // Drain output so the process doesn't stall on back-pressure
          proc.output.pipeTo(new WritableStream({ write() {} })).catch(() => {});

          proc.exit.then((code) => {
            if (project.viteProcess === proc) {
              this.activeViteCount = Math.max(0, this.activeViteCount - 1);
              project.viteProcess = null;
            }

            if (!project.previewUrl) {
              const pending = this.pendingServerReady.get(project.port);
              if (pending) {
                this.pendingServerReady.delete(project.port);
                pending.reject(new Error(`Vite exited (code ${code}) before server was ready`));
              }
            }
          });
        })
        .catch((err) => {
          clearTimeout(timeout);
          reject(err);
        });
    });

    project.previewUrl = url;
    return url;
  }

  /**
   * Kills the Vite process for the project.
   * The project stays registered and can be restarted with spawnVite().
   */
  async killProject(id: string): Promise<void> {
    const project = this.projects.get(id);
    if (!project) {
      return;
    }

    if (project.viteProcess) {
      const proc = project.viteProcess;
      project.viteProcess = null;
      this.activeViteCount = Math.max(0, this.activeViteCount - 1);
      proc.kill();
      await proc.exit;
    }

    project.previewUrl = null;
  }

  /**
   * Subscribes to sandpack messages for a project.
   * Returns an unsubscribe function.
   */
  addListener(id: string, listener: SandpackListener): () => void {
    const project = this.getProjectOrThrow(id);
    project.listeners.add(listener);
    return () => {
      project.listeners.delete(listener);
    };
  }

  getProject(id: string): ProjectInfo | undefined {
    const project = this.projects.get(id);
    if (!project) {
      return undefined;
    }
    let status: ProjectInfo['status'];
    if (project.previewUrl) {
      status = 'ready';
    } else if (project.viteProcess) {
      status = 'starting';
    } else {
      status = 'registered';
    }
    return { previewUrl: project.previewUrl, status };
  }

  getActiveViteCount(): number {
    return this.activeViteCount;
  }

  private getProjectOrThrow(id: string): ProjectState {
    const project = this.projects.get(id);
    if (!project) {
      throw new Error(`Project '${id}' is not registered`);
    }
    return project;
  }

  private emit(project: ProjectState, message: SandpackMessage): void {
    Array.from(project.listeners).forEach((listener) => {
      try {
        listener(message);
      } catch {
        // Don't let one listener's error break others
      }
    });
  }
}
