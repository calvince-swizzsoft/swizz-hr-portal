import { useEffect, useRef, useState } from 'react';

export function Feedback({ error }) { return error ? <div className="feedback" role="alert">{error.message || error}{error.correlationId && <small>Reference: {error.correlationId}</small>}</div> : null; }
export function Field({ label, children }) { return <label className="field"><span>{label}</span>{children}</label>; }
export function Card({ title, children, action }) { return <section className="page-card"><header className="card-header"><h1>{title}</h1>{action}</header>{children}</section>; }
export function useLoad(load, dependencies) {
  const [data, setData] = useState(null); const [error, setError] = useState(null); const [loading, setLoading] = useState(true); const [revision, setRevision] = useState(0);
  const [loadedFor, setLoadedFor] = useState(null);
  useEffect(() => {
    const abort = new AbortController(); setLoading(true); setData(null); setError(null);
    Promise.resolve().then(() => load(abort.signal)).then(value => { if (!abort.signal.aborted) setData(value); }).catch(e => { if (!abort.signal.aborted) setError(e); }).finally(() => { if (!abort.signal.aborted) { setLoadedFor([...dependencies, revision]); setLoading(false); } });
    return () => abort.abort();
  }, [...dependencies, revision]);
  const current = loadedFor?.length === dependencies.length + 1 && [...dependencies, revision].every((value, index) => Object.is(value, loadedFor[index]));
  return { data: current ? data : null, error: current ? error : null, loading: loading || !current, retry: () => setRevision(x => x + 1) };
}
export function LoadState({ state }) {
  return state.loading ? <div className="empty" role="status">Loading...</div> : state.error ? <><Feedback error={state.error} /><button onClick={state.retry}>Try again</button></> : null;
}
export function useRefreshOnFocus(refresh) {
  const refreshRef = useRef(refresh);
  useEffect(() => { refreshRef.current = refresh; }, [refresh]);
  useEffect(() => {
    let lastRefresh = 0;
    function refreshVisiblePage() {
      if (document.visibilityState === 'hidden' || Date.now() - lastRefresh < 750) return;
      lastRefresh = Date.now();
      refreshRef.current();
    }
    window.addEventListener('focus', refreshVisiblePage);
    document.addEventListener('visibilitychange', refreshVisiblePage);
    return () => {
      window.removeEventListener('focus', refreshVisiblePage);
      document.removeEventListener('visibilitychange', refreshVisiblePage);
    };
  }, []);
}
