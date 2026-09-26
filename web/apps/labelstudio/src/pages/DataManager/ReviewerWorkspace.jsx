import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Typography } from "@humansignal/ui";
import { Spinner } from "../../components/Spinner/Spinner";
import { useAPI } from "../../providers/ApiProvider";
import { cn } from "../../utils/bem";
import "./ReviewerWorkspace.scss";

const flattenError = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(flattenError);
  if (typeof value === "object") return Object.values(value).flatMap(flattenError);
  return [String(value)];
};

const errorMessage = (result, fallback) => {
  const messages = flattenError(result?.response);
  return messages.length ? messages.join(" ") : result?.error ?? fallback;
};

const displayIdentity = (user) =>
  user?.email || [user?.first_name, user?.last_name].filter(Boolean).join(" ") || "Unknown submitter";

export const ReviewerWorkspace = ({ projectId }) => {
  const api = useAPI();
  const callApiRef = useRef(api.callApi);
  callApiRef.current = api.callApi;

  const [pendingSubmissions, setPendingSubmissions] = useState([]);
  const [historySubmissions, setHistorySubmissions] = useState([]);
  const [pendingPage, setPendingPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const [pendingHasNext, setPendingHasNext] = useState(false);
  const [pendingHasPrevious, setPendingHasPrevious] = useState(false);
  const [historyHasNext, setHistoryHasNext] = useState(false);
  const [historyHasPrevious, setHistoryHasPrevious] = useState(false);
  const [selectedId, setSelectedId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const generationRef = useRef(0);

  const loadPages = useCallback(async (nextPendingPage, nextHistoryPage) => {
    return Promise.all([
      callApiRef.current("reviewableSubmissions", {
        params: {
          project: projectId,
          reviewable: true,
          page: nextPendingPage,
          page_size: 50,
        },
        errorFilter: () => true,
      }),
      callApiRef.current("projectSubmissions", {
        params: {
          project: projectId,
          history: true,
          page: nextHistoryPage,
          page_size: 50,
        },
        errorFilter: () => true,
      }),
    ]);
  }, [projectId]);

  const refresh = useCallback(async (nextPendingPage = pendingPage, nextHistoryPage = historyPage) => {
    const generation = ++generationRef.current;
    setLoading(true);

    let [reviewableResult, historyResult] = await loadPages(nextPendingPage, nextHistoryPage);

    if (generationRef.current !== generation) return;

    if (
      nextPendingPage > 1 &&
      reviewableResult?.response?.detail === "Invalid page."
    ) {
      const fallbackPendingPage = nextPendingPage - 1;
      [reviewableResult, historyResult] = await loadPages(fallbackPendingPage, nextHistoryPage);
      if (generationRef.current !== generation) return;
      nextPendingPage = fallbackPendingPage;
      setPendingPage(fallbackPendingPage);
    }

    if (
      !reviewableResult ||
      reviewableResult?.error ||
      reviewableResult?.$meta?.ok === false ||
      !historyResult ||
      historyResult?.error ||
      historyResult?.$meta?.ok === false
    ) {
      setPendingSubmissions([]);
      setHistorySubmissions([]);
      setSelectedId(null);
      setPendingHasNext(false);
      setPendingHasPrevious(false);
      setHistoryHasNext(false);
      setHistoryHasPrevious(false);
      setError(
        errorMessage(
          reviewableResult?.error ? reviewableResult : historyResult,
          "Review workspace could not be loaded.",
        ),
      );
      setLoading(false);
      return;
    }

    const pendingItems = reviewableResult?.results ?? [];
    const historyItems = (historyResult?.results ?? []).filter((item) => item.status !== "pending");

    setPendingPage(nextPendingPage);
    setHistoryPage(nextHistoryPage);
    setPendingSubmissions(pendingItems);
    setHistorySubmissions(historyItems);
    setPendingHasNext(Boolean(reviewableResult?.next));
    setPendingHasPrevious(Boolean(reviewableResult?.previous));
    setHistoryHasNext(Boolean(historyResult?.next));
    setHistoryHasPrevious(Boolean(historyResult?.previous));
    setSelectedId((current) => {
      if (current && [...pendingItems, ...historyItems].some((item) => item.id === current)) return current;
      return pendingItems[0]?.id ?? historyItems[0]?.id ?? null;
    });
    setLoading(false);
  }, [historyPage, loadPages, pendingPage, projectId]);

  useEffect(() => {
    refresh(pendingPage, historyPage);
    return () => {
      generationRef.current += 1;
    };
  }, [historyPage, pendingPage, refresh]);

  const selected = useMemo(
    () =>
      [...pendingSubmissions, ...historySubmissions].find((submission) => submission.id === selectedId) ?? null,
    [historySubmissions, pendingSubmissions, selectedId],
  );
  const selectedIsReviewable = selected
    ? pendingSubmissions.some((submission) => submission.id === selected.id)
    : false;

  useEffect(() => {
    setRejectReason("");
    setError("");
  }, [selectedId]);

  const decide = async (decision) => {
    if (!selected) return;
    if (decision === "rejected" && !rejectReason.trim()) {
      setError("A rejection reason is required.");
      return;
    }

    setProcessing(decision);
    setError("");
    setNotice("");

    const result = await callApiRef.current("reviewSubmission", {
      params: { submissionPk: selected.id },
      body: {
        decision,
        reason: decision === "rejected" ? rejectReason.trim() : "",
      },
      errorFilter: () => true,
    });

    if (!result || result?.error || result?.$meta?.ok === false) {
      setError(errorMessage(result, "The review decision could not be saved."));
      setProcessing(null);
      await refresh(pendingPage, historyPage);
      return;
    }

    setNotice(`Submission #${selected.id} revision ${selected.revision} was ${decision}.`);
    setRejectReason("");
    await refresh(pendingPage, historyPage);
    setProcessing(null);
  };

  if (loading) {
    return (
      <div className={cn("reviewer-workspace").toClassName()}>
        <Spinner size={32} />
      </div>
    );
  }

  return (
    <div className={cn("reviewer-workspace").toClassName()} data-testid="reviewer-workspace">
      {notice && (
        <div className={cn("reviewer-workspace").elem("notice").toClassName()} role="status">
          {notice}
        </div>
      )}
      {error && (
        <div className={cn("reviewer-workspace").elem("error").toClassName()} role="alert" data-testid="review-error">
          {error}
        </div>
      )}

      <div className={cn("reviewer-workspace").elem("layout").toClassName()}>
        <aside className={cn("reviewer-workspace").elem("queue").toClassName()}>
          <Typography variant="headline" size="small">Pending reviews</Typography>
          {pendingSubmissions.length === 0 ? (
            <div data-testid="review-queue-empty">No pending submissions.</div>
          ) : (
            pendingSubmissions.map((submission) => (
              <button
                key={submission.id}
                type="button"
                className={cn("reviewer-workspace").elem("queue-item").mod({ active: submission.id === selectedId }).toClassName()}
                onClick={() => setSelectedId(submission.id)}
                data-testid={`review-submission-${submission.id}`}
              >
                <strong>Revision {submission.revision}</strong>
                <span>{displayIdentity(submission.submitted_by)}</span>
                <span>#{submission.id}</span>
              </button>
            ))
          )}
          <div className={cn("reviewer-workspace").elem("pagination").toClassName()}>
            <Button
              size="small"
              look="outlined"
              disabled={!pendingHasPrevious || processing !== null}
              onClick={() => {
                setPendingPage((page) => Math.max(1, page - 1));
                setSelectedId(null);
              }}
            >
              Previous pending
            </Button>
            <span>Page {pendingPage}</span>
            <Button
              size="small"
              look="outlined"
              disabled={!pendingHasNext || processing !== null}
              onClick={() => {
                setPendingPage((page) => page + 1);
                setSelectedId(null);
              }}
            >
              Next pending
            </Button>
          </div>

          <Typography variant="headline" size="small">Submission history</Typography>
          {historySubmissions.length === 0 ? (
            <div data-testid="review-history-empty">No reviewed submissions.</div>
          ) : (
            historySubmissions.map((submission) => (
              <button
                key={submission.id}
                type="button"
                className={cn("reviewer-workspace").elem("queue-item").mod({ active: submission.id === selectedId }).toClassName()}
                onClick={() => setSelectedId(submission.id)}
                data-testid={`review-history-${submission.id}`}
              >
                <strong>Revision {submission.revision}</strong>
                <span>{submission.status}</span>
                <span>{displayIdentity(submission.submitted_by)}</span>
              </button>
            ))
          )}
          <div className={cn("reviewer-workspace").elem("pagination").toClassName()}>
            <Button
              size="small"
              look="outlined"
              disabled={!historyHasPrevious || processing !== null}
              onClick={() => {
                setHistoryPage((page) => Math.max(1, page - 1));
                setSelectedId(null);
              }}
            >
              Previous history
            </Button>
            <span>Page {historyPage}</span>
            <Button
              size="small"
              look="outlined"
              disabled={!historyHasNext || processing !== null}
              onClick={() => {
                setHistoryPage((page) => page + 1);
                setSelectedId(null);
              }}
            >
              Next history
            </Button>
          </div>
        </aside>

        <section className={cn("reviewer-workspace").elem("detail").toClassName()}>
          {selected ? (
            <>
              <div className={cn("reviewer-workspace").elem("meta").toClassName()}>
                <Typography variant="headline" size="small">
                  Submission #{selected.id} · revision {selected.revision}
                </Typography>
                <span>Submitted by {displayIdentity(selected.submitted_by)}</span>
                <span>{selected.submitted_at}</span>
                <span data-testid="review-status">{selected.status}</span>
                <code data-testid="review-result-hash">{selected.result_hash}</code>
              </div>

              <div>
                <Typography variant="body" size="medium">Immutable submitted snapshot</Typography>
                <pre data-testid="review-result-snapshot">
                  {JSON.stringify(selected.result_snapshot, null, 2)}
                </pre>
              </div>

              {selectedIsReviewable && (
                <>
                  <label htmlFor="review-reject-reason">Rejection reason</label>
                  <textarea
                    id="review-reject-reason"
                    data-testid="review-reject-reason"
                    value={rejectReason}
                    onChange={(event) => setRejectReason(event.target.value)}
                    disabled={processing !== null}
                    rows={3}
                  />

                  <div className={cn("reviewer-workspace").elem("actions").toClassName()}>
                    <Button
                      data-testid="review-approve"
                      disabled={processing !== null}
                      waiting={processing === "approved"}
                      onClick={() => decide("approved")}
                    >
                      Approve
                    </Button>
                    <Button
                      data-testid="review-reject"
                      variant="negative"
                      look="outlined"
                      disabled={processing !== null}
                      waiting={processing === "rejected"}
                      onClick={() => decide("rejected")}
                    >
                      Reject
                    </Button>
                  </div>
                </>
              )}
            </>
          ) : (
            <div data-testid="review-detail-empty">Select a pending submission.</div>
          )}
        </section>
      </div>
    </div>
  );
};
