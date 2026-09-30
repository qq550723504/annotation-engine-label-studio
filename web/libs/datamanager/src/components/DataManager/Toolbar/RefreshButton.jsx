import { inject } from "mobx-react";
import { IconRefresh } from "@humansignal/icons";
import { Button } from "@humansignal/ui";
import { useLocaleTranslation } from "@humansignal/i18n";

const injector = inject(({ store }) => {
  return {
    store,
    needsDataFetch: store.needsDataFetch,
    projectFetch: store.projectFetch,
  };
});

export const RefreshButton = injector(({ store, needsDataFetch, projectFetch, size, style, ...rest }) => {
  const { t } = useLocaleTranslation("datamanager");
  return (
    <Button
      size={size ?? "small"}
      look={needsDataFetch ? "filled" : "outlined"}
      variant={needsDataFetch ? "primary" : "neutral"}
      waiting={projectFetch}
      aria-label={t("refreshData")}
      onClick={async () => {
        await store.fetchProject({ force: true, interaction: "refresh" });
        await store.currentView?.reload();
      }}
    >
      <IconRefresh />
    </Button>
  );
});
