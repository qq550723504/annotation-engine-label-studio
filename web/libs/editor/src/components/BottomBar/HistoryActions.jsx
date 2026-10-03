import { observer } from "mobx-react";
import { IconRedo, IconReset, IconUndo } from "@humansignal/icons";
import { Tooltip, Button } from "@humansignal/ui";
import { cn } from "../../utils/bem";
import { useLocaleTranslation } from "@humansignal/i18n";
import "./HistoryActions.scss";

export const EditingHistory = observer(({ entity }) => {
  const { t } = useLocaleTranslation("editor");
  const { history } = entity;

  return (
    <div className={cn("history-buttons").toClassName()}>
      <Tooltip title={t("undo")}>
        <Button
          variant="neutral"
          size="small"
          aria-label={t("undo")}
          look="string"
          disabled={!history?.canUndo}
          onClick={() => entity.undo()}
          className="aspect-square"
          leading={<IconUndo />}
          data-testid="bottombar-undo-button"
        />
      </Tooltip>
      <Tooltip title={t("redo")}>
        <Button
          variant="neutral"
          size="small"
          look="string"
          aria-label={t("redo")}
          disabled={!history?.canRedo}
          onClick={() => entity.redo()}
          className="aspect-square"
          leading={<IconRedo />}
          data-testid="bottombar-redo-button"
        />
      </Tooltip>
      <Tooltip title={t("reset")}>
        <Button
          variant="negative"
          look="string"
          size="small"
          aria-label={t("reset")}
          disabled={!history?.canUndo}
          onClick={() => history?.reset()}
          className="aspect-square"
          leading={<IconReset />}
          data-testid="bottombar-reset-button"
        />
      </Tooltip>
    </div>
  );
});
