import type {HTMLAttributes, Ref} from 'react';
import {useSandpack} from '../hooks/useSandpack';

export function FileTabs({
  className,
  ref,
  ...rest
}: HTMLAttributes<HTMLDivElement> & {ref?: Ref<HTMLDivElement>}) {
  const {sandpack} = useSandpack();
  const {visibleFiles, activeFile, setActiveFile} = sandpack;

  return (
    <div
      className={className ? `sp-tabs ${className}` : 'sp-tabs'}
      ref={ref}
      {...rest}>
      <div className="sp-tabs-scrollable-container" role="tablist">
        {visibleFiles.map((filePath) => {
          const fileName = filePath.slice(filePath.lastIndexOf('/') + 1);
          const isActive = filePath === activeFile;
          return (
            <button
              key={filePath}
              role="tab"
              aria-selected={isActive}
              data-active={isActive}
              className="sp-tab-button"
              onClick={() => setActiveFile(filePath)}
              type="button">
              {fileName}
            </button>
          );
        })}
      </div>
    </div>
  );
}
