import { useEffect, useRef } from 'react';
import { basicSetup, EditorView } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags } from '@lezer/highlight';
import { markdown } from '@codemirror/lang-markdown';
import { GFM } from '@lezer/markdown';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness';
import { yCollab } from 'y-codemirror.next';
import { livePreview } from '../public/live-preview.js';
import { resolveMarkdownCodeLanguage } from '../shared/code-languages.js';

const markdownHighlightStyle = HighlightStyle.define([
  { tag: tags.heading, class: 'cm-md-heading' },
  { tag: tags.monospace, class: 'cm-md-inline-code' },
  { tag: tags.processingInstruction, class: 'cm-md-mark' },
  { tag: tags.link, class: 'cm-md-link' },
  { tag: tags.url, class: 'cm-md-url' },
  { tag: tags.comment, class: 'tok-comment' },
  { tag: tags.meta, class: 'tok-meta' },
  { tag: [tags.keyword, tags.atom, tags.bool, tags.literal, tags.number], class: 'tok-keyword' },
  { tag: [tags.string, tags.special(tags.string)], class: 'tok-string' },
  { tag: [tags.regexp, tags.escape], class: 'tok-string2' },
  { tag: [tags.variableName, tags.local(tags.variableName), tags.special(tags.variableName)], class: 'tok-variableName' },
  { tag: [tags.definition(tags.variableName), tags.definition(tags.propertyName)], class: 'tok-variableName2' },
  { tag: tags.propertyName, class: 'tok-propertyName' },
  { tag: [tags.typeName, tags.namespace], class: 'tok-typeName' },
  { tag: tags.className, class: 'tok-className' },
  { tag: tags.macroName, class: 'tok-macroName' },
  { tag: tags.operator, class: 'tok-operator' },
  { tag: tags.punctuation, class: 'tok-punctuation' },
  { tag: tags.invalid, class: 'tok-invalid' },
  { tag: tags.deleted, class: 'tok-deleted' },
  { tag: tags.inserted, class: 'tok-inserted' },
]);

interface MarkdownEditorProps {
  content: string;
  editable: boolean;
  resolveImageUrl: (source: string) => string | null;
  doc?: Y.Doc;
  awareness?: Awareness;
  className?: string;
  disabledOverlayLabel?: string;
  staticPreview?: boolean;
}

export function MarkdownEditor({
  content,
  editable,
  resolveImageUrl,
  doc,
  awareness,
  className,
  disabledOverlayLabel,
  staticPreview = false,
}: MarkdownEditorProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hostRef.current) {
      return;
    }

    const yText = doc?.getText('content');
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: yText?.toString() ?? content,
        extensions: [
          basicSetup,
          syntaxHighlighting(markdownHighlightStyle),
          markdown({ codeLanguages: resolveMarkdownCodeLanguage, extensions: [GFM] }),
          livePreview({ resolveImageUrl, revealActiveSource: !staticPreview, interactive: editable && !staticPreview }),
          ...(yText && awareness ? [yCollab(yText, awareness)] : []),
          EditorState.readOnly.of(!editable),
          EditorView.editable.of(editable),
          ...(staticPreview
            ? [
                EditorView.contentAttributes.of({ tabIndex: '-1', 'aria-readonly': 'true' }),
                EditorView.domEventHandlers({
                  mousedown: (event) => {
                    if (event.target instanceof Element && event.target.closest('.cm-content')) {
                      event.preventDefault();
                      return true;
                    }
                    return false;
                  },
                }),
              ]
            : []),
          EditorView.theme({
            '&': {
              backgroundColor: 'transparent',
              color: 'var(--text)',
              caretColor: 'var(--accent)',
              fontSize: '1rem',
              lineHeight: '1.8rem',
            },
            '.cm-scroller': {
              padding: '0',
              fontFamily: 'var(--font-mono)',
            },
            '.cm-content': {
              minHeight: doc ? '64vh' : '100%',
              padding: '22px 24px 84px',
              maxWidth: '76ch',
              margin: '0 auto',
              lineHeight: '1.8rem',
            },
            '.cm-focused': {
              outline: 'none',
            },
            '.cm-content[contenteditable="false"]': {
              cursor: 'default',
            },
            '.cm-gutters': {
              display: 'none',
            },
            '.cm-activeLineGutter': {
              display: 'none',
            },
            '.cm-activeLine': {
              backgroundColor: 'rgba(255, 255, 255, 0.02)',
            },
            '.cm-cursor': {
              borderLeftColor: 'var(--accent)',
              borderLeftWidth: '2px',
            },
            '.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection': {
              backgroundColor: 'rgba(124, 58, 237, 0.2)',
            },
            '.cm-ySelectionCaret': {
              borderRadius: '999px 999px 999px 0',
              minHeight: '1.35em',
              paddingInline: '0.22rem',
              borderWidth: '1px',
              boxShadow: '0 0 0 1px rgba(5, 6, 8, 0.4)',
            },
            '.cm-ySelectionCaretDot': {
              display: 'none',
            },
            '.cm-ySelectionInfo': {
              opacity: '1',
              transform: 'translateY(-2px)',
              fontFamily: 'var(--font-sans)',
              fontSize: '0.72rem',
              letterSpacing: '0.02em',
              borderRadius: '999px',
              padding: '0.08rem 0.42rem',
              boxShadow: '0 0 0 1px rgba(5, 6, 8, 0.28)',
            },
            '.cm-ySelection': {
              borderRadius: '0.35rem',
            },
          }),
          EditorView.lineWrapping,
        ],
      }),
    });

    return () => view.destroy();
  }, [awareness, content, doc, editable, resolveImageUrl, staticPreview]);

  return (
    <div
      className={['editor-host', className, staticPreview ? 'is-static' : ''].filter(Boolean).join(' ')}
      ref={hostRef}
      aria-readonly={!editable || undefined}
    >
      {!editable && disabledOverlayLabel ? <div className="editor-disabled-overlay">{disabledOverlayLabel}</div> : null}
    </div>
  );
}
