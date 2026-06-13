import { scrollToId } from "../lib/dom";
import type { HeadingInfo } from "./Preview";

interface OutlineProps {
  headings: HeadingInfo[];
  activeId: string | null;
}

export function Outline({ headings, activeId }: OutlineProps): React.ReactElement {
  const handleClick = (id: string): void => {
    scrollToId(document.querySelector(".preview") ?? document, id);
  };

  const minLevel = headings.reduce((min, heading) => Math.min(min, heading.level), 6);

  return (
    <aside className="outline" aria-label="On this page">
      <div className="sidebar-heading">On this page</div>
      {headings.length === 0 ? (
        <p className="outline-empty">見出しはありません</p>
      ) : (
        <ul>
          {headings.map((heading) => (
            <li
              key={heading.id}
              className={`outline-item indent-${Math.min(heading.level - minLevel, 3)}${
                heading.id === activeId ? " active" : ""
              }`}
            >
              <button type="button" onClick={() => handleClick(heading.id)}>
                {heading.text}
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
