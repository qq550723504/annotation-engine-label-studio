import { observer } from "mobx-react";
import { IconRedo, IconRemove, IconUndo } from "@humansignal/icons";
import { Button } from "@humansignal/ui";
import { cn } from "../../utils/bem";
import { useLocaleTranslation } from "@humansignal/i18n";
import "./HistoryActions.scss";

export const EditingHistory = observer(({ entity }) => {
  const { t } = useLocaleTranslation("editor");
  const { history } = entity;

  return (
    <div className={cn("history-buttons").toClassName()}>
      <Button
        variant="neutral"
        look="string"
        aria-label={t("undo")}
        className="!p-0"
        tooltip={t("undo")}
        disabled={!history?.canUndo}
        onClick={() => entity.undo()}
      >
        <IconUndo />
      </Button>
      <Button
        variant="neutral"
        look="string"
        aria-label={t("redo")}
        className="!p-0"
        tooltip={t("redo")}
        disabled={!history?.canRedo}
        onClick={() => entity.redo()}
        leading={<IconRedo />}
      />
      <Button
        look="string"
        variant="negative"
        aria-label={t("reset")}
        tooltip={t("reset")}
        className="!p-0"
        disabled={!history?.canUndo}
        onClick={() => history?.reset()}
        leading={<IconRemove />}
      />
    </div>
  );
});
