import type { CSSProperties, ReactNode } from "react";
import { cn } from "../../utils/bem";
import "./ToggleItems.scss";

export const ToggleItems = ({
  className,
  style,
  big,
  items,
  active,
  onSelect,
}: {
  className?: string;
  style?: CSSProperties;
  big?: boolean;
  items: { [name: string]: ReactNode };
  active: string;
  onSelect: (name: string) => any;
}) => {
  const rootClass = cn("toggle-items");

  return (
    <ul className={rootClass.mod({ big }).mix(className).toClassName()} style={style}>
      {Object.keys(items).map((item) => (
        <li
          key={item}
          className={rootClass
            .elem("item")
            .mod({ active: item === active })
            .toClassName()}
        >
          <button type="button" data-testid={`toggle-${item}`} aria-pressed={item === active} onClick={() => onSelect(item)}>
            {items[item]}
          </button>
        </li>
      ))}
    </ul>
  );
};
