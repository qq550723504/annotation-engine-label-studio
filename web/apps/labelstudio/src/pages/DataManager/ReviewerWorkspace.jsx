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

  const [submissions, setSubmissions] = useState([]);
  const [reviewableIds, setReviewableIds] = useState(new Set());
  const [selectedId, setSelectedId] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const generationRef = useRef(0);

  const refresh = useCallback(async () => {
    const generation = ++generationRef.current;
    setLoading(true);

    const [reviewableResult, historyResult] = await Promise.all([
      callApiRef.current("reviewableSubmissions", {
        params: { project: projectId, reviewable: true },
        errorFilter: () => true,
      }),
      callApiRef.current("projectSubmissions", {
        params: { project: projectId },
        errorFilter: () => true,
      }),
    ]);

    if (generationRef.current !== generation) return;

    if (
      !reviewableResult ||
      reviewableResult?.error ||
      reviewableResult?.$meta?.ok === false ||
      !historyResult ||
      historyResult?.error ||
      historyResult?.$meta?.ok === false
    ) {
      setError(
        errorMessage(
          reviewableResult?.error ? reviewableResult : historyResult,
          "Review workspace could not be loaded.",
        ),
      );
      setLoading(false);
      return;
    }

    const reviewableItems = Array.isArray(reviewableResult) ? reviewableResult : reviewableResult?.results ?? [];
    const historyItems = Array.isArray(historyResult) ? historyResult : historyResult?.results ?? [];
    const pendingIds = new Set(reviewableItems.map((item) => item.id));
    setReviewableIds(pendingIds);
    setSubmissions(historyItems);
    setSelectedId((current) => {
      if (current && historyItems.some((item) => item.id === current)) return current;
      return reviewableItems[0]?.id ?? historyItems[0]?.id ?? null;
    });
    setLoading(false);
  }, [projectId]);

  useEffect(() => {
    refresh();
    return () => {
      generationRef.current += 1;
    };
  }, [refresh]);

  const selected = useMemo(
    () => submissions.find((submission) => submission.id === selectedId) ?? null,
    [submissions, selectedId],
  );
  const pendingSubmissions = useMemo(
    () => submissions.filter((submission) => reviewableIds.has(submission.id)),
    [submissions, reviewableIds],
  );
  const historicalSubmissions = useMemo(
    () => submissions.filter((submission) => !reviewableIds.has(submission.id)),
    [submissions, reviewableIds],
  );
  const selectedIsReviewable = selected ? reviewableIds.has(selected.id) : false;

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
      await refresh();
      return;
    }

    setNotice(`Submission #${selected.id} revision ${selected.revision} was ${decision}.`);
    setRejectReason("");
    await refresh();
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

          <Typography variant="headline" size="small">Submission history</Typography>
          {historicalSubmissions.length === 0 ? (
            <div data-testid="review-history-empty">No reviewed submissions.</div>
          ) : (
            historicalSubmissions.map((submission) => (
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
