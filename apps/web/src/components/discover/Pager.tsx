import { ChevronLeftIcon, ChevronRightIcon } from '../Icons';

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
      <span className="muted small">
        Page {page.toLocaleString()} of {totalPages.toLocaleString()}
      </span>
      <div className="pager-controls">
        <button className="btn small" type="button" disabled={disabled || page <= 1} onClick={() => onPage(page - 1)}>
          <ChevronLeftIcon size={14} />
          <span>Previous</span>
        </button>
        <button className="btn small" type="button" disabled={disabled || page >= totalPages} onClick={() => onPage(page + 1)}>
          <span>Next</span>
          <ChevronRightIcon size={14} />
        </button>
      </div>
    </div>
  );
}
