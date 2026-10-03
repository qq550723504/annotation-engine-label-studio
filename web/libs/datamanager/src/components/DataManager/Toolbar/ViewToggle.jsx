import { inject, observer } from "mobx-react";
import { RadioGroup } from "../../Common/RadioGroup/RadioGroup";
import { IconGrid, IconList } from "@humansignal/icons";
import { Tooltip } from "@humansignal/ui";
import { useLocaleTranslation } from "@humansignal/i18n";

const viewInjector = inject(({ store }) => ({
  view: store.currentView,
}));

export const ViewToggle = viewInjector(
  observer(({ view, size, ...rest }) => {
    const { t } = useLocaleTranslation("datamanager");
    return (
      <RadioGroup
        size={size}
        value={view.type}
        onChange={(e) => view.setType(e.target.value)}
        {...rest}
        style={{ "--button-padding": "0 var(--spacing-tighter)" }}
      >
        <Tooltip title={t("listView")}>
          <div>
            <RadioGroup.Button value="list" aria-label={t("switchToListView")}>
              <IconList />
            </RadioGroup.Button>
          </div>
        </Tooltip>
        <Tooltip title={t("gridView")}>
          <div>
            <RadioGroup.Button value="grid" aria-label={t("switchToGridView")}>
              <IconGrid />
            </RadioGroup.Button>
          </div>
        </Tooltip>
      </RadioGroup>
    );
  }),
);

export const DataStoreToggle = viewInjector(({ view, size, ...rest }) => {
  const { t } = useLocaleTranslation("datamanager");
  return (
    <RadioGroup value={view.target} size={size} onChange={(e) => view.setTarget(e.target.value)} {...rest}>
      <RadioGroup.Button value="tasks">{t("tasks")}</RadioGroup.Button>
      <RadioGroup.Button value="annotations" disabled>
        {t("columnAnnotations")}
      </RadioGroup.Button>
    </RadioGroup>
  );
});
