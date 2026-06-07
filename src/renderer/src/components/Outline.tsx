import type { HeadingInfo } from "./Preview";

interface OutlineProps {
  headings: HeadingInfo[];
  activeId: string | null;
}

export function Outline({ headings, activeId }: OutlineProps): React.ReactElement {
  const handleClick = (id: string): void => {
    const root = document.querySelector(".preview") ?? document;
    const element = root.querySelector(`[id="${CSS.escape(id)}"]`);
    if (element) element.scrollIntoView({ behavior: "smooth", block: "start" });
  };

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
              className={`outline-item level-${heading.level}${heading.id === activeId ? " active" : ""}`}
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
