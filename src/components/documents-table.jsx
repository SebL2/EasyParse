import { Download, Eye, Trash2 } from 'lucide-react';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './ui/card';

function schemaBadge(doc) {
  if (doc.schema_mode === 'predefined') {
    return <Badge variant="success">{doc.schema_label || 'Predefined Schema'}</Badge>;
  }
  return <Badge variant="outline">{doc.schema_label || 'AI Discover'}</Badge>;
}

export function DocumentsTable({
  documents,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onOpen,
  onDeleteSelected,
  onExportSelected,
  onExportAll,
}) {
  const allSelected = documents.length > 0 && selectedIds.length === documents.length;

  return (
    <Card className="ep-section-card">
      <CardHeader>
        <div className="ep-section-headline">02 / Parsed Documents</div>
        <CardTitle>Review queue</CardTitle>
        <CardDescription>Each document keeps its schema source, structured output, validation report, and flattened review rows.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="ep-table-toolbar">
          <div className="ep-table-actions">
            <Button variant="secondary" onClick={onExportSelected} disabled={!selectedIds.length}>
              <Download size={14} />
              Export Selected
            </Button>
            <Button variant="secondary" onClick={onExportAll} disabled={!documents.length}>
              <Download size={14} />
              Export All
            </Button>
          </div>
          <Button variant="danger" onClick={onDeleteSelected} disabled={!selectedIds.length}>
            <Trash2 size={14} />
            Delete Selected
          </Button>
        </div>

        <div className="ep-table-wrap">
          <table className="ep-table">
            <thead>
              <tr>
                <th>
                  <input type="checkbox" checked={allSelected} onChange={onToggleSelectAll} />
                </th>
                <th>Filename</th>
                <th>Type</th>
                <th>Schema</th>
                <th>Detail</th>
                <th>Fields</th>
                <th>Issues</th>
                <th>Parsed At</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {!documents.length ? (
                <tr>
                  <td colSpan={9}>
                    <div className="ep-empty-state">No documents parsed yet. Upload PDFs above to get started.</div>
                  </td>
                </tr>
              ) : (
                documents.map(doc => (
                  <tr key={doc.id}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(String(doc.id))}
                        onChange={() => onToggleSelect(doc.id)}
                      />
                    </td>
                    <td>
                      <div className="ep-doc-cell">
                        <div className="ep-doc-name">{doc.filename}</div>
                        <div className="ep-doc-summary">{doc.summary_text || 'No AI summary available.'}</div>
                      </div>
                    </td>
                    <td><Badge>{doc.doc_type || 'Unknown'}</Badge></td>
                    <td>{schemaBadge(doc)}</td>
                    <td><Badge variant="outline">{(doc.detail_level || 'standard').toUpperCase()}</Badge></td>
                    <td>{doc.field_count || 0}</td>
                    <td>
                      {doc.issue_count ? (
                        <Badge variant="warning">{doc.issue_count} issue{doc.issue_count === 1 ? '' : 's'}</Badge>
                      ) : (
                        <Badge variant="success">Clean</Badge>
                      )}
                    </td>
                    <td>{new Date(doc.created_at).toLocaleString()}</td>
                    <td>
                      <Button variant="ghost" onClick={() => onOpen(doc.id)}>
                        <Eye size={14} />
                        View
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}
