import { useEffect, useRef, useState } from "react";
import { SidebarMenu } from "../../components/SidebarMenu/SidebarMenu";
import { useAPI } from "../../providers/ApiProvider";
import { useProject } from "../../providers/ProjectProvider";
import { WebhookPage } from "../WebhookPage/WebhookPage";
import { DangerZone } from "./DangerZone";
import { GeneralSettings } from "./GeneralSettings";
import { AnnotationSettings } from "./AnnotationSettings";
import { LabelingSettings } from "./LabelingSettings";
import { MachineLearningSettings } from "./MachineLearningSettings/MachineLearningSettings";
import { MembersSettings } from "./MembersSettings";
import { PredictionsSettings } from "./PredictionsSettings/PredictionsSettings";
import { StorageSettings } from "./StorageSettings/StorageSettings";
import "./settings.scss";

export const MenuLayout = ({ children, ...routeProps }) => {
  const api = useAPI();
  const callApi = useRef(api.callApi).current;
  const { project } = useProject();
  const [canManageMembers, setCanManageMembers] = useState(false);

  useEffect(() => {
    let active = true;
    setCanManageMembers(false);

    const probeMemberManagement = async () => {
      if (!project?.id) return;

      const result = await callApi("projectMemberCapability", {
        params: { pk: project.id },
        errorFilter: (apiError) => [403, 404].includes(apiError?.status),
      });

      if (!active) return;

      const status = result?.status ?? result?.$meta?.status;
      if (status === 404) {
        setCanManageMembers(false);
        routeProps.history.replace("/projects");
        return;
      }

      setCanManageMembers(Boolean(result?.can_manage && !result.error && status !== 403));
    };

    probeMemberManagement();

    return () => {
      active = false;
    };
  }, [callApi, project?.id, routeProps.location?.pathname]);

  return (
    <SidebarMenu
      menuItems={[
        GeneralSettings,
        LabelingSettings,
        AnnotationSettings,
        canManageMembers && MembersSettings,
        MachineLearningSettings,
        PredictionsSettings,
        StorageSettings,
        WebhookPage,
        DangerZone,
      ].filter(Boolean)}
      path={routeProps.match.url}
      children={children}
    />
  );
};

const pages = {
  AnnotationSettings,
  LabelingSettings,
  MembersSettings,
  MachineLearningSettings,
  PredictionsSettings,
  StorageSettings,
  WebhookPage,
  DangerZone,
};

export const SettingsPage = {
  title: "Settings",
  path: "/settings",
  exact: true,
  layout: MenuLayout,
  component: GeneralSettings,
  pages,
};
