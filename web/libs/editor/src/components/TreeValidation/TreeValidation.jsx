import { PropTypes } from "prop-types";
import { getEnv } from "mobx-state-tree";
import { inject, observer } from "mobx-react";

import { ErrorMessage } from "../ErrorMessage/ErrorMessage";
import { useLocaleTranslation } from "@humansignal/i18n";
import DefaultMessages from "../../utils/messages";
import { validationDisplay } from "./validationDisplay";
import { renderGeneralValidation } from "./renderGeneralValidation";

export const TreeValidation = inject("store")(
  observer(({ store, errors }) => {
    const { t } = useLocaleTranslation("editor");
    const messages = getEnv(store).messages;
    return (
      <div className="lsf-errors">
        {errors.map((error, index) => {
          const resolver = messages[error.error];
          // Respect host-provided message overrides. Translated errors remain
          // React text; the upstream general-error markup uses a narrow parser.
          const text = resolver && resolver !== DefaultMessages[error.error]
            ? resolver(error)
            : error.error === "ERR_GENERAL"
              ? renderGeneralValidation(error.value)
              : <>{validationDisplay(error, t)}</>;
          return <ErrorMessage key={`error-${index}`} error={text} />;
        })}
      </div>
    );
  }),
);

TreeValidation.propTypes = {
  errors: PropTypes.array.isRequired,
};
