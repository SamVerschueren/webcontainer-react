import {useCallback} from 'react';
import {useSandpack} from './useSandpack';

export function useActiveCode(): {
  code: string;
  updateCode: (newCode: string) => void;
} {
  const {sandpack} = useSandpack();
  const {activeFile, files, updateFile} = sandpack;
  const code = files[activeFile]?.code ?? '';

  const updateCode = useCallback(
    (newCode: string) => {
      updateFile(activeFile, newCode);
    },
    [updateFile, activeFile]
  );

  return {code, updateCode};
}
