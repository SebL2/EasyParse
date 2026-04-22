import { useEffect, useMemo, useState } from 'react';
import { Bot, LoaderCircle } from 'lucide-react';
import { deleteDocument, exportUrl, fetchDocument, fetchDocuments, fetchSchemas, uploadDocuments } from './lib/api';
import { DocumentsTable } from './components/documents-table';
import { DocumentReviewDialog } from './components/document-review-dialog';
import { UploadPanel } from './components/upload-panel';
import { Badge } from './components/ui/badge';
import { Button } from './components/ui/button';

export default function App() {
  const [schemas, setSchemas] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [queue, setQueue] = useState([]);
  const [detailLevel, setDetailLevel] = useState('standard');
  const [schemaMode, setSchemaMode] = useState('discover');
  const [schemaId, setSchemaId] = useState('');
  const [status, setStatus] = useState(null);
  const [selectedIds, setSelectedIds] = useState([]);
  const [processing, setProcessing] = useState(false);
  const [loading, setLoading] = useState(true);
  const [activeDocument, setActiveDocument] = useState(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const loadDocuments = async () => {
    const docs = await fetchDocuments();
    setDocuments(docs);
  };

  const loadSchemas = async () => {
    const response = await fetchSchemas();
    const predefined = response.predefined || [];
    setSchemas(predefined);
    if (!schemaId && predefined.length) {
      setSchemaId(predefined[0].id);
    }
  };

  useEffect(() => {
    (async () => {
      try {
        await Promise.all([loadDocuments(), loadSchemas()]);
      } catch (error) {
        setStatus({ type: 'error', message: error.message });
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const selectedIdStrings = useMemo(() => selectedIds.map(String), [selectedIds]);

  const addFiles = files => {
    setQueue(current => {
      const existing = new Set(current.map(file => `${file.name}:${file.size}`));
      const next = files.filter(file => {
        const key = `${file.name}:${file.size}`;
        if (existing.has(key)) return false;
        existing.add(key);
        return true;
      });
      return [...current, ...next];
    });
  };

  const processQueue = async () => {
    if (!queue.length) return;

    setProcessing(true);
    setStatus(null);

    try {
      const result = await uploadDocuments({
        files: queue,
        detailLevel,
        schemaMode,
        schemaId,
      });

      const totalIssues = (result.results || []).reduce((sum, item) => sum + Number(item.issue_count || 0), 0);
      setStatus({
        type: result.errors?.length ? 'error' : 'success',
        message: result.errors?.length
          ? result.errors.map(item => `${item.filename}: ${item.error}`).join(' | ')
          : `Processed ${result.results?.length || 0} document${result.results?.length === 1 ? '' : 's'} with ${totalIssues} validation issue${totalIssues === 1 ? '' : 's'}.`,
      });
      setQueue([]);
      await loadDocuments();
    } catch (error) {
      setStatus({ type: 'error', message: error.message });
    } finally {
      setProcessing(false);
    }
  };

  const toggleSelect = id => {
    setSelectedIds(current =>
      current.includes(String(id))
        ? current.filter(item => item !== String(id))
        : [...current, String(id)]
    );
  };

  const toggleSelectAll = () => {
    if (selectedIds.length === documents.length) {
      setSelectedIds([]);
      return;
    }
    setSelectedIds(documents.map(doc => String(doc.id)));
  };

  const deleteSelected = async () => {
    if (!selectedIds.length) return;
    if (!window.confirm(`Delete ${selectedIds.length} document${selectedIds.length === 1 ? '' : 's'} and all extracted data?`)) {
      return;
    }

    await Promise.all(selectedIds.map(id => deleteDocument(id)));
    setSelectedIds([]);
    await loadDocuments();
  };

  const openDocument = async id => {
    const document = await fetchDocument(id);
    setActiveDocument(document);
    setDialogOpen(true);
  };

  const refreshActiveDocument = async () => {
    if (!activeDocument?.id) return;
    const document = await fetchDocument(activeDocument.id);
    setActiveDocument(document);
    await loadDocuments();
  };

  return (
    <div className="ep-app-shell">
      <header className="ep-topbar">
        <div>
          <div className="ep-logo">easy<span>parse</span></div>
          <div className="ep-tagline">React + shadcn-style UI for schema-aware PDF extraction</div>
        </div>
        <div className="ep-topbar-actions">
          <Badge variant="outline"><Bot size={12} /> Spec-driven pipeline</Badge>
          {loading ? (
            <Button variant="ghost" disabled>
              <LoaderCircle size={14} className="ep-spin" />
              Loading
            </Button>
          ) : null}
        </div>
      </header>

      <main className="ep-main">
        <UploadPanel
          files={queue}
          onFilesAdded={addFiles}
          onRemoveFile={index => setQueue(current => current.filter((_, itemIndex) => itemIndex !== index))}
          onClearQueue={() => setQueue([])}
          onProcess={processQueue}
          processing={processing}
          detailLevel={detailLevel}
          onDetailLevelChange={setDetailLevel}
          schemaMode={schemaMode}
          onSchemaModeChange={setSchemaMode}
          schemaId={schemaId}
          onSchemaIdChange={setSchemaId}
          schemas={schemas}
          status={status}
        />

        <DocumentsTable
          documents={documents}
          selectedIds={selectedIdStrings}
          onToggleSelect={toggleSelect}
          onToggleSelectAll={toggleSelectAll}
          onOpen={openDocument}
          onDeleteSelected={deleteSelected}
          onExportSelected={() => { window.location.href = exportUrl(selectedIds); }}
          onExportAll={() => { window.location.href = exportUrl(); }}
        />
      </main>

      <DocumentReviewDialog
        open={dialogOpen}
        document={activeDocument}
        onOpenChange={open => {
          setDialogOpen(open);
          if (!open) {
            setActiveDocument(null);
            loadDocuments();
          }
        }}
        onExport={() => {
          if (activeDocument?.id) {
            window.location.href = exportUrl([activeDocument.id]);
          }
        }}
        onRefresh={refreshActiveDocument}
      />
    </div>
  );
}
