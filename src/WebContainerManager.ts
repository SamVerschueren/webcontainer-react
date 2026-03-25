import type { WebContainer, WebContainerProcess } from "@webcontainer/api";
import type { SandpackFiles, SandpackListener, SandpackMessage, SandpackTemplate } from "./types";
import errorReporterSource from "virtual:error-reporter-source";

export interface ProjectInfo {
  previewUrl: string | null;
  status: "registered" | "starting" | "ready" | "error";
}

interface ProjectState {
  files: SandpackFiles;
  templateId: string;
  previewUrl: string | null;
  listeners: Set<SandpackListener>;
}

interface ServerEntry {
  port: number;
  process: WebContainerProcess | null;
  previewUrl: string | null;
}

const BASE_PORT = 5173;
const SERVER_TIMEOUT_MS = 60_000;
const PLUGINS_DIR = "/webcontainer-vite-plugins";

function viteConfigWrapper(depth: number): string {
  const prefix = "../".repeat(depth);
  return `import {defineConfig, mergeConfig} from 'vite';
import {debugMappedErrors} from '${prefix}webcontainer-vite-plugins/error-reporter.js';
import baseConfig from './vite.config.base.js';

export default mergeConfig(
    baseConfig,
    defineConfig({
        plugins: [debugMappedErrors()],
        server: {
          hmr: {
            overlay: false,
          }
        },
    }),
);
`;
}

/**
 * Injected into every preview iframe via setPreviewScript to bridge
 * console output and iframe resize events back to the host via postMessage.
 *
 * Message shapes match the SandpackMessage union so the existing
 * Console and Preview components can consume them unchanged.
 */
