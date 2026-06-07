import type { VirtualPage } from "../lib/pages";

interface PagesNavProps {
  pages: VirtualPage[];
  activeIndex: number;
  onSelect: (index: number) => void;
}

export function PagesNav({ pages, activeIndex, onSelect }: PagesNavProps): React.ReactElement {
  const handleKeyDown = (event: React.KeyboardEvent<HTMLUListElement>): void => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      onSelect(Math.min(activeIndex + 1, pages.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      onSelect(Math.max(activeIndex - 1, 0));
    } else if (event.key === "Home") {
      event.preventDefault();
      onSelect(0);
    } else if (event.key === "End") {
      event.preventDefault();
      onSelect(pages.length - 1);
    }
  };

  return (
    <nav className="pages-nav" aria-label="ページナビゲーション">
      <div className="sidebar-heading">Pages</div>
      <ul
        role="listbox"
        aria-label="ページ一覧"
        tabIndex={0}
        onKeyDown={handleKeyDown}
        aria-activedescendant={pages[activeIndex] ? `page-opt-${activeIndex}` : undefined}
      >
        {pages.map((page, index) => (
          <li
            key={page.id}
            id={`page-opt-${index}`}
            role="option"
            aria-selected={index === activeIndex}
            className={`page-item depth-${page.depth}${index === activeIndex ? " active" : ""}`}
            onClick={() => onSelect(index)}
          >
            <span className="page-item-title">{page.title}</span>
          </li>
        ))}
      </ul>
    </nav>
  );
}
