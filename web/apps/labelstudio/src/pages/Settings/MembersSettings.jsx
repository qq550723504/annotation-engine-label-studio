import { useCallback, useEffect, useMemo, useState } from "react";
import { useHistory } from "react-router";
import { Button, Typography } from "@humansignal/ui";
import { Spinner } from "../../components/Spinner/Spinner";
import { useAPI } from "../../providers/ApiProvider";
import { useProject } from "../../providers/ProjectProvider";
import { cn } from "../../utils/bem";
import "./MembersSettings.scss";

const ROLES = [
  { value: "manager", label: "Manager" },
  { value: "annotator", label: "Annotator" },
  { value: "reviewer", label: "Reviewer" },
];

const flattenError = (value) => {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(flattenError);
  if (typeof value === "object") return Object.values(value).flatMap(flattenError);
  return [String(value)];
};

const errorMessage = (result, fallback) => {
  const response = result?.response;
  const messages = flattenError(response);
  return messages.length ? messages.join(" ") : result?.error ?? fallback;
};

const responseItems = (response) => {
  if (Array.isArray(response)) return response;
  return response?.results ?? [];
};

export const MembersSettings = () => {
  const api = useAPI();
  const history = useHistory();
  const { project } = useProject();
  const [members, setMembers] = useState([]);
  const [organizationUsers, setOrganizationUsers] = useState([]);
  const [organizationPage, setOrganizationPage] = useState(1);
  const [organizationHasNext, setOrganizationHasNext] = useState(false);
  const [organizationHasPrevious, setOrganizationHasPrevious] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedRole, setSelectedRole] = useState("annotator");
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(null);
  const [error, setError] = useState("");

  const loadMembers = useCallback(async () => {
    if (!project?.id) return false;

    const result = await api.callApi("projectMembers", {
      params: { pk: project.id },
      errorFilter: (apiError) => [403, 404].includes(apiError?.status),
    });

    if ([403, 404].includes(result?.status) || [403, 404].includes(result?.$meta?.status)) {
      history.replace(`/projects/${project.id}/settings`);
      return false;
    }

    if (!result) return false;

    setMembers(responseItems(result));
    return true;
  }, [api, history, project?.id]);

  const loadOrganizationUsers = useCallback(
    async (page = organizationPage) => {
      if (!project?.organization) return;

      const result = await api.callApi("memberships", {
        params: {
          pk: project.organization,
          active: true,
          page,
          page_size: 50,
        },
      });

      if (result) {
        setOrganizationUsers(responseItems(result).map((membership) => membership.user).filter(Boolean));
        setOrganizationHasNext(Boolean(result.next));
        setOrganizationHasPrevious(Boolean(result.previous));
      }
    },
    [api, organizationPage, project?.organization],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    const allowed = await loadMembers();

    if (allowed) {
      await loadOrganizationUsers();
    }

    setLoading(false);
  }, [loadMembers, loadOrganizationUsers]);

  useEffect(() => {
    if (project?.id) refresh();
  }, [project?.id, refresh]);

  const effectiveMembers = useMemo(() => {
    const creatorId = project.created_by?.id;
    if (!creatorId || members.some((member) => member.user?.id === creatorId)) {
      return members;
    }

    return [
      {
        id: `creator-${creatorId}`,
        user: project.created_by,
        role: "manager",
        enabled: true,
        implicitCreator: true,
      },
      ...members,
    ];
  }, [members, project.created_by]);

  const existingUserIds = useMemo(
    () => new Set(effectiveMembers.map((member) => member.user?.id)),
    [effectiveMembers],
  );

  const availableUsers = useMemo(
    () => organizationUsers.filter((user) => !existingUserIds.has(user.id)),
    [organizationUsers, existingUserIds],
  );

  useEffect(() => {
    if (selectedUserId && !availableUsers.some((user) => String(user.id) === String(selectedUserId))) {
      setSelectedUserId("");
    }
  }, [availableUsers, selectedUserId]);

  const runMutation = useCallback(
    async (label, method, options) => {
      setProcessing(label);
      setError("");

      const result = await api.callApi(method, {
        ...options,
        errorFilter: () => true,
      });

      const status = result?.status ?? result?.$meta?.status;
      if ([403, 404].includes(status)) {
        setMembers([]);
        setOrganizationUsers([]);
        setProcessing(null);
        history.replace(`/projects/${project.id}/settings`);
        return false;
      }

      if (!result || result?.error || result?.$meta?.ok === false) {
        setError(errorMessage(result, "The requested member change could not be completed."));
        setProcessing(null);
        return false;
      }

      const stillAllowed = await loadMembers();
      if (stillAllowed) {
        await loadOrganizationUsers();
      }
      setProcessing(null);
      return true;
    },
    [api, history, loadMembers, loadOrganizationUsers, project.id],
  );

  const addMember = async (event) => {
    event.preventDefault();
    if (!selectedUserId) {
      setError("Select an organization user before adding a project member.");
      return;
    }

    const success = await runMutation("add", "createProjectMember", {
      params: { pk: project.id },
      body: {
        user_id: Number(selectedUserId),
        role: selectedRole,
        enabled: true,
      },
    });

    if (success) {
      setSelectedUserId("");
      setSelectedRole("annotator");
    }
  };

  const confirmAssignmentImpact = (message) =>
    window.confirm(
      `${message}\n\nThis can cancel the member's active task assignments. Restoring the role or re-enabling the member will not restore cancelled assignments. Continue?`,
    );

  const updateMember = async (member, body, action) => {
    const losesLabelAccess =
      member.enabled &&
      ["annotator", "manager"].includes(member.role) &&
      ((body.role && body.role === "reviewer") || body.enabled === false);

    if (
      losesLabelAccess &&
      !confirmAssignmentImpact(
        body.enabled === false
          ? `Disable ${member.user?.email || "this member"}?`
          : `Change ${member.user?.email || "this member"} to Reviewer?`,
      )
    ) {
      return;
    }

    await runMutation(`${action}-${member.id}`, "updateProjectMember", {
      params: { pk: project.id, memberPk: member.id },
      body,
    });
  };

  const removeMember = async (member) => {
    if (
      !confirmAssignmentImpact(
        `Remove ${member.user?.email || "this member"} from the project? This membership removal cannot be undone.`,
      )
    ) {
      return;
    }

    await runMutation(`remove-${member.id}`, "deleteProjectMember", {
      params: { pk: project.id, memberPk: member.id },
    });
  };

  if (loading) {
    return (
      <div className={cn("members-settings").toClassName()}>
        <Spinner size={32} />
      </div>
    );
  }

  return (
    <div className={cn("members-settings").toClassName()} data-testid="project-members-settings">
      <Typography variant="headline" size="medium" className="mb-tighter">
        Project Members
      </Typography>
      <Typography variant="body" size="medium" className="text-neutral-content-subtler !mb-base">
        Manage project-scoped access. Server-side authorization remains authoritative.
      </Typography>

      {error && (
        <div className={cn("members-settings").elem("error").toClassName()} role="alert" data-testid="members-error">
          {error}
        </div>
      )}

      <form className={cn("members-settings").elem("add").toClassName()} onSubmit={addMember}>
        <div>
          <label htmlFor="project-member-user">Organization user</label>
          <select
            id="project-member-user"
            data-testid="member-user-select"
            value={selectedUserId}
            onChange={(event) => setSelectedUserId(event.target.value)}
          >
            <option value="">Select user</option>
            {availableUsers.map((user) => (
              <option key={user.id} value={user.id}>
                {user.email || user.username || `User ${user.id}`}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label htmlFor="project-member-role">Role</label>
          <select
            id="project-member-role"
            data-testid="member-role-select"
            value={selectedRole}
            onChange={(event) => setSelectedRole(event.target.value)}
          >
            {ROLES.map((role) => (
              <option key={role.value} value={role.value}>
                {role.label}
              </option>
            ))}
          </select>
        </div>

        <Button type="submit" waiting={processing === "add"} disabled={!selectedUserId || processing !== null}>
          Add member
        </Button>
      </form>

      <div className={cn("members-settings").elem("directory-pagination").toClassName()}>
        <Button
          size="small"
          look="outlined"
          disabled={!organizationHasPrevious || processing !== null}
          onClick={async () => {
            const nextPage = Math.max(1, organizationPage - 1);
            setOrganizationPage(nextPage);
            setSelectedUserId("");
            await loadOrganizationUsers(nextPage);
          }}
        >
          Previous users
        </Button>
        <span>Organization users page {organizationPage}</span>
        <Button
          size="small"
          look="outlined"
          disabled={!organizationHasNext || processing !== null}
          onClick={async () => {
            const nextPage = organizationPage + 1;
            setOrganizationPage(nextPage);
            setSelectedUserId("");
            await loadOrganizationUsers(nextPage);
          }}
        >
          Next users
        </Button>
      </div>

      <div className={cn("members-settings").elem("table-wrapper").toClassName()}>
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>Status</th>
              <th aria-label="Member actions">Actions</th>
            </tr>
          </thead>
          <tbody>
            {effectiveMembers.map((member) => {
              const isCreator = member.user?.id === project.created_by?.id;
              const busy = processing?.endsWith(`-${member.id}`);

              return (
                <tr key={member.id} data-testid={`project-member-${member.id}`}>
                  <td>
                    <strong>{member.user?.email || member.user?.username || `User ${member.user?.id}`}</strong>
                    {isCreator && <span className={cn("members-settings").elem("creator").toClassName()}>Creator</span>}
                  </td>
                  <td>
                    <select
                      aria-label={`Role for ${member.user?.email || member.user?.id}`}
                      data-testid={`member-role-${member.user?.id}`}
                      value={member.role}
                      disabled={isCreator || busy || processing !== null}
                      onChange={(event) => updateMember(member, { role: event.target.value }, "role")}
                    >
                      {ROLES.map((role) => (
                        <option key={role.value} value={role.value}>
                          {role.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>{member.enabled ? "Enabled" : "Disabled"}</td>
                  <td className={cn("members-settings").elem("actions").toClassName()}>
                    <Button
                      size="small"
                      look="outlined"
                      disabled={isCreator || busy || processing !== null}
                      waiting={processing === `enabled-${member.id}`}
                      onClick={() => updateMember(member, { enabled: !member.enabled }, "enabled")}
                    >
                      {member.enabled ? "Disable" : "Enable"}
                    </Button>
                    <Button
                      size="small"
                      variant="negative"
                      look="outlined"
                      disabled={isCreator || busy || processing !== null}
                      waiting={processing === `remove-${member.id}`}
                      onClick={() => removeMember(member)}
                    >
                      Remove
                    </Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

MembersSettings.title = "Members";
MembersSettings.menuItem = "Members";
MembersSettings.path = "/members";
MembersSettings.exact = true;