const BRIDGE_SCRIPT = `(function() {
  var _msgId = 0;
  var _match = window.location.pathname.match(/\\/projects\\/([^\\/]+)/);

  const projectId = _match ? _match[1] : null;

  // --- Console interception ---
  var methods = ['log', 'info', 'warn', 'error', 'debug'];
  methods.forEach(function(method) {
    var original = console[method];
    console[method] = function() {
      original.apply(console, arguments);
      const args = Array.prototype.slice.call(arguments);
      const data = args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a));

      if (data.join('').startsWith('[vite]')) {
        return;
      }

      window.parent.postMessage({
        type: 'console',
        codesandbox: true,
        projectId,
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
      projectId,
      log: [{ method: 'clear', id: String(_msgId++), data: [] }]
    }, '*');
  };

  // --- Resize observation ---
  function sendResize(height) {
    window.parent.postMessage({ type: 'resize', height, projectId }, '*');
  }

  function observeResize() {
    var root = document.getElementById('root') || document.body;
    new ResizeObserver(function() {
      const { body } = document;
      const html = document.documentElement;
      var overlay = document.querySelector('vite-error-overlay');
      const height = Math.max(body.scrollHeight, body.offsetHeight, html.offsetHeight, overlay ? 300 : 0);
      sendResize(height);
    }).observe(root);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', observeResize);
  } else {
    observeResize();
  }
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
  private pendingServerReady = new Map<number, { resolve: (url: string) => void; reject: (err: Error) => void }>();
  private installedTemplates = new Set<string>();
  private templateInstallPromises = new Map<string, Promise<void>>();
  private servers = new Map<string, ServerEntry>();
  private serverPromises = new Map<string, Promise<string>>();
  private templates = new Map<string, SandpackTemplate>();

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

    this.bootPromise = import("@webcontainer/api")
      .then((module) => module.WebContainer.boot())
      .then(async (container) => {
        this.container = container;
        this.setupContainerListeners(container);
        await Promise.all([container.setPreviewScript(BRIDGE_SCRIPT), this.writeGlobalPlugins(container)]);
        return container;
      });

    return this.bootPromise;
  }

  /**
   * Writes bundled Vite plugins to a global directory so that all
   * templates can import them via relative paths. Called once during boot.
   */
  private async writeGlobalPlugins(container: WebContainer): Promise<void> {
    await container.fs.mkdir(PLUGINS_DIR, { recursive: true });
    await container.fs.writeFile(`${PLUGINS_DIR}/error-reporter.js`, errorReporterSource);
  }

  /**
   * Installs a template's dependencies at /templates/{id}/ if not
   * already installed. Deduplicates concurrent calls for the same
   * template id. Project subdirectories resolve packages via
   * Node's standard upward module resolution.
   */
  async ensureTemplateInstalled(template: SandpackTemplate): Promise<void> {
    this.templates.set(template.id, template);

    if (this.installedTemplates.has(template.id)) {
      return;
    }

    const existing = this.templateInstallPromises.get(template.id);
    if (existing) {
      return existing;
    }

    const promise = this.doInstallTemplate(template);
    this.templateInstallPromises.set(template.id, promise);

    try {
      await promise;
      this.installedTemplates.add(template.id);
    } finally {
      this.templateInstallPromises.delete(template.id);
    }
  }

  private async doInstallTemplate(template: SandpackTemplate): Promise<void> {
    const container = await this.boot();
    const dir = `/templates/${template.id}`;

    await container.fs.mkdir(dir, { recursive: true });
    await container.fs.writeFile(`${dir}/package.json`, template.environment.packageJson);
    if (template.environment.packageLockJson) {
      await container.fs.writeFile(`${dir}/package-lock.json`, template.environment.packageLockJson);
    }

    // Write shared template files (vite.config, framework entries, etc.)
    const sharedDirs = new Set<string>();
    for (const filePath of Object.keys(template.sharedFiles)) {
      const parts = filePath.split("/").filter(Boolean);
      for (let i = 1; i < parts.length; i++) {
        sharedDirs.add(`${dir}/${parts.slice(0, i).join("/")}`);
      }
    }
    for (const sharedDir of Array.from(sharedDirs).sort()) {
      await container.fs.mkdir(sharedDir, { recursive: true });
    }
    let hasViteConfig = false;
    for (const [filePath, file] of Object.entries(template.sharedFiles)) {
      if (filePath === "/vite.config.js") {
        hasViteConfig = true;
        await container.fs.writeFile(`${dir}/vite.config.base.js`, file.code);
      } else {
        await container.fs.writeFile(`${dir}${filePath}`, file.code);
      }
    }
    if (hasViteConfig) {
      await container.fs.writeFile(`${dir}/vite.config.js`, viteConfigWrapper(2));
    }

    const install = await container.spawn("npm", ["install"], { cwd: dir, output: true });

    let installOutput = "";
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
      throw new Error(`Template '${template.id}' install failed (exit ${exitCode}):\n${installOutput}`);
    }
  }

  private setupContainerListeners(container: WebContainer): void {
    container.on("server-ready", (port: number, url: string) => {
      console.log("server-ready", port, url);

      for (const server of this.servers.values()) {
        if (server.port === port) {
          server.previewUrl = url;
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
   * Registers a project with a unique ID and associates it with a
   * template. No-op if already registered.
   */
  registerProject(id: string, files: SandpackFiles, templateId: string): void {
    if (this.projects.has(id)) {
      return;
    }
    this.projects.set(id, {
      files: { ...files },
      templateId,
      previewUrl: null,
      listeners: new Set(),
    });
  }

  /**
   * Removes the project registration and cleans up its state.
   * Template servers are left running for other projects to use.
   * Isolated-mode project servers are killed.
   */
  async unregisterProject(id: string): Promise<void> {
    const project = this.projects.get(id);
    if (project) {
      project.previewUrl = null;
      project.listeners.clear();
      this.cleanupProjectServer(id);
    }
    this.projects.delete(id);
  }

  /**
   * Writes all provided files into /templates/{templateId}/projects/{id}/,
   * creating directories as needed. Merges into existing project files.
   *
   * In isolated mode, also copies the template's sharedFiles into the
   * project directory so the per-project dev server can find them at its cwd.
   */
  async mountFiles(id: string, files: SandpackFiles): Promise<void> {
    const container = await this.boot();
    const project = this.getProjectOrThrow(id);
    const template = this.templates.get(project.templateId);
    const base = `/templates/${project.templateId}/projects/${id}`;

    const filesToWrite = template?.serverMode === "isolated" ? { ...template.sharedFiles, ...files } : files;

    const dirs = new Set<string>();
    for (const filePath of Object.keys(filesToWrite)) {
      const parts = filePath.split("/").filter(Boolean);
      for (let i = 1; i < parts.length; i++) {
        dirs.add(`${base}/${parts.slice(0, i).join("/")}`);
      }
    }

    for (const dir of Array.from(dirs).sort()) {
      await container.fs.mkdir(dir, { recursive: true });
    }

    let hasViteConfig = false;
    for (const [filePath, file] of Object.entries(filesToWrite)) {
      if (filePath === "/vite.config.js") {
        hasViteConfig = true;
        await container.fs.writeFile(`${base}/vite.config.base.js`, file.code);
      } else {
        await container.fs.writeFile(`${base}${filePath}`, file.code);
      }
    }
    if (hasViteConfig) {
      await container.fs.writeFile(`${base}/vite.config.js`, viteConfigWrapper(4));
    }

    Object.assign(project.files, files);
  }

  /**
   * Writes a single file inside the project folder.
   * Used for live edits from the code editor.
   */
  async writeFile(id: string, filePath: string, content: string): Promise<void> {
    const container = await this.boot();
    const project = this.getProjectOrThrow(id);
    const fullPath = `/templates/${project.templateId}/projects/${id}${filePath}`;
    const parentDir = fullPath.substring(0, fullPath.lastIndexOf("/"));
    await container.fs.mkdir(parentDir, { recursive: true });
    await container.fs.writeFile(fullPath, content);
  }

  /**
   * Starts a dev server for the project. In shared mode (default),
   * reuses the template's single server and returns a path-qualified
   * URL. In isolated mode, spawns a dedicated server per project and
   * returns the bare server URL.
   */
  async spawnDevServer(id: string, template: SandpackTemplate): Promise<string> {
    const project = this.getProjectOrThrow(id);

    this.emit(project, { type: "start", firstLoad: true });

    let url: string;
    if (template.serverMode === "isolated") {
      url = await this.startProjectServer(id, template);
    } else {
      const serverUrl = await this.ensureTemplateServerRunning(template);
      url = `${serverUrl}/projects/${id}/`;
    }

    project.previewUrl = url;
    this.emit(project, { type: "done" });
    return url;
  }

  /**
   * Starts a single Vite dev server at the template root if one
   * isn't already running. Deduplicates concurrent calls for the
   * same template. Returns the base server URL.
   */
  private async ensureTemplateServerRunning(template: SandpackTemplate): Promise<string> {
    return this.ensureServerRunning(template.id, `/templates/${template.id}`, template);
  }

  private async startProjectServer(id: string, template: SandpackTemplate): Promise<string> {
    return this.ensureServerRunning(id, `/templates/${template.id}/projects/${id}`, template);
  }

  /**
   * Ensures a server is running for the given key (template ID for
   * shared mode, project ID for isolated mode). Deduplicates
   * concurrent calls for the same key.
   */
  private async ensureServerRunning(key: string, cwd: string, template: SandpackTemplate): Promise<string> {
    const existing = this.servers.get(key);
    if (existing?.previewUrl) {
      return existing.previewUrl;
    }

    const pending = this.serverPromises.get(key);
    if (pending) {
      return pending;
    }

    const server: ServerEntry = { port: this.nextPort++, process: null, previewUrl: null };
    this.servers.set(key, server);

    const promise = this.spawnServer(cwd, template, server);
    this.serverPromises.set(key, promise);

    try {
      const url = await promise;
      return url;
    } finally {
      this.serverPromises.delete(key);
    }
  }

  /**
   * Spawns a dev server process at the given cwd, waits for it to
   * become ready, and returns the server URL. Shared by both
   * template-level and project-level server startup.
   */
  private async spawnServer(cwd: string, template: SandpackTemplate, server: ServerEntry): Promise<string> {
    const container = await this.boot();
    const port = server.port;

    const args = template.environment.startCommand.map((arg) => (arg === "{{port}}" ? String(port) : arg));
    const [cmd, ...cmdArgs] = args;

    const url = await new Promise<string>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingServerReady.delete(port);
        reject(new Error("Dev server did not start within 60 seconds"));
      }, SERVER_TIMEOUT_MS);

      this.pendingServerReady.set(port, {
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
        .spawn(cmd, cmdArgs, { cwd, output: true })
        .then((proc) => {
          server.process = proc;

          proc.output
            .pipeTo(
              new WritableStream({
                write(chunk) {
                  console.log(chunk);
                },
              }),
            )
            .catch(() => {});

          proc.exit.then((code) => {
            if (server.process === proc) {
              server.process = null;
              server.previewUrl = null;
            }

            const pendingReady = this.pendingServerReady.get(port);
            if (pendingReady) {
              this.pendingServerReady.delete(port);
              pendingReady.reject(new Error(`Dev server exited (code ${code}) before server was ready`));
            }
          });
        })
        .catch((err) => {
          clearTimeout(timeout);
          reject(err);
        });
    });

    server.previewUrl = url;
    return url;
  }

  /**
   * Clears the project's preview URL. In isolated mode, also kills
   * the project's dedicated server process.
   */
  async killProject(id: string): Promise<void> {
    const project = this.projects.get(id);
    if (!project) {
      return;
    }
    project.previewUrl = null;
    this.cleanupProjectServer(id);
  }

  /**
   * Kills an isolated-mode server keyed by project ID and cleans up
   * all related tracking state. No-op for shared-mode projects
   * (whose servers are keyed by template ID, not project ID).
   */
  private cleanupProjectServer(id: string): void {
    const server = this.servers.get(id);
    if (!server) {
      return;
    }

    if (server.process) {
      server.process.kill();
    }

    // If the server hadn't signaled ready yet, reject the pending
    // callback so spawnServer's promise settles instead of hanging
    // until the timeout fires.
    const pending = this.pendingServerReady.get(server.port);
    if (pending) {
      this.pendingServerReady.delete(server.port);
      pending.reject(new Error(`Project '${id}' server was stopped`));
    }

    this.servers.delete(id);
    this.serverPromises.delete(id);
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
    const status: ProjectInfo["status"] = project.previewUrl ? "ready" : "registered";
    return { previewUrl: project.previewUrl, status };
  }

  getActiveServerCount(): number {
    return this.servers.size;
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
