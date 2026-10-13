// Azure DevOps-native buttons used across pages: a dropdown button ("Inline ▾") and split buttons
// ("Approve | ▾"). They wrap azure-devops-ui so look, keyboard handling and menus match the host.
import { MenuButton, MenuItemType, type IMenuItem } from "azure-devops-ui/Menu";
import { Button } from "azure-devops-ui/Button";
import { SplitButton } from "azure-devops-ui/SplitButton";
import * as React from "react";

export interface MenuOption {
  id: string;
  text: string;
  icon?: string;
  /** Extra class on the icon, e.g. to draw it as a coloured badge. */
  iconClassName?: string;
  secondaryText?: string;
  checked?: boolean;
  disabled?: boolean;
  /** Renders a divider instead of an item. */
  divider?: boolean;
  onSelect?: () => void;
}

let menuIds = 0;
function useMenuId(prefix: string): string {
  return React.useMemo(() => `${prefix}-${++menuIds}`, [prefix]);
}

function toItems(options: MenuOption[]): IMenuItem[] {
  return options.map((o) =>
    o.divider
      ? { id: o.id, itemType: MenuItemType.Divider }
      : {
          id: o.id,
          text: o.text,
          secondaryText: o.secondaryText,
          iconProps: o.icon ? { iconName: o.icon, className: o.iconClassName } : undefined,
          checked: o.checked,
          disabled: o.disabled,
          onActivate: () => o.onSelect?.(),
        },
  );
}

/** A single button with a chevron that opens a menu, like the Files view selectors in Azure DevOps. */
export const DropdownButton: React.FC<{
  text: string;
  icon?: string;
  options: MenuOption[];
  disabled?: boolean;
  subtle?: boolean;
  ariaLabel?: string;
  className?: string;
}> = ({ text, icon, options, disabled, subtle, ariaLabel, className }) => {
  const id = useMenuId("dropdown");
  return (
    <MenuButton
      className={className}
      text={text}
      iconProps={icon ? { iconName: icon } : undefined}
      disabled={disabled}
      subtle={subtle}
      ariaLabel={ariaLabel ?? text}
      contextualMenuProps={{ menuProps: { id, items: toItems(options) } }}
    />
  );
};

/** A primary action with the alternatives behind an attached chevron (the Azure DevOps vote button). */
export const SplitActionButton: React.FC<{
  text: string;
  icon?: string;
  onClick: () => void;
  options: MenuOption[];
  primary?: boolean;
  disabled?: boolean;
  menuLabel: string;
  className?: string;
}> = ({ text, icon, onClick, options, primary, disabled, menuLabel, className }) => {
  const id = useMenuId("split");
  return (
    <SplitButton
      className={className}
      primary={primary}
      disabled={disabled}
      buttonProps={{ text, iconProps: icon ? { iconName: icon } : undefined, onClick }}
      menuButtonProps={{ ariaLabel: menuLabel, contextualMenuProps: { menuProps: { id, items: toItems(options) } } }}
    />
  );
};

/** Icon-only "⋯" menu for comment and row actions; `subtle={false}` for the filled page-header one. */
export const MoreMenu: React.FC<{ label: string; options: MenuOption[]; disabled?: boolean; subtle?: boolean }> = ({ label, options, disabled, subtle = true }) => {
  const id = useMenuId("more");
  return (
    <MenuButton
      className="more-menu"
      subtle={subtle}
      hideDropdownIcon
      iconProps={{ iconName: "More" }}
      ariaLabel={label}
      disabled={disabled}
      contextualMenuProps={{ menuProps: { id, items: toItems(options) } }}
    />
  );
};

/**
 * A two-state view toggle ("Side by side", "Group by concern"): one click flips it and the pressed
 * look shows it's on, like Azure DevOps' own view toggles. No menu.
 */
export const ToggleButton: React.FC<{
  text: string;
  icon: string;
  pressed: boolean;
  onToggle: (pressed: boolean) => void;
  tooltip?: string;
  disabled?: boolean;
}> = ({ text, icon, pressed, onToggle, tooltip, disabled }) => (
  <Button
    className={pressed ? "toggle-button pressed" : "toggle-button"}
    text={text}
    iconProps={{ iconName: icon }}
    ariaPressed={pressed}
    tooltipProps={tooltip ? { text: tooltip } : undefined}
    disabled={disabled}
    onClick={() => onToggle(!pressed)}
  />
);
