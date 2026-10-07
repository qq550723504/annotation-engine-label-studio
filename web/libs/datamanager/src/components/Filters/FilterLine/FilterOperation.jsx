import { observer } from "mobx-react";
import { getRoot } from "mobx-state-tree";
import { useCallback, useEffect, useMemo } from "react";
import { useLocaleTranslation } from "@humansignal/i18n";
import { cn } from "../../../utils/bem";
import { debounce } from "@humansignal/core/lib/utils/debounce";
import { FilterDropdown } from "../FilterDropdown";
import * as FilterInputs from "../types";
import { allowedFilterOperations } from "../types/Utility";
import { Common } from "../types/Common";

/** @typedef {{
 * type: keyof typeof FilterInputs,
 * width: number
 * }} FieldConfig */

/**
 *
 * @param {{field: FieldConfig}} param0
 */
export const FilterOperation = observer(({ filter, field, operator, value, disabled }) => {
  const { t } = useLocaleTranslation("datamanager");
  const cellView = filter.cellView;
  const types = cellView?.customOperators ?? [
    ...(FilterInputs[filter.filter.currentType] ?? FilterInputs.String),
    ...Common,
  ];

  const selected = useMemo(() => {
    let result;

    if (operator) {
      result = types.find((t) => t.key === operator);
    }

    if (!result) {
      result = types[0];
    }

    return result;
  }, [operator, types, filter]);

  // Repair an absent or invalid operator only when the underlying filter changes.
  // A locale render must never write a filter or trigger its autosave path.
  useEffect(() => {
    if (selected && operator !== selected.key) filter.setOperator(selected.key);
  }, [operator, selected?.key, filter]);

  const saveFilter = useCallback(
    debounce(() => {
      filter.save(true);
    }, 300),
    [filter],
  );

  const onChange = (newValue) => {
    filter.setValue(newValue);
    saveFilter();
  };

  const onOperatorSelected = (selectedKey) => {
    filter.setOperator(selectedKey);
  };
  const availableOperators = filter.cellView?.filterOperators;
  const Input = selected?.input;
  let operatorList = allowedFilterOperations(types, getRoot(filter)?.SDK?.type);
  if (filter.filter.field.isAnnotationResultsFilterColumn) {
    // We want at most one of "equal" or "contains" per filter type
    // They resolve to the same backend query in this custom case
    const hasEqualOperators = operatorList.some((o) => ["equal", "not_equal"].includes(o.key));
    const allowedOperators = hasEqualOperators ? ["equal", "not_equal"] : ["contains", "not_contains"];
    operatorList = operatorList.filter((op) => allowedOperators.includes(op.key));
  }
  const operators = operatorList.map(({ key, label }) => {
    if (filter.filter.field.isAnnotationResultsFilterColumn) {
      if (filter.schema?.multiple ?? false) {
        if (key === "contains") label = t("filterIncludesAll");
        if (key === "not_contains") label = t("filterNotIncludesAll");
      } else {
        if (key === "contains") label = t("filterIs");
        if (key === "not_contains") label = t("filterIsNot");
      }
      if (key === "contains" || key === "not_contains") return { value: key, label };
    }
    const translatedLabels = {
      contains: "filterContains",
      not_contains: "filterNotContains",
      regex: "filterRegex",
      empty: "filterIsEmpty",
      in: "filterBetween",
      not_in: "filterNotBetween",
    };
    if (label === "includes all") label = t("filterIncludesAll");
    else if (label === "does not include all") label = t("filterNotIncludesAll");
    else if (label === "is") label = t("filterIs");
    else if (label === "is not") label = t("filterIsNot");
    else if (label === "is before") label = t("filterBefore");
    else if (label === "is after") label = t("filterAfter");
    else if (label === "equal") label = t("filterEqual");
    else if (label === "not equal") label = t("filterNotEqual");
    else if (typeof label === "string" && translatedLabels[key]) label = t(translatedLabels[key]);
    return { value: key, label };
  });
  const columnClass = cn("filterLine").elem("column");

  return Input ? (
    <>
      <div className={columnClass.mix("operation").toClassName()}>
        <FilterDropdown
          placeholder={t("condition")}
          value={filter.operator}
          disabled={types.length === 1 || disabled}
          items={availableOperators ? operators.filter((op) => availableOperators.includes(op.value)) : operators}
          onChange={onOperatorSelected}
        />
      </div>
      <div className={columnClass.mix("value").toClassName()}>
        <Input
          {...field}
          key={`${filter.filter.id}-${filter.filter.currentType}`}
          schema={filter.schema}
          filter={filter}
          multiple={filter.schema?.multiple ?? false}
          value={value}
          onChange={onChange}
          size="small"
          disabled={disabled}
        />
      </div>
    </>
  ) : null;
});
