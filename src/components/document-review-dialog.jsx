import { useEffect, useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import { updateField } from '../lib/api';
import { getConfidenceTone, prettyJson } from '../lib/utils';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Dialog } from './ui/dialog';
import { Textarea } from './ui/textarea';

function ValidationCards({ validation }) {
  const completeness = validation?.completeness || {};
  const confidence = validation?.confidence || {};

  return (
    <div className="ep-stats-grid">
      <Card>
        <CardHeader><CardTitle>Total Fields</CardTitle></CardHeader>
        <CardContent className="ep-stat-value">{completeness.total_fields || 0}</CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Populated</CardTitle></CardHeader>
        <CardContent className="ep-stat-value">{completeness.populated_fields || 0}</CardContent>
      </Card>
      <Card>
        <CardHeader><CardTitle>Avg Confidence</CardTitle></CardHeader>
        <CardContent className="ep-stat-value">{Math.round((confidence.average || 0) * 100)}%</CardContent>
      </Card>
    </div>
  );
}

function ValidationIssues({ validation }) {
  const issues = validation?.issues || [];
  if (!issues.length) {
    return <Card className="ep-muted-panel"><CardContent>No validation issues were flagged. Human review is still recommended.</CardContent></Card>;
  }

  return (
    <div className="ep-issues-list">
      {issues.slice(0, 8).map((issue, index) => (
        <div key={`${issue.path}-${index}`} className="ep-issue-row">
          <div className="ep-issue-title">
            {issue.label || issue.path || 'Issue'} · {(issue.severity || 'info').toUpperCase()}
          </div>
          <div className="ep-issue-body">
            {issue.message} {issue.path ? `(${issue.path})` : ''}
          </div>
        </div>
      ))}
    </div>
  );
}

function JsonPanel({ title, value }) {
  return (
    <Card className="ep-json-panel">
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent>
        <pre className="ep-json-preview">{prettyJson(value)}</pre>
      </CardContent>
    </Card>
  );
}

export function DocumentReviewDialog({ open, document, onOpenChange, onExport, onRefresh }) {
  const [draftValues, setDraftValues] = useState({});
  const [saveState, setSaveState] = useState({});

  useEffect(() => {
    if (!document) return;
    const initial = {};
    document.fields?.forEach(field => {
      initial[field.id] = field.field_value ?? '';
    });
    setDraftValues(initial);
    setSaveState({});
  }, [document]);

  const title = useMemo(() => {
    if (!document) return 'Document Review';
    return (
      <div className="ep-dialog-title-block">
        <span>{document.filename}</span>
        <span className="ep-dialog-subtitle">{document.fields?.length || 0} fields</span>
      </div>
    );
  }, [document]);

  if (!document) {
    return null;
  }

  const handleSave = async field => {
    const nextValue = draftValues[field.id] ?? '';
    setSaveState(current => ({ ...current, [field.id]: 'saving' }));
    try {
      await updateField(field.id, nextValue);
      setSaveState(current => ({ ...current, [field.id]: 'saved' }));
      onRefresh?.();
      setTimeout(() => {
        setSaveState(current => ({ ...current, [field.id]: undefined }));
      }, 1400);
    } catch {
      setSaveState(current => ({ ...current, [field.id]: 'error' }));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      footer={
        <>
          <div className="ep-dialog-footer-note">Edits sync back to the flattened rows and stored structured output.</div>
          <Button variant="secondary" onClick={onExport}>
            <Download size={14} />
            Export This Document
          </Button>
        </>
      }
    >
      <div className="ep-review-grid">
        <Card>
          <CardHeader><CardTitle>AI Summary</CardTitle></CardHeader>
          <CardContent>{document.summary_text || document.structured_output?.summary || 'No summary available.'}</CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Metadata</CardTitle></CardHeader>
          <CardContent className="ep-meta-grid">
            <div><span>Document Type</span><Badge>{document.doc_type || 'Unknown'}</Badge></div>
            <div><span>Schema Source</span><Badge variant={document.schema_mode === 'predefined' ? 'success' : 'outline'}>{document.schema_label || 'AI Discover'}</Badge></div>
            <div><span>Detail Level</span><Badge variant="outline">{(document.detail_level || 'standard').toUpperCase()}</Badge></div>
            <div><span>Parsed At</span><span>{new Date(document.created_at).toLocaleString()}</span></div>
          </CardContent>
        </Card>
      </div>

      <ValidationCards validation={document.validation} />
      <ValidationIssues validation={document.validation} />

      <div className="ep-json-grid">
        <JsonPanel title="Extraction Spec" value={document.spec} />
        <JsonPanel title="Structured Output" value={document.structured_output} />
      </div>

      <Card>
        <CardHeader><CardTitle>Flattened Review Fields</CardTitle></CardHeader>
        <CardContent className="ep-table-wrap">
          <table className="ep-table">
            <thead>
              <tr>
                <th>Field</th>
                <th>Scope</th>
                <th>Value</th>
                <th>Type</th>
                <th>Confidence</th>
                <th>Evidence</th>
              </tr>
            </thead>
            <tbody>
              {document.fields?.length ? (
                document.fields.map(field => {
                  const tone = getConfidenceTone(Number(field.confidence || 0));
                  const scope = [field.section_label, field.entry_label].filter(Boolean).join(' · ') || 'Document';
                  const status = saveState[field.id];
                  return (
                    <tr key={field.id}>
                      <td>
                        <div className="ep-field-cell">
                          <div className="ep-field-label">{field.field_label || field.field_name || 'Field'}</div>
                          <div className="ep-field-path">{field.field_path}</div>
                        </div>
                      </td>
                      <td>{scope}</td>
                      <td>
                        <div className="ep-field-editor">
                          <Textarea
                            value={draftValues[field.id] ?? ''}
                            onChange={event => setDraftValues(current => ({ ...current, [field.id]: event.target.value }))}
                          />
                          <Button variant="ghost" onClick={() => handleSave(field)}>
                            {status === 'saving' ? 'Saving...' : status === 'saved' ? 'Saved' : status === 'error' ? 'Retry' : 'Save'}
                          </Button>
                        </div>
                      </td>
                      <td><Badge variant="outline">{field.data_type || 'text'}</Badge></td>
                      <td>
                        <div className="ep-confidence">
                          <div className="ep-confidence-track">
                            <div className={`ep-confidence-fill ep-confidence-${tone}`} style={{ width: `${Number(field.confidence || 0) * 100}%` }} />
                          </div>
                          <span>{Math.round(Number(field.confidence || 0) * 100)}%</span>
                        </div>
                      </td>
                      <td>
                        <div className="ep-evidence-pill" title={field.provenance || ''}>
                          {field.provenance || '—'}
                        </div>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={6}>
                    <div className="ep-empty-state">No flattened fields were stored for this document.</div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </Dialog>
  );
}
