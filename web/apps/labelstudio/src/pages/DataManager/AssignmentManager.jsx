import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Typography } from "@humansignal/ui";
import { Spinner } from "../../components/Spinner/Spinner";
import { useAPI } from "../../providers/ApiProvider";
import { cn } from "../../utils/bem";
import "./AssignmentManager.scss";

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

export const AssignmentManager = ({ projectId, taskId }) => {
  const api = useAPI();
  const callApiRef = useRef(api.callApi);
  callApiRef.current = api.callApi;

  const [assignments, setAssignments] = useState([]);
  const [eligibleUsers, setEligibleUsers] = useState([]);
  const [selectedAssigneeId, setSelectedAssigneeId] = useState("");
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(null);
  const [error, setError] = useState("");
  const generationRef = useRef(0);

  const refresh = useCallback(async () => {
    const generation = ++generationRef.current;
    setLoading(true);

    const [assignmentResult, assigneeResult] = await Promise.all([
      callApiRef.current("taskAssignments", {
        params: { project: projectId, task: taskId, active: true },
        errorFilter: () => true,
      }),
      callApiRef.current("eligibleTaskAssignees", {
        params: { project: projectId },
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
      setError(
        errorMessage(
          assignmentResult?.error ? assignmentResult : assigneeResult,
          "Task assignments could not be loaded.",
        ),
      );
      setLoading(false);
      return;
    }

    setAssignments(Array.isArray(assignmentResult) ? assignmentResult : assignmentResult?.results ?? []);
    setEligibleUsers(Array.isArray(assigneeResult) ? assigneeResult : assigneeResult?.results ?? []);
    setLoading(false);
  }, [projectId, taskId]);

  useEffect(() => {
    refresh();
    return () => {
      generationRef.current += 1;
    };
  }, [refresh]);

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
      setError("Select an eligible assignee.");
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
      setError(errorMessage(result, "The task could not be assigned."));
      setProcessing(null);
      await refresh();
      return;
    }

    setSelectedAssigneeId("");
    await refresh();
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
      setError(errorMessage(result, "The assignment could not be cancelled."));
      setProcessing(null);
      await refresh();
      return;
    }

    await refresh();
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
        Task #{taskId}
      </Typography>

      {error && (
        <div className={cn("assignment-manager").elem("error").toClassName()} role="alert" data-testid="assignment-error">
          {error}
        </div>
      )}

      <div className={cn("assignment-manager").elem("assign").toClassName()}>
        <label htmlFor="task-assignee">Eligible assignee</label>
        <select
          id="task-assignee"
          data-testid="assignment-assignee-select"
          value={selectedAssigneeId}
          onChange={(event) => setSelectedAssigneeId(event.target.value)}
          disabled={processing !== null}
        >
          <option value="">Select assignee</option>
          {availableUsers.map((user) => (
            <option key={user.id} value={user.id}>
              {user.email || [user.first_name, user.last_name].filter(Boolean).join(" ") || `User ${user.id}`}
            </option>
          ))}
        </select>
        <Button
          disabled={!selectedAssigneeId || processing !== null}
          waiting={processing === "assign"}
          onClick={assign}
        >
          Assign
        </Button>
      </div>

      <div className={cn("assignment-manager").elem("list").toClassName()}>
        {assignments.length === 0 ? (
          <div data-testid="assignment-empty">No active assignments.</div>
        ) : (
          assignments.map((assignment) => {
            const user = userById.get(assignment.assignee);
            const identity =
              user?.email ||
              [user?.first_name, user?.last_name].filter(Boolean).join(" ") ||
              `User ${assignment.assignee}`;

            return (
              <div
                key={assignment.id}
                className={cn("assignment-manager").elem("row").toClassName()}
                data-testid={`assignment-${assignment.id}`}
              >
                <div>
                  <strong>{identity}</strong>
                  <span>{assignment.status}</span>
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
                  Cancel assignment
                </Button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
