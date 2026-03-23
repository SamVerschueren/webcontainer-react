import type {ReactNode} from 'react';
import {useSandpack} from '../hooks/useSandpack';

interface OpenInStackBlitzButtonProps {
  className?: string;
  title?: string;
  children?: ReactNode;
}

export function OpenInStackBlitzButton({
  className,
  title = 'Open in StackBlitz',
  children,
}: OpenInStackBlitzButtonProps) {
  const {sandpack} = useSandpack();
  const {templateEnvironment} = sandpack;

  function handleOpen() {
    const appFile =
      sandpack.files['/src/App.jsx'] || sandpack.files['src/App.jsx']
        ? 'src/App.jsx'
        : 'src/App.js';

    const form = document.createElement('form');
    form.method = 'POST';
    form.action = `https://stackblitz.com/run?file=${encodeURIComponent(appFile)}`;
    form.target = '_blank';

    addInput(form, 'project[title]', 'React Sandbox');
    addInput(form, 'project[template]', 'node');

    const hasPackageJson = Object.keys(sandpack.files).some(
      (p) => p === '/package.json' || p === 'package.json'
    );

    if (!hasPackageJson) {
      addInput(form, 'project[files][package.json]', templateEnvironment.packageJson);
      if (templateEnvironment.packageLockJson) {
        addInput(
          form,
          'project[files][package-lock.json]',
          templateEnvironment.packageLockJson
        );
      }
    }

    for (const [path, {code}] of Object.entries(sandpack.files)) {
      const normalized = path.startsWith('/') ? path.slice(1) : path;
      addInput(form, `project[files][${normalized}]`, code);
    }

    document.body.appendChild(form);
    form.submit();
    document.body.removeChild(form);
  }

  return (
    <button
      className={className}
      onClick={handleOpen}
      title={title}
      type="button">
      {children ?? 'Open in StackBlitz!!!'}
    </button>
  );
}

function addInput(form: HTMLFormElement, name: string, value: string) {
  const input = document.createElement('input');
  input.type = 'hidden';
  input.name = name;
  input.value = value;
  form.appendChild(input);
}
