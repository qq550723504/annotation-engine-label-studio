import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Typography } from "@humansignal/ui";
import { Spinner } from "../../components/Spinner/Spinner";
import { useAPI } from "../../providers/ApiProvider";
import { cn } from "../../utils/bem";
import "./SubmissionReleaseWorkspace.scss";

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

const stableJson = (value) => JSON.stringify(value);

export const SubmissionReleaseWorkspace = ({ projectId }) => {
  const api = useAPI();
  const callApiRef = useRef(api.callApi);
  callApiRef.current = api.callApi;

  const [submissions, setSubmissions] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [hasPrevious, setHasPrevious] = useState(false);
  const [loading, setLoading] = useState(true);
  const [releasing, setReleasing] = useState(false);
  const [error, setError] = useState("");
  const [releaseResult, setReleaseResult] = useState(null);
  const generationRef = useRef(0);

  const refresh = useCallback(async (nextPage = page) => {
    const generation = ++generationRef.current;
    setLoading(true);

    let result = await callApiRef.current("projectSubmissions", {
      params: { project: projectId, page: nextPage, page_size: 50 },
      errorFilter: () => true,
    });

    if (generationRef.current !== generation) return;

    while (nextPage > 1 && result?.response?.detail === "Invalid page.") {
      nextPage -= 1;
      result = await callApiRef.current("projectSubmissions", {
        params: { project: projectId, page: nextPage, page_size: 50 },
        errorFilter: () => true,
      });
      if (generationRef.current !== generation) return;
    }

    if (!result || result?.error || result?.$meta?.ok === false) {
      setSubmissions([]);
      setSelectedId(null);
      setHasNext(false);
      setHasPrevious(false);
      setError(errorMessage(result, "Submission history could not be loaded."));
      setLoading(false);
      return;
    }

    const items = result?.results ?? [];
    setPage(nextPage);
    setSubmissions(items);
    setHasNext(Boolean(result?.next));
    setHasPrevious(Boolean(result?.previous));
    setSelectedId((current) => {
      if (current && items.some((item) => item.id === current)) return current;
      return items[0]?.id ?? null;
    });
    setLoading(false);
  }, [page, projectId]);

  useEffect(() => {
    refresh(page);
    return () => {
      generationRef.current += 1;
    };
  }, [page, refresh]);

  const selected = useMemo(
    () => submissions.find((submission) => submission.id === selectedId) ?? null,
    [selectedId, submissions],
  );

  useEffect(() => {
    setError("");
    setReleaseResult(null);
  }, [selectedId]);

  const release = async () => {
    if (!selected || selected.status !== "approved") return;

    setReleasing(true);
    setError("");
    setReleaseResult(null);

    const result = await callApiRef.current("releaseSubmission", {
      params: { submissionPk: selected.id },
      errorFilter: () => true,
    });

    if (!result || result?.error || result?.$meta?.ok === false) {
      setError(errorMessage(result, "The approved submission could not be released."));
      setReleasing(false);
      return;
    }

    if (
      result.submission_id !== selected.id ||
      result.revision !== selected.revision ||
      result.result_hash !== selected.result_hash ||
      stableJson(result.result_snapshot) !== stableJson(selected.result_snapshot)
    ) {
      setError("Release response did not match the selected immutable submission.");
      setReleasing(false);
      return;
    }

    setReleaseResult(result);
    setReleasing(false);
  };

  if (loading) {
    return (
      <div className={cn("submission-release-workspace").toClassName()}>
        <Spinner size={32} />
      </div>
    );
  }

  return (
    <div className={cn("submission-release-workspace").toClassName()} data-testid="submission-release-workspace">
      {error && (
        <div role="alert" data-testid="release-error">
          {error}
        </div>
      )}
      {releaseResult && (
        <div role="status" data-testid="release-success">
          Released revision {releaseResult.revision} with hash {releaseResult.result_hash}.
        </div>
      )}

      <div className={cn("submission-release-workspace").elem("layout").toClassName()}>
        <aside className={cn("submission-release-workspace").elem("history").toClassName()}>
          <Typography variant="headline" size="small">Submission history</Typography>
          {submissions.length === 0 ? (
            <div data-testid="release-history-empty">No submissions.</div>
          ) : (
            submissions.map((submission) => (
              <button
                key={submission.id}
                type="button"
                className={cn("submission-release-workspace").elem("history-item").mod({ active: submission.id === selectedId }).toClassName()}
                onClick={() => setSelectedId(submission.id)}
                data-testid={`release-submission-${submission.id}`}
              >
                <strong>Revision {submission.revision}</strong>
                <span>{submission.status}</span>
                <span>{displayIdentity(submission.submitted_by)}</span>
                <span>Task #{submission.result_snapshot?.task?.id ?? "?"}</span>
              </button>
            ))
          )}

          <div className={cn("submission-release-workspace").elem("pagination").toClassName()}>
            <Button
              size="small"
              look="outlined"
              disabled={!hasPrevious || releasing}
              onClick={() => {
                setSelectedId(null);
                setPage((current) => Math.max(1, current - 1));
              }}
            >
              Previous
            </Button>
            <span>Page {page}</span>
            <Button
              size="small"
              look="outlined"
              disabled={!hasNext || releasing}
              onClick={() => {
                setSelectedId(null);
                setPage((current) => current + 1);
              }}
            >
              Next
            </Button>
          </div>
        </aside>

        <section className={cn("submission-release-workspace").elem("detail").toClassName()}>
          {selected ? (
            <>
              <Typography variant="headline" size="small">
                Submission #{selected.id} · revision {selected.revision}
              </Typography>
              <span data-testid="release-status">{selected.status}</span>
              <span>Submitted by {displayIdentity(selected.submitted_by)}</span>
              <span>{selected.submitted_at}</span>
              {selected.review && (
                <div data-testid="release-review-metadata">
                  <span>Review: {selected.review.decision}</span>
                  <span>Reviewer: {displayIdentity(selected.review.reviewer)}</span>
                  {selected.review.reason && <span>Reason: {selected.review.reason}</span>}
                </div>
              )}
              <code data-testid="release-result-hash">{selected.result_hash}</code>
              <pre data-testid="release-result-snapshot">{JSON.stringify(selected.result_snapshot, null, 2)}</pre>

              {selected.status === "approved" && (
                <Button
                  data-testid="release-approved-submission"
                  disabled={releasing}
                  waiting={releasing}
                  onClick={release}
                >
                  Release approved revision
                </Button>
              )}
            </>
          ) : (
            <div data-testid="release-detail-empty">Select a submission revision.</div>
          )}
        </section>
      </div>
    </div>
  );
};
