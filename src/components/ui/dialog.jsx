import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from './button';

export function Dialog({ open, onOpenChange, title, children, footer }) {
  if (!open) return null;

  return createPortal(
    <div className="ep-dialog-overlay" onClick={() => onOpenChange(false)}>
      <div className="ep-dialog" onClick={event => event.stopPropagation()}>
        <div className="ep-dialog-header">
          <div className="ep-dialog-title">{title}</div>
          <Button variant="ghost" className="ep-icon-button" onClick={() => onOpenChange(false)}>
            <X size={16} />
          </Button>
        </div>
        <div className="ep-dialog-body">{children}</div>
        {footer ? <div className="ep-dialog-footer">{footer}</div> : null}
      </div>
    </div>,
    document.body
  );
}
