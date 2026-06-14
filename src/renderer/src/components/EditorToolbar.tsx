import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  Image,
  Italic,
  Link,
  List,
  ListChecks,
  ListOrdered,
  ListTree,
  type LucideIcon,
  Minus,
  Quote,
  SquareCode,
  Strikethrough,
  Table,
} from "lucide-react";
import type { FormatAction } from "../lib/format";

interface FormatButton {
  action: FormatAction;
  icon: LucideIcon;
  label: string;
  shortcut?: string;
}

const MOD = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl+";

const GROUPS: FormatButton[][] = [
  [
    { action: "bold", icon: Bold, label: "太字", shortcut: `${MOD}B` },
    { action: "italic", icon: Italic, label: "斜体", shortcut: `${MOD}I` },
    { action: "strikethrough", icon: Strikethrough, label: "打ち消し線" },
    { action: "code", icon: Code, label: "インラインコード" },
  ],
  [
    { action: "h1", icon: Heading1, label: "見出し 1" },
    { action: "h2", icon: Heading2, label: "見出し 2" },
    { action: "h3", icon: Heading3, label: "見出し 3" },
  ],
  [
    { action: "ul", icon: List, label: "箇条書き" },
    { action: "ol", icon: ListOrdered, label: "番号付きリスト" },
    { action: "task", icon: ListChecks, label: "タスクリスト" },
    { action: "quote", icon: Quote, label: "引用" },
  ],
  [
    { action: "link", icon: Link, label: "リンク", shortcut: `${MOD}K` },
    { action: "image", icon: Image, label: "画像" },
    { action: "codeblock", icon: SquareCode, label: "コードブロック" },
    { action: "table", icon: Table, label: "テーブル" },
    { action: "hr", icon: Minus, label: "区切り線" },
    { action: "toc", icon: ListTree, label: "目次を挿入" },
  ],
];

interface EditorToolbarProps {
  onAction: (action: FormatAction) => void;
}

export function EditorToolbar({ onAction }: EditorToolbarProps): React.ReactElement {
  return (
    <div className="editor-toolbar" role="toolbar" aria-label="Markdown 書式">
      {GROUPS.map((group, index) => (
        <div className="editor-toolbar-group" key={index}>
          {group.map((button) => {
            const Icon = button.icon;
            const title = button.shortcut ? `${button.label} (${button.shortcut})` : button.label;
            return (
              <button
                key={button.action}
                type="button"
                className="editor-format-button"
                title={title}
                aria-label={title}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => onAction(button.action)}
              >
                <Icon size={15} aria-hidden="true" />
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
