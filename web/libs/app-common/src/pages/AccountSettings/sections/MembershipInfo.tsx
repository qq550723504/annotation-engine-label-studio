import styles from "./MembershipInfo.module.scss";
import { useQuery } from "@tanstack/react-query";
import { getApiInstance } from "@humansignal/core";
import { useMemo } from "react";
import type { WrappedResponse } from "@humansignal/core/lib/api-proxy/types";
import { useAuth } from "@humansignal/core/providers/AuthProvider";
import { formatDisplayDate, formatDisplayNumber, useLocaleTranslation } from "@humansignal/i18n";

export const MembershipInfo = () => {
  const { locale, t } = useLocaleTranslation("app");
  const { user } = useAuth();
  const dateJoined = useMemo(() => {
    if (!user?.date_joined) return null;
    return formatDisplayDate(user.date_joined, locale, { dateStyle: "medium", timeStyle: "short" });
  }, [user?.date_joined, locale]);

  const membership = useQuery({
    queryKey: [user?.active_organization, user?.id, "user-membership"],
    async queryFn() {
      if (!user) return {};
      const api = getApiInstance();
      const response = (await api.invoke("userMemberships", {
        pk: user.active_organization,
        userPk: user.id,
      })) as WrappedResponse<{
        user: number;
        organization: number;
        contributed_projects_count: number;
        annotations_count: number;
        created_at: string;
        role: string;
      }>;

      const annotationCount = response?.annotations_count;
      const contributions = response?.contributed_projects_count;
      return {
        annotationCount,
        contributions,
        role: response.role,
      };
    },
  });

  const organization = useQuery({
    queryKey: ["organization", user?.active_organization],
    async queryFn() {
      if (!user) return null;
      if (!window?.APP_SETTINGS?.billing) return null;
      const api = getApiInstance();
      const organization = (await api.invoke("organization", {
        pk: user.active_organization,
      })) as WrappedResponse<{
        id: number;
        external_id: string;
        title: string;
        token: string;
        default_role: string;
        created_at: string;
      }>;

      if (!organization.$meta.ok) {
        return null;
      }

      return {
        ...organization,
        createdAt: organization.created_at,
      } as const;
    },
  });

  return (
    <div className={styles.membershipInfo} id="membership-info">
      <div className="flex gap-2 w-full justify-between">
        <div>{t("userId")}</div>
        <div>{user?.id}</div>
      </div>

      <div className="flex gap-2 w-full justify-between">
        <div>{t("registrationDate")}</div>
        <div>{dateJoined}</div>
      </div>

      <div className="flex gap-2 w-full justify-between">
        <div>{t("annotationsSubmitted")}</div>
        <div>{membership.data?.annotationCount == null ? "" : formatDisplayNumber(membership.data.annotationCount, locale)}</div>
      </div>

      <div className="flex gap-2 w-full justify-between">
        <div>{t("projectsContributed")}</div>
        <div>{membership.data?.contributions == null ? "" : formatDisplayNumber(membership.data.contributions, locale)}</div>
      </div>

      <div className={styles.divider} />

      {user?.active_organization_meta && (
        <div className="flex gap-2 w-full justify-between">
          <div>{t("organization")}</div>
          <div>{user.active_organization_meta.title}</div>
        </div>
      )}

      {membership.data?.role && (
        <div className="flex gap-2 w-full justify-between">
          <div>{t("myRole")}</div>
          <div>{({ OW: t("roleOwner"), DI: t("roleDeactivated"), AD: t("roleAdministrator"), MA: t("roleManager"), AN: t("roleAnnotator"), RE: t("roleReviewer"), NO: t("rolePending") } as Record<string, string>)[membership.data.role] ?? membership.data.role}</div>
        </div>
      )}

      <div className="flex gap-2 w-full justify-between">
        <div>{t("organizationId")}</div>
        <div>{user?.active_organization}</div>
      </div>

      {user?.active_organization_meta && (
        <div className="flex gap-2 w-full justify-between">
          <div>{t("roleOwner")}</div>
          <div>{user.active_organization_meta.email}</div>
        </div>
      )}

      {organization.data?.createdAt && (
        <div className="flex gap-2 w-full justify-between">
          <div>{t("created")}</div>
          <div>{formatDisplayDate(organization.data.createdAt, locale, { dateStyle: "medium", timeStyle: "short" })}</div>
        </div>
      )}
    </div>
  );
};
