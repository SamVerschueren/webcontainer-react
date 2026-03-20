# @webcontainer/react

Sandpack-compatible React components backed by [WebContainer API](https://webcontainers.io/).

## Install

```sh
npm install @webcontainer/react
```

## Usage

```tsx
import {
  SandpackProvider,
  SandpackLayout,
  SandpackCodeEditor,
} from '@webcontainer/react';

function App() {
  return (
    <SandpackProvider template="vite-react">
      <SandpackLayout>
        <SandpackCodeEditor />
      </SandpackLayout>
    </SandpackProvider>
  );
}
```

## Exports

- **`SandpackProvider`** — context provider that manages a WebContainer instance
- **`SandpackLayout`** / **`SandpackStack`** — layout primitives
- **`SandpackCodeEditor`** — CodeMirror-based editor
- **`SandpackCodeViewer`** — read-only code viewer
- **`FileTabs`** — file tab bar
- **`OpenInStackBlitzButton`** — open the current project in StackBlitz
- **`useSandpack`** / **`useActiveCode`** / **`useSandpackNavigation`** — hooks

## License

MIT
