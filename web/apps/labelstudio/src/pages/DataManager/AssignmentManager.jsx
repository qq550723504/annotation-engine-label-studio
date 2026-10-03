import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Typography } from "@humansignal/ui";
import { Spinner } from "../../components/Spinner/Spinner";
import { useAPI } from "../../providers/ApiProvider";
import { cn } from "../../utils/bem";
import { useLocaleTranslation } from "@humansignal/i18n";
import { collaborationErrorCode, displayAssignmentStatus, displayCollaborationError } from "./collaborationDisplay";
import "./AssignmentManager.scss";

export const AssignmentManager = ({ projectId, taskId }) => {
  const { t } = useLocaleTranslation("collaboration");
  const api = useAPI();
  const callApiRef = useRef(api.callApi);
  callApiRef.current = api.callApi;

  const [assignments, setAssignments] = useState([]);
  const [eligibleUsers, setEligibleUsers] = useState([]);
  const [eligiblePage, setEligiblePage] = useState(1);
  const [eligibleHasNext, setEligibleHasNext] = useState(false);
  const [eligibleHasPrevious, setEligibleHasPrevious] = useState(false);
  const [selectedAssigneeId, setSelectedAssigneeId] = useState("");
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(null);
  const [error, setError] = useState("");
  const generationRef = useRef(0);

  const refresh = useCallback(async (page = eligiblePage) => {
    const generation = ++generationRef.current;
    setLoading(true);

    const [assignmentResult, assigneeResult] = await Promise.all([
      callApiRef.current("taskAssignments", {
        params: { project: projectId, task: taskId, active: true },
        errorFilter: () => true,
      }),
      callApiRef.current("eligibleTaskAssignees", {
        params: { project: projectId, page, page_size: 50 },
        errorFilter: () => true,
      }),
    ]);

    if (generationRef.current !== generation) return;

    if (
      !assignmentResult ||
      assignmentResult?.error ||
      assignmentResult?.$meta?.ok === false ||
      !assigneeResult ||
      assigneeResult?.error ||
      assigneeResult?.$meta?.ok === false
    ) {
      setError(collaborationErrorCode(
        assignmentResult?.error || assignmentResult?.$meta?.ok === false ? assignmentResult : assigneeResult,
        "assignmentsLoadFailed",
      ));
      setLoading(false);
      return;
    }

    setAssignments(Array.isArray(assignmentResult) ? assignmentResult : assignmentResult?.results ?? []);
    setEligibleUsers(Array.isArray(assigneeResult) ? assigneeResult : assigneeResult?.results ?? []);
    setEligibleHasNext(Boolean(assigneeResult?.next));
    setEligibleHasPrevious(Boolean(assigneeResult?.previous));
    setLoading(false);
  }, [eligiblePage, projectId, taskId]);

  useEffect(() => {
    refresh(eligiblePage);
    return () => {
      generationRef.current += 1;
    };
  }, [eligiblePage, refresh]);

  const activeAssigneeIds = useMemo(
    () => new Set(assignments.map((assignment) => assignment.assignee)),
    [assignments],
  );

  const userById = useMemo(
    () => new Map(eligibleUsers.map((user) => [user.id, user])),
    [eligibleUsers],
  );

  const availableUsers = useMemo(
    () => eligibleUsers.filter((user) => !activeAssigneeIds.has(user.id)),
    [eligibleUsers, activeAssigneeIds],
  );

  useEffect(() => {
    if (selectedAssigneeId && !availableUsers.some((user) => String(user.id) === String(selectedAssigneeId))) {
      setSelectedAssigneeId("");
    }
  }, [availableUsers, selectedAssigneeId]);

  const assign = async () => {
    if (!selectedAssigneeId) {
      setError("selectEligibleAssignee");
      return;
    }

    setProcessing("assign");
    setError("");

    const result = await callApiRef.current("createTaskAssignment", {
      body: {
        task: Number(taskId),
        assignee: Number(selectedAssigneeId),
      },
      errorFilter: () => true,
    });

    if (!result || result?.error || result?.$meta?.ok === false) {
      setError(collaborationErrorCode(result, "assignFailed"));
      setProcessing(null);
      await refresh(eligiblePage);
      return;
    }

    setSelectedAssigneeId("");
    await refresh(eligiblePage);
    setProcessing(null);
  };

  const cancel = async (assignment) => {
    setProcessing(`cancel-${assignment.id}`);
    setError("");

    const result = await callApiRef.current("deleteTaskAssignment", {
      params: { assignmentPk: assignment.id },
      errorFilter: () => true,
    });

    if (!result || result?.error || result?.$meta?.ok === false) {
      setError(collaborationErrorCode(result, "cancelAssignmentFailed"));
      setProcessing(null);
      await refresh(eligiblePage);
      return;
    }

    await refresh(eligiblePage);
    setProcessing(null);
  };

  if (loading) {
    return (
      <div className={cn("assignment-manager").toClassName()}>
        <Spinner size={32} />
      </div>
    );
  }

  return (
    <div className={cn("assignment-manager").toClassName()} data-testid="assignment-manager">
      <Typography variant="body" size="medium" className="!mb-base">
        {t("taskNumber", { id: taskId })}
      </Typography>

      {error && (
        <div className={cn("assignment-manager").elem("error").toClassName()} role="alert" data-testid="assignment-error">
          {displayCollaborationError(error, t)}
        </div>
      )}

      <div className={cn("assignment-manager").elem("assign").toClassName()}>
        <label htmlFor="task-assignee">{t("eligibleAssignee")}</label>
        <select
          id="task-assignee"
          data-testid="assignment-assignee-select"
          value={selectedAssigneeId}
          onChange={(event) => setSelectedAssigneeId(event.target.value)}
          disabled={processing !== null}
        >
          <option value="">{t("selectAssignee")}</option>
          {availableUsers.map((user) => (
            <option key={user.id} value={user.id}>
              {user.email || [user.first_name, user.last_name].filter(Boolean).join(" ") || `User ${user.id}`}
            </option>
          ))}
        </select>
        <Button
          data-testid="assignment-submit"
          disabled={!selectedAssigneeId || processing !== null}
          waiting={processing === "assign"}
          onClick={assign}
        >
          {t("assign")}
        </Button>
      </div>

      <div className={cn("assignment-manager").elem("pagination").toClassName()}>
        <Button
          size="small"
          look="outlined"
          disabled={!eligibleHasPrevious || processing !== null}
          onClick={async () => {
            const nextPage = Math.max(1, eligiblePage - 1);
            setEligiblePage(nextPage);
            setSelectedAssigneeId("");
            await refresh(nextPage);
          }}
        >
          {t("previousAssignees")}
        </Button>
        <span>{t("eligibleAssigneesPage", { page: eligiblePage })}</span>
        <Button
          size="small"
          look="outlined"
          disabled={!eligibleHasNext || processing !== null}
          onClick={async () => {
            const nextPage = eligiblePage + 1;
            setEligiblePage(nextPage);
            setSelectedAssigneeId("");
            await refresh(nextPage);
          }}
        >
          {t("nextAssignees")}
        </Button>
      </div>

      <div className={cn("assignment-manager").elem("list").toClassName()}>
        {assignments.length === 0 ? (
          <div data-testid="assignment-empty">{t("noActiveAssignments")}</div>
        ) : (
          assignments.map((assignment) => {
            const user = assignment.assignee_identity ?? userById.get(assignment.assignee);
            const identity =
              user?.email ||
              [user?.first_name, user?.last_name].filter(Boolean).join(" ") ||
              `User ${assignment.assignee}`;

            return (
              <div
                key={assignment.id}
                className={cn("assignment-manager").elem("row").toClassName()}
                data-testid={`assignment-row-${assignment.id}`}
              >
                <div>
                  <strong>{identity}</strong>
                  <span>{displayAssignmentStatus(assignment.status, t)}</span>
                  <span>v{assignment.version}</span>
                </div>
                <Button
                  size="small"
                  variant="negative"
                  look="outlined"
                  disabled={processing !== null}
                  waiting={processing === `cancel-${assignment.id}`}
                  onClick={() => cancel(assignment)}
                >
                  {t("cancelAssignment")}
                </Button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
