interface Props {
  page: number;
  totalPages: number;
  disabled?: boolean;
  onPage: (page: number) => void;
}

export function Pager({ page, totalPages, disabled, onPage }: Props) {
  if (totalPages <= 1) return null;
  return (
    <div className="pager">
      <button className="btn small" type="button" disabled={disabled || page <= 1} onClick={() => onPage(page - 1)}>
        Previous
      </button>
      <span className="muted small">
        Page {page.toLocaleString()} of {totalPages.toLocaleString()}
      </span>
      <button className="btn small" type="button" disabled={disabled || page >= totalPages} onClick={() => onPage(page + 1)}>
        Next
      </button>
    </div>
  );
}
