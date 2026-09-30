import { IconChevronDown } from "@humansignal/icons";
import { isStarterCloudPlan } from "@humansignal/core";
import { cn } from "../../../utils/bem";
import { ErrorBox } from "../../Common/ErrorBox";
import { FieldsButton } from "../../Common/FieldsButton";
import { FiltersPane } from "../../Common/FiltersPane";
import { Icon } from "../../Common/Icon/Icon";
import { Interface } from "../../Common/Interface";
import { ExportButton, ImportButton } from "../../Common/SDKButtons";
import { Tooltip } from "@humansignal/ui";
import { ActionsButton } from "./ActionsButton";
import { DensityToggle } from "./DensityToggle";
import { GridWidthButton } from "./GridWidthButton";
import { LabelButton } from "./LabelButton";
import { LoadingPossum } from "./LoadingPossum";
import { OrderButton } from "./OrderButton";
import { RefreshButton } from "./RefreshButton";
import { useLocaleTranslation } from "@humansignal/i18n";
import { ViewToggle } from "./ViewToggle";

const style = {
  minWidth: "80px",
  justifyContent: "space-between",
};

/**
 * Checks for Starter Cloud trial expiration.
 * If expired it renders disabled Import button with a tooltip.
 */
const ImportButtonWithChecks = ({ size }) => {
  const { t } = useLocaleTranslation("datamanager");
  const simpleButton = <ImportButton size={size}>{t("import")}</ImportButton>;
  const isOpenSource = !window.APP_SETTINGS.billing;
  // Check if user is on Starter Cloud plan
  const isStarterCloud = isStarterCloudPlan();

  if (isOpenSource || !isStarterCloud) return simpleButton;

  // Check if user is on trial
  const isTrialExpired = window.APP_SETTINGS.billing.checks?.is_license_expired;
  // Check the subscription period end date
  const subscriptionPeriodEnd = window.APP_SETTINGS.subscription?.current_period_end;
  // Check if user is on Starter Cloud and has expired trial
  const isStarterCloudExpiredTrial = isStarterCloud && isTrialExpired && !subscriptionPeriodEnd;
  // Check if user is on Starter Cloud and has expired subscription
  const isStarterCloudExpiredSubscription =
    isStarterCloud && subscriptionPeriodEnd && new Date(subscriptionPeriodEnd) < new Date();
  // Check if user is on Starter Cloud and has expired trial or subscription
  const isStarterCloudExpired = isStarterCloudExpiredTrial || isStarterCloudExpiredSubscription;

  if (!isStarterCloudExpired) return simpleButton;

  // Disabled buttons ignore hover, so we use wrapper to properly handle a tooltip
  return (
    <Tooltip
      title={t("upgradeToImport")}
      style={{
        maxWidth: 200,
        textAlign: "center",
      }}
    >
      <div className={cn("button-wrapper").toClassName()}>
        <ImportButton disabled size={size}>
          {t("import")}
        </ImportButton>
      </div>
    </Tooltip>
  );
};

const ColumnsInstrument = ({ size }) => {
  const { t } = useLocaleTranslation("datamanager");
  const iconProps = {
    style: { marginRight: 4 },
    icon: IconChevronDown,
  };
  return (
    <FieldsButton
      wrapper={FieldsButton.Checkbox}
      trailingIcon={<Icon {...iconProps} />}
      title={t("columns")}
      size={size}
      style={style}
      openUpwardForShortViewport={false}
    />
  );
};

const ExportInstrument = ({ size }) => {
  const { t } = useLocaleTranslation("datamanager");
  return <Interface name="export"><ExportButton size={size}>{t("export")}</ExportButton></Interface>;
};

export const instruments = {
  "view-toggle": ({ size }) => {
    return <ViewToggle size={size} style={style} />;
  },
  "density-toggle": ({ size }) => {
    return <DensityToggle size={size} />;
  },
  columns: ColumnsInstrument,
  filters: ({ size }) => {
    return <FiltersPane size={size} style={style} />;
  },
  ordering: ({ size }) => {
    return <OrderButton size={size} style={style} />;
  },
  "grid-size": ({ size }) => {
    return <GridWidthButton size={size} />;
  },
  refresh: ({ size }) => {
    return <RefreshButton size={size} />;
  },
  "loading-possum": () => {
    return <LoadingPossum />;
  },
  "label-button": ({ size }) => {
    return <LabelButton size={size} />;
  },
  actions: ({ size }) => {
    return <ActionsButton size={size} style={style} />;
  },
  "error-box": () => {
    return <ErrorBox />;
  },
  "import-button": ({ size }) => {
    return (
      <Interface name="import">
        <ImportButtonWithChecks size={size} />
      </Interface>
    );
  },
  "export-button": ExportInstrument,
};
