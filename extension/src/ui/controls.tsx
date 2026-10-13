// Azure DevOps-native buttons used across pages: a dropdown button ("Inline ▾") and split buttons
// ("Approve | ▾"). They wrap azure-devops-ui so look, keyboard handling and menus match the host.
import { MenuButton, MenuItemType, type IMenuItem } from "azure-devops-ui/Menu";
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
  /** The current value of a picker: a blue marker and highlight instead of a checkmark. */
  selected?: boolean;
  disabled?: boolean;
  /** Renders a divider instead of an item. */
  divider?: boolean;
  onSelect?: () => void;
  /** Makes the item a link; it opens in the whole Azure DevOps page, not the extension's frame. */
  href?: string;
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
          className: o.selected ? "menu-item-selected" : undefined,
          text: o.text,
          secondaryText: o.secondaryText,
          iconProps: o.icon ? { iconName: o.icon, className: o.iconClassName } : undefined,
          checked: o.checked,
          disabled: o.disabled,
          href: o.href,
          target: o.href ? "_top" : undefined,
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

export interface ModeOption<T extends string> {
  value: T;
  text: string;
  icon: string;
}

/**
 * A two-way view switch like Azure DevOps' "Inline ▾" diff toggle: the button names the current mode,
 * one click flips to the other, and the chevron lists both.
 */
export function ModeToggle<T extends string>({
  options,
  value,
  onChange,
  menuLabel,
  tooltip,
  disabled,
}: {
  options: [ModeOption<T>, ModeOption<T>];
  value: T;
  onChange: (value: T) => void;
  menuLabel: string;
  /** Overrides the default "Currently in 'X' mode. Click to toggle to 'Y' mode." */
  tooltip?: string;
  disabled?: boolean;
}): React.ReactElement {
  const id = useMenuId("mode");
  const current = options.find((o) => o.value === value) ?? options[0];
  const other = options.find((o) => o !== current)!;
  return (
    <SplitButton
      className="mode-toggle"
      disabled={disabled}
      buttonProps={{
        text: current.text,
        iconProps: { iconName: current.icon },
        tooltipProps: { text: tooltip ?? `Currently in '${current.text}' mode. Click to toggle to '${other.text}' mode.` },
        onClick: () => onChange(other.value),
      }}
      menuButtonProps={{
        ariaLabel: menuLabel,
        contextualMenuProps: {
          menuProps: {
            id,
            items: toItems(options.map((o) => ({ id: o.value, text: o.text, icon: o.icon, onSelect: () => onChange(o.value) }))),
          },
        },
      }}
    />
  );
}
