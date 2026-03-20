import {tags, tagHighlighter} from '@lezer/highlight';
import {EditorView} from '@codemirror/view';
import type {Extension} from '@codemirror/state';
import {javascript} from '@codemirror/lang-javascript';
import {css} from '@codemirror/lang-css';

/**
 * Maps lezer syntax tags to the sp-syntax-* CSS classes used by sandpack.css.
 * More specific tags (e.g. `tags.bool`) override their parent (e.g. `tags.keyword`)
 * via lezer's tag specificity rules.
 */
export const sandpackHighlighter = tagHighlighter([
  {tag: tags.keyword, class: 'sp-syntax-keyword'},
  {tag: [tags.bool, tags.number], class: 'sp-syntax-static'},
  {tag: tags.string, class: 'sp-syntax-string'},
  {tag: tags.regexp, class: 'sp-syntax-string'},
  {tag: tags.comment, class: 'sp-syntax-comment'},
  {
    tag: [
      tags.definition(tags.variableName),
      tags.definition(tags.propertyName),
      tags.function(tags.variableName),
    ],
    class: 'sp-syntax-definition',
  },
  {tag: tags.tagName, class: 'sp-syntax-tag'},
  {tag: tags.typeName, class: 'sp-syntax-tag'},
  {tag: [tags.punctuation, tags.operator], class: 'sp-syntax-punctuation'},
  {tag: tags.propertyName, class: 'sp-syntax-property'},
]);

/**
 * Minimal CodeMirror theme that defers to sandpack.css variables
 * for colors and spacing while ensuring cursor/selection visibility.
 */
export const cmTheme = EditorView.theme({
  '&': {
    backgroundColor: 'var(--sp-colors-surface1, transparent)',
    color: 'var(--sp-syntax-color-plain, inherit)',
    fontSize: 'var(--sp-font-size, 13px)',
    height: '100%',
  },
  '.cm-scroller': {
    fontFamily: 'var(--sp-font-mono, monospace)',
    lineHeight: 'var(--sp-font-lineHeight, 20px)',
  },
  '.cm-matchingBracket, .cm-nonmatchingBracket, &.cm-focused .cm-matchingBracket, &.cm-focused .cm-nonmatchingBracket': {
    color: 'inherit',
    backgroundColor: 'rgba(128,128,128,.25)',
    backgroundBlendMode: 'difference',
  },
  '&.cm-editor.cm-focused': {
    outline: 'none',
  },
  '& .cm-activeLine': {
    backgroundColor: 'transparent',
  },
  '&.cm-editor.cm-focused .cm-activeLine': {
    backgroundColor: 'var(--sp-colors-surface3)',
    borderRadius: 'var(--sp-border-radius)',
  },
  '.cm-content': {
    caretColor: 'var(--sp-colors-accent, var(--sp-syntax-color-plain))',
    padding: '0 var(--sp-space-4, 16px)',
  },
  '.cm-content .cm-line': {
    paddingLeft: 'var(--sp-space-1, 4px)',
  },
  '.cm-content.cm-readonly .cm-line': {
    paddingLeft: 0,
  },
  '.cm-cursor, .cm-dropCursor': {
    borderLeftColor: 'var(--sp-syntax-color-plain)',
  },
  '.cm-gutters': {
    backgroundColor: 'var(--sp-colors-surface1, transparent)',
    color: 'var(--sp-colors-disabled)',
    border: 'none',
    paddingLeft: 'var(--sp-space-1, 4px)',
  },
  '.cm-gutter.cm-lineNumbers': {
    fontSize: '.6em',
  },
  '.cm-lineNumbers .cm-gutterElement': {
    lineHeight: 'var(--sp-font-lineHeight, 20px)',
    minWidth: 'var(--sp-space-5, 20px)',
  },
  '.cm-activeLineGutter': {
    backgroundColor: 'transparent',
  },
  '&.cm-focused .cm-selectionBackground, ::selection': {
    backgroundColor: 'var(--sp-colors-surface2)',
  },
  '.cm-selectionBackground': {
    backgroundColor: 'var(--sp-colors-surface2)',
  },
});

export function getLanguageExtension(filePath: string): Extension {
  if (filePath.endsWith('.css')) {
    return css();
  }
  const isTS = filePath.endsWith('.ts') || filePath.endsWith('.tsx');
  return javascript({jsx: true, typescript: isTS});
}
